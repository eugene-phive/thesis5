import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import type { CreateNoteInput, Note, NoteMeta } from '../shared/api'

const NOTE_FILENAME = 'index.md'
const NOTE_EXTENSION = '.md'
const ORDER_FILE = '.order.json'
const ORDER_VERSION = 1
const ROOT_GROUP = ''
const ASSETS_DIR = 'assets'
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git'])

type NoteOrder = Map<string, string[]>

export type VaultMoveErrorCode =
  | 'same'
  | 'inside'
  | 'ancestor'
  | 'not-directory'
  | 'not-empty'

export class VaultMoveError extends Error {
  constructor(public readonly code: VaultMoveErrorCode) {
    super(code)
    this.name = 'VaultMoveError'
  }
}
const WELCOME_NOTE = {
  title: 'Welcome / Добро пожаловать',
  content: `# Welcome / Добро пожаловать

## English

This is your local notes vault. Every note is stored as a Markdown file,
so you can copy it to another computer or open it in any text editor.

- Notes can be created and deleted
- Changes are saved to \`.md\` files
- Markdown remains the source of truth

---

## Русский

Это ваша локальная база заметок. Каждая заметка хранится в формате Markdown,
поэтому её можно скопировать на другой компьютер или открыть любым текстовым редактором.

- Заметки можно создавать и удалять
- Изменения сохраняются в \`.md\` файлы
- Markdown остаётся источником истины
`,
}

export class Vault {
  private root: string
  private order: NoteOrder | null = null

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  get path(): string {
    return this.root
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
    await this.migrateLegacy()
    const notes = await this.list()
    if (notes.length === 0) {
      await this.create(WELCOME_NOTE)
    }
  }

  async list(): Promise<NoteMeta[]> {
    const notes = await this.listAll()
    return notes.map(({ content: _content, ...meta }) => meta)
  }

  async listAll(): Promise<Note[]> {
    const notes = await this.readAllNotes()
    const order = await this.ensureOrder(notes)
    return notes.map((note) => ({
      ...note,
      position: this.positionOf(order, note.id, note.parentId),
    }))
  }

  async read(id: string): Promise<Note> {
    const absolute = this.toAbsolute(id)
    const normalizedId = this.toId(id)
    const [content, stat] = await Promise.all([
      fs.readFile(absolute, 'utf8'),
      fs.stat(absolute),
    ])
    return {
      id: normalizedId,
      title: extractTitle(content, normalizedId),
      parentId: parentOf(normalizedId),
      createdAt: stat.birthtimeMs || stat.ctimeMs,
      updatedAt: stat.mtimeMs,
      position: this.positionOf(this.order, normalizedId, parentOf(normalizedId)),
      content,
    }
  }

  async create(input: CreateNoteInput = {}): Promise<Note> {
    const parentId = this.normalizeParentId(input.parentId)
    if (parentId && !(await this.exists(parentId))) {
      throw new Error('Родительская заметка не найдена')
    }

    const title = input.title?.trim() || 'Без названия'
    const id = await this.uniqueId(parentId)
    const content = input.content ?? `# ${title}\n\n`
    await this.writeFile(id, content)
    await this.insertOrder(id, parentId, 0)
    return this.read(id)
  }

  async save(id: string, content: string): Promise<NoteMeta> {
    await this.writeFile(id, content)
    const { content: _content, ...meta } = await this.read(id)
    return meta
  }

