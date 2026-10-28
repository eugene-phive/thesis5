import { app } from 'electron'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Note, SearchHit } from '../shared/api'
import { SEARCH_HIGHLIGHT_CLOSE, SEARCH_HIGHLIGHT_OPEN } from '../shared/search'

type DatabaseConstructor = typeof import('better-sqlite3')
type DatabaseInstance = import('better-sqlite3').Database

const require = createRequire(import.meta.url)
const MAX_SEARCH_TERMS = 8
const SNIPPET_RADIUS = 70

let db: DatabaseInstance | null = null
let dbPath: string | null = null
let ftsEnabled = false

export function initIndexDatabase(): { path: string | null; ready: boolean } {
  dbPath = path.join(app.getPath('userData'), 'index.db')
  try {
    const Database = require('better-sqlite3') as DatabaseConstructor
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    ensureContentColumn(db)

    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          id UNINDEXED,
          title,
          content,
          tokenize = 'unicode61 remove_diacritics 2'
        )
      `)
      ftsEnabled = true
    } catch (error) {
      ftsEnabled = false
      console.warn('[index-db] FTS5 недоступен, поиск будет работать через LIKE:', error)
    }

    return { path: dbPath, ready: true }
  } catch (error) {
    console.warn('[index-db] SQLite недоступен, приложение продолжит работу без индекса:', error)
    db = null
    ftsEnabled = false
    return { path: dbPath, ready: false }
  }
}

export function getIndexPath(): string | null {
  return dbPath
}

export function isIndexReady(): boolean {
  return db !== null
}

export function syncIndex(notes: Note[]): void {
  if (!db) return

  const upsert = db.prepare(`
    INSERT INTO notes (id, title, updated_at, content) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      updated_at = excluded.updated_at,
      content = excluded.content
  `)
  const remove = db.prepare('DELETE FROM notes WHERE id = ?')
  const ftsRemove = ftsEnabled ? db.prepare('DELETE FROM notes_fts WHERE id = ?') : null
  const ftsInsert = ftsEnabled
    ? db.prepare('INSERT INTO notes_fts (id, title, content) VALUES (?, ?, ?)')
    : null
  const existing = new Set(
    (db.prepare('SELECT id FROM notes').all() as Array<{ id: string }>).map((row) => row.id),
  )

  const transaction = db.transaction((items: Note[]) => {
    for (const note of items) {
      upsert.run(note.id, note.title, note.updatedAt, note.content)
      if (ftsRemove && ftsInsert) {
        ftsRemove.run(note.id)
        ftsInsert.run(note.id, note.title, note.content)
      }
      existing.delete(note.id)
    }
    for (const id of existing) {
      remove.run(id)
      ftsRemove?.run(id)
    }
  })
  transaction(notes)
}

/**
 * Поиск по индексу. Возвращает `null`, если SQLite недоступен,
 * чтобы вызывающая сторона могла перейти на поиск в памяти.
 */
export function searchIndex(query: string, limit = 30): SearchHit[] | null {
  if (!db) return null

  const raw = query.trim()
  if (!raw) return []

  if (ftsEnabled) {
    const ftsQuery = toFtsQuery(raw)
    if (ftsQuery) {
      try {
        return searchFts(db, ftsQuery, limit)
      } catch (error) {
        console.warn('[index-db] Ошибка FTS-запроса, использую LIKE:', error)
      }
    }
  }

  return searchLike(db, raw, limit)
}

export function searchNotesInMemory(notes: Note[], query: string, limit = 30): SearchHit[] {
  const terms = normalizeTerms(query)
  if (!terms.length) return []

  const matches = notes
    .map((note) => {
      const title = note.title.toLowerCase()
      const content = note.content.toLowerCase()
      const matched = terms.every((term) => title.includes(term) || content.includes(term))
      return matched ? note : null
    })
    .filter((note): note is Note => note !== null)

  return matches
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((note) => ({
      id: note.id,
      title: note.title,
      snippet: buildSnippet(note.content, terms),
      updatedAt: note.updatedAt,
    }))
}

function ensureContentColumn(database: DatabaseInstance): void {
  const columns = database.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'content')) {
    database.exec("ALTER TABLE notes ADD COLUMN content TEXT NOT NULL DEFAULT ''")
  }
}

function normalizeTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 0 && /[\p{L}\p{N}]/u.test(term))
    .slice(0, MAX_SEARCH_TERMS)
}

function toFtsQuery(query: string): string | null {
  const terms = normalizeTerms(query)
  if (!terms.length) return null
  return terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ')
}

function searchFts(database: DatabaseInstance, ftsQuery: string, limit: number): SearchHit[] {
  const rows = database
    .prepare(
      `
        SELECT
          notes.id AS id,
          notes.title AS title,
          notes.updated_at AS updatedAt,
          snippet(notes_fts, 2, ?, ?, '…', 16) AS snippet
        FROM notes_fts
        JOIN notes ON notes.id = notes_fts.id
        WHERE notes_fts MATCH ?
        ORDER BY bm25(notes_fts, 0.0, 5.0, 1.0), notes.updated_at DESC
        LIMIT ?
      `,
    )
    .all(SEARCH_HIGHLIGHT_OPEN, SEARCH_HIGHLIGHT_CLOSE, ftsQuery, limit) as SearchHit[]

  return rows.map((row) => ({
    ...row,
    snippet: row.snippet || '',
  }))
}

function searchLike(database: DatabaseInstance, query: string, limit: number): SearchHit[] {
  const terms = normalizeTerms(query)
  if (!terms.length) return []

  const conditions = terms
    .map(() => "(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')")
    .join(' AND ')
  const params = terms.flatMap((term) => {
    const pattern = `%${escapeLike(term)}%`
    return [pattern, pattern]
  })

  const rows = database
    .prepare(
      `
        SELECT id, title, content, updated_at AS updatedAt
        FROM notes
        WHERE ${conditions}
        ORDER BY updated_at DESC
        LIMIT ?
      `,
    )
    .all(...params, limit) as Array<{
    id: string
    title: string
    content: string
    updatedAt: number
  }>

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    snippet: buildSnippet(row.content, terms),
    updatedAt: row.updatedAt,
  }))
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function buildSnippet(content: string, terms: string[]): string {
  const text = content.replace(/\s+/g, ' ').trim()
  if (!text) return ''

  const lower = text.toLowerCase()
  const matches = terms
    .map((term) => ({ term, index: lower.indexOf(term) }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => a.index - b.index)

  const first = matches[0]
  if (!first) {
    return text.length > 160 ? `${text.slice(0, 157)}…` : text
  }

  const start = Math.max(0, first.index - SNIPPET_RADIUS)
  const end = Math.min(text.length, first.index + first.term.length + SNIPPET_RADIUS * 2)
  const raw = text.slice(start, end)

  const spans = matches
    .filter((match) => match.index + match.term.length > start && match.index < end)
    .map((match) => ({
      start: Math.max(0, match.index - start),
      end: Math.min(raw.length, match.index - start + match.term.length),
    }))
    .sort((a, b) => a.start - b.start)

  let result = ''
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    result += raw.slice(cursor, span.start)
    result += SEARCH_HIGHLIGHT_OPEN + raw.slice(span.start, span.end) + SEARCH_HIGHLIGHT_CLOSE
    cursor = span.end
  }
  result += raw.slice(cursor)

  return `${start > 0 ? '…' : ''}${result}${end < text.length ? '…' : ''}`
}