  async move(id: string, parentId: string | null, index = 0): Promise<NoteMeta> {
    const sourceId = this.toId(id)
    const targetParent = this.normalizeParentId(parentId)
    const targetIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0

    if (!(await this.exists(sourceId))) throw new Error('Заметка не найдена')
    if (targetParent) {
      if (targetParent === sourceId || targetParent.startsWith(`${sourceId}/`)) {
        throw new Error('Нельзя переместить заметку внутрь самой себя')
      }
      if (!(await this.exists(targetParent))) throw new Error('Родительская заметка не найдена')
    }

    const name = sourceId.split('/').pop()
    if (!name) throw new Error('Некорректный идентификатор заметки')
    const targetId = targetParent ? `${targetParent}/${name}` : name
    const order = await this.ensureOrder(await this.readAllNotes())

    if (targetId === sourceId) {
      const parentKey = parentOf(sourceId) ?? ROOT_GROUP
      const group = order.get(parentKey) ?? []
      const currentIndex = group.indexOf(sourceId)
      if (currentIndex >= 0) {
        const insertAt = currentIndex < targetIndex ? targetIndex - 1 : targetIndex
        group.splice(currentIndex, 1)
        group.splice(Math.max(0, Math.min(insertAt, group.length)), 0, sourceId)
        order.set(parentKey, group)
        await this.writeOrder(order)
      }
      const { content: _content, ...meta } = await this.read(sourceId)
      return meta
    }

    if (await this.exists(targetId)) throw new Error('Заметка с таким именем уже существует')

    const sourceFile = this.toAbsolute(sourceId)
    const targetFile = this.toAbsolute(targetId)
    const sourceDir = path.dirname(sourceFile)
    const targetDir = path.dirname(targetFile)
    const targetParentDir = path.dirname(targetDir)

    if (await isDirectory(targetDir)) throw new Error('Папка назначения уже существует')

    await fs.mkdir(targetParentDir, { recursive: true })
    try {
      await fs.rename(sourceDir, targetDir)
    } catch (error) {
      try {
        await movePath(sourceDir, targetDir)
      } catch (moveError) {
        await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
        throw moveError
      }
    }

    const remapped: NoteOrder = new Map()
    for (const [key, ids] of order) {
      remapped.set(
        remapSubtreeId(key, sourceId, targetId),
        ids.map((entry) => remapSubtreeId(entry, sourceId, targetId)),
      )
    }

    const sourceParentKey = parentOf(sourceId) ?? ROOT_GROUP
    const sourceGroup = remapped.get(sourceParentKey) ?? []
    const oldIndex = sourceGroup.indexOf(sourceId)
    if (oldIndex >= 0) sourceGroup.splice(oldIndex, 1)
    if (sourceGroup.length) remapped.set(sourceParentKey, sourceGroup)
    else remapped.delete(sourceParentKey)

    const targetParentKey = targetParent ?? ROOT_GROUP
    const targetGroup = remapped.get(targetParentKey) ?? []
    const insertAt = Math.max(0, Math.min(targetIndex, targetGroup.length))
    targetGroup.splice(insertAt, 0, targetId)
    remapped.set(targetParentKey, targetGroup)

    this.order = remapped
    await this.writeOrder(remapped)

    const { content: _content, ...meta } = await this.read(targetId)
    return meta
  }

  async duplicate(id: string): Promise<Note> {
    const note = await this.read(id)
    return this.create({ parentId: note.parentId, content: note.content })
  }

  async remove(id: string): Promise<void> {
    const normalizedId = this.toId(id)
    const absolute = this.toAbsolute(normalizedId)
    const directory = path.dirname(absolute)
    const vaultRoot = path.resolve(this.root)
    if (directory === vaultRoot || isOutside(this.root, directory)) {
      throw new Error(`Путь вне vault: ${id}`)
    }
    await fs.rm(absolute, { force: true })
    try {
      await fs.rmdir(directory)
    } catch {
      // ignore non-empty directory (assets)
    }
    await this.ensureOrder(await this.readAllNotes())
  }

  /**
   * Переносит всё содержимое текущего vault в пустую папку и делает её новым
   * корнем. При ошибке уже перенесённые записи возвращаются обратно.
   */
  async moveTo(targetDir: string): Promise<string> {
    const source = await fs.realpath(this.root)

    let target: string
    try {
      target = await fs.realpath(path.resolve(targetDir))
    } catch {
      throw new VaultMoveError('not-directory')
    }
    if (!(await fs.stat(target)).isDirectory()) throw new VaultMoveError('not-directory')
    if (source === target) throw new VaultMoveError('same')
    if (isInside(source, target)) throw new VaultMoveError('inside')
    if (isInside(target, source)) throw new VaultMoveError('ancestor')
    if ((await fs.readdir(target)).length > 0) throw new VaultMoveError('not-empty')

    const entries = await fs.readdir(source, { withFileTypes: true })
    const moved: Array<{ from: string; to: string }> = []

    try {
      for (const entry of entries) {
        const from = path.join(source, entry.name)
        const to = path.join(target, entry.name)
        await movePath(from, to)
        moved.push({ from, to })
      }
    } catch (error) {
      for (const item of moved.reverse()) {
        await movePath(item.to, item.from).catch((rollbackError) => {
          console.error('[vault] Не удалось откатить перенос хранилища:', rollbackError)
        })
      }
      throw error
    }

    this.root = target
    return target
  }

  private async readAllNotes(): Promise<Note[]> {
    const ids = await this.walk('')
    const notes = await Promise.all(ids.map((id) => this.read(id).catch(() => null)))
    return notes.filter((note): note is Note => note !== null)
  }

  private async ensureOrder(notes: Note[]): Promise<NoteOrder> {
    if (!this.order) this.order = await this.readOrder()

    const byParent = new Map<string, Note[]>()
    for (const note of notes) {
      const key = note.parentId ?? ROOT_GROUP
      const siblings = byParent.get(key)
      if (siblings) siblings.push(note)
      else byParent.set(key, [note])
    }

    const next: NoteOrder = new Map()
    if (this.order) {
      for (const [key, ids] of this.order) {
        const siblings = byParent.get(key) ?? []
        const allowed = new Set(siblings.map((note) => note.id))
        const seen = new Set<string>()
        const kept: string[] = []
        for (const id of ids) {
          if (!allowed.has(id) || seen.has(id)) continue
          seen.add(id)
          kept.push(id)
        }
        const missing = siblings
          .filter((note) => !seen.has(note.id))
          .sort(compareUpdated)
          .map((note) => note.id)
        if (kept.length || missing.length) next.set(key, [...missing, ...kept])
      }
      for (const [key, siblings] of byParent) {
        if (!next.has(key)) {
          next.set(key, [...siblings].sort(compareUpdated).map((note) => note.id))
        }
      }
    } else {
      for (const [key, siblings] of byParent) {
        next.set(key, [...siblings].sort(compareUpdated).map((note) => note.id))
      }
    }

    const changed = !this.order || !sameOrder(this.order, next)
    this.order = next
    if (changed) await this.writeOrder(next)
    return next
  }

  private async readOrder(): Promise<NoteOrder | null> {
    try {
      const raw = await fs.readFile(path.join(this.root, ORDER_FILE), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object') return null
      const groups = (parsed as { groups?: unknown }).groups
      if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return null

      const order: NoteOrder = new Map()
      for (const [key, value] of Object.entries(groups)) {
        if (!Array.isArray(value)) continue
        order.set(key, value.filter((id): id is string => typeof id === 'string'))
      }
      return order
    } catch {
      return null
    }
  }

  private async writeOrder(order: NoteOrder): Promise<void> {
    const groups: Record<string, string[]> = {}
    for (const [key, ids] of order) groups[key] = [...ids]
    const file = path.join(this.root, ORDER_FILE)
    const temp = `${file}.tmp`
    await fs.writeFile(temp, `${JSON.stringify({ version: ORDER_VERSION, groups }, null, 2)}\n`, 'utf8')
    await fs.rename(temp, file)
  }

  private async insertOrder(id: string, parentId: string | null, index: number): Promise<void> {
    const order = await this.ensureOrder(await this.readAllNotes())
    const key = parentId ?? ROOT_GROUP
    const group = (order.get(key) ?? []).filter((entry) => entry !== id)
    const target = Math.max(0, Math.min(Math.trunc(index), group.length))
    group.splice(target, 0, id)
    order.set(key, group)
    await this.writeOrder(order)
  }


  private async migrateLegacy(): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await fs.readdir(this.root, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(NOTE_EXTENSION)) continue
      if (entry.name === NOTE_FILENAME) continue
      if (entry.name.startsWith('.')) continue
      const base = entry.name.slice(0, -NOTE_EXTENSION.length)
      if (!base) continue
      const src = path.join(this.root, entry.name)
      const dir = path.join(this.root, base)
      const dst = path.join(dir, NOTE_FILENAME)
      try {
        await fs.access(dst)
        continue
      } catch {}
      try {
        await fs.mkdir(dir, { recursive: true })
        await fs.rename(src, dst)
      } catch (error) {
        try {
          await movePath(src, dst)
        } catch {
          // skip
        }
      }
    }

    // migrate order keys if they pointed to .md style
    try {
      const raw = await fs.readFile(path.join(this.root, ORDER_FILE), 'utf8')
      const parsed = JSON.parse(raw) as { version?: number; groups?: Record<string, string[]> }
      if (parsed?.groups) {
        let changed = false
        const groups: Record<string, string[]> = {}
        for (const [key, ids] of Object.entries(parsed.groups)) {
          groups[key] = ids.map((id) => {
            if (id.endsWith(NOTE_EXTENSION) && id !== NOTE_FILENAME) {
              changed = true
              return id.slice(0, -NOTE_EXTENSION.length)
            }
            return id
          })
        }
        if (changed) {
          const file = path.join(this.root, ORDER_FILE)
          const temp = `${file}.tmp`
          await fs.writeFile(temp, `${JSON.stringify({ version: ORDER_VERSION, groups }, null, 2)}\n`, 'utf8')
          await fs.rename(temp, file)
        }
      }
    } catch {}
  }

  private positionOf(order: NoteOrder | null, id: string, parentId: string | null): number {
    if (!order) return 0
    const index = order.get(parentId ?? ROOT_GROUP)?.indexOf(id) ?? -1
    return index >= 0 ? index : 0
  }

  private async writeFile(id: string, content: string): Promise<void> {
    const absolute = this.toAbsolute(id)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    const temp = `${absolute}.tmp`
    await fs.writeFile(temp, content, 'utf8')
    await fs.rename(temp, absolute)
  }

  private async walk(relativeDir: string): Promise<string[]> {
    const absoluteDir = path.join(this.root, relativeDir)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    } catch {
      return []
    }

    const result: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORED_DIRECTORIES.has(entry.name)) continue
      if (!entry.isDirectory() || entry.name === ASSETS_DIR) continue

      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
      const notePath = path.join(absoluteDir, entry.name, NOTE_FILENAME)
      try {
        await fs.access(notePath)
        result.push(relativePath)
      } catch {
        // not a note directory: only recurse to find nested notes
      }
      result.push(...(await this.walk(relativePath)))
    }
    return result
  }

  private async uniqueId(parentId: string | null = null): Promise<string> {
    const prefix = parentId ? `${parentId}/` : ''
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = `${prefix}${generateId()}`
      if (!(await this.exists(candidate))) return candidate
    }
    throw new Error('Не удалось сгенерировать уникальное имя заметки')
  }

  private normalizeParentId(parentId: string | null | undefined): string | null {
    if (parentId === null || parentId === undefined) return null
    const normalized = this.toId(String(parentId).trim())
    return normalized || null
  }

  private async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.toAbsolute(id))
      return true
    } catch {
      return false
    }
  }

  private toId(id: string): string {
    return String(id).replace(/\\/g, '/').replace(/\.md$/i, '')
  }

  private toAbsolute(id: string): string {
    const normalized = this.toId(id).trim()
    if (!normalized) throw new Error('Пустой идентификатор заметки')
    const segments = normalized.split('/')
    if (
      path.isAbsolute(normalized) ||
      segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error(`Недопустимый идентификатор заметки: ${id}`)
    }

    const absolute = path.resolve(this.root, normalized, NOTE_FILENAME)
    if (isOutside(this.root, absolute)) {
      throw new Error(`Путь вне vault: ${id}`)
    }
    return absolute
  }
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Генерирует уникальное имя файла заметки:
 * - только латиница (a-z) и цифры;
 * - без пробелов и символов, недопустимых в именах файлов;
 * - временная метка + случайный суффикс для практической неповторяемости.
 */
function generateId(): string {
  const timestamp = Date.now().toString(36)
  const random = randomToken(8)
  return `note-${timestamp}-${random}`
}

function randomToken(length: number): string {
  const bytes = crypto.randomBytes(length)
  let token = ''
  for (let i = 0; i < length; i++) {
    token += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  }
  return token
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

function isOutside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
}

function isInside(parent: string, child: string): boolean {
  return path.relative(parent, child) !== '' && !isOutside(parent, child)
}

async function movePath(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await fs.rm(from, { recursive: true, force: true })
  }
}

function parentOf(id: string): string | null {
  const index = id.lastIndexOf('/')
  return index < 0 ? null : id.slice(0, index)
}

function compareUpdated(a: Note, b: Note): number {
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
}

function sameOrder(a: NoteOrder, b: NoteOrder): boolean {
  if (a.size !== b.size) return false
  for (const [key, ids] of a) {
    const other = b.get(key)
    if (!other || other.length !== ids.length) return false
    if (other.some((id, index) => id !== ids[index])) return false
  }
  return true
}

function remapSubtreeId(id: string, sourceId: string, targetId: string): string {
  if (id === sourceId) return targetId
  if (id.startsWith(`${sourceId}/`)) return `${targetId}${id.slice(sourceId.length)}`
  return id
}

function extractTitle(content: string, id: string): string {
  const heading = content.match(/^\s*#\s+(.+?)\s*$/m)
  if (heading?.[1]) return heading[1].trim()
  return id.split('/').pop() || id
}
