import { BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  APP_ACCENTS,
  IPC,
  type AppAccent,
  type AppInfo,
  type AppLanguage,
  type AppSettings,
  type ChangeVaultResult,
  type CreateNoteInput,
  type ExportFormat,
  type ExportNoteInput,
  type ExportResult,
  type ImportResult,
  type Note,
  type NoteMeta,
  type SavedAsset,
  type SearchHit,
} from '../shared/api'
import { pruneUnusedAssets } from './asset-files'
import { exportNote, importDocument } from './files'
import { getIndexPath, isIndexReady, searchIndex, searchNotesInMemory, syncIndex } from './index-db'
import type { Settings } from './settings'
import type { Vault } from './vault'
import { changeVault } from './vault-switch'

const pendingNoteWrites = new Set<Promise<unknown>>()

export async function waitForPendingNoteWrites(): Promise<void> {
  while (pendingNoteWrites.size > 0) {
    await Promise.allSettled([...pendingNoteWrites])
  }
}

function trackNoteWrite<T>(promise: Promise<T>): Promise<T> {
  pendingNoteWrites.add(promise)
  void promise.then(
    () => pendingNoteWrites.delete(promise),
    () => pendingNoteWrites.delete(promise),
  )
  return promise
}

export function registerIpcHandlers(vault: Vault, settings: Settings): void {
  ipcMain.handle(IPC.appInfo, (event): AppInfo => {
    assertTrustedSender(event)
    return {
      vaultPath: vault.path,
      indexDbPath: getIndexPath(),
      indexDbReady: isIndexReady(),
    }
  })

  ipcMain.handle(IPC.settingsGet, (event): AppSettings => {
    assertTrustedSender(event)
    return settings.get()
  })

  ipcMain.handle(IPC.appRevealVault, async (event): Promise<void> => {
    assertTrustedSender(event)
    const error = await shell.openPath(vault.path)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC.appChangeVault, async (event): Promise<ChangeVaultResult> => {
    assertTrustedSender(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    return changeVault(win, vault, settings)
  })

  ipcMain.handle(IPC.settingsSet, async (event, patch: unknown): Promise<AppSettings> => {
    assertTrustedSender(event)
    return settings.set(assertSettingsPatch(patch))
  })

  ipcMain.handle(IPC.notesList, async (event): Promise<NoteMeta[]> => {
    assertTrustedSender(event)
    return vault.list()
  })

  ipcMain.handle(IPC.notesRead, async (event, id: unknown): Promise<Note> => {
    assertTrustedSender(event)
    return vault.read(assertNoteId(id))
  })

  ipcMain.handle(
    IPC.searchQuery,
    async (event, query: unknown, limit: unknown): Promise<SearchHit[]> => {
      assertTrustedSender(event)
      const normalized = assertSearchQuery(query)
      const max = assertSearchLimit(limit)
      const indexed = searchIndex(normalized, max)
      if (indexed) return indexed
      return searchNotesInMemory(await vault.listAll(), normalized, max)
    },
  )

  ipcMain.handle(IPC.notesCreate, async (event, input: unknown): Promise<Note> => {
    assertTrustedSender(event)
    const note = await vault.create(assertCreateInput(input))
    await refreshIndex(vault)
    return note
  })

  ipcMain.handle(IPC.notesSave, async (event, id: unknown, content: unknown): Promise<NoteMeta> => {
    assertTrustedSender(event)
    if (typeof content !== 'string') throw new TypeError('Содержимое заметки должно быть строкой')
    const noteId = assertNoteId(id)
    return trackNoteWrite((async () => {
      const meta = await vault.save(noteId, content)
      await refreshIndex(vault)
      return meta
    })())
  })

  ipcMain.handle(IPC.notesRemove, async (event, id: unknown): Promise<void> => {
    assertTrustedSender(event)
    await vault.remove(assertNoteId(id))
    await refreshIndex(vault)
  })

  ipcMain.handle(
    IPC.notesMove,
    async (event, id: unknown, parentId: unknown, index: unknown): Promise<NoteMeta> => {
      assertTrustedSender(event)
      const meta = await vault.move(
        assertNoteId(id),
        assertParentId(parentId),
        assertMoveIndex(index),
      )
      await refreshIndex(vault)
      return meta
    },
  )

  ipcMain.handle(IPC.notesDuplicate, async (event, id: unknown): Promise<Note> => {
    assertTrustedSender(event)
    const note = await vault.duplicate(assertNoteId(id))
    await refreshIndex(vault)
    return note
  })

  ipcMain.handle(
    IPC.notesSaveAsset,
    async (event, noteId: unknown, mime: unknown, data: unknown): Promise<SavedAsset> => {
      assertTrustedSender(event)
      const id = assertNoteId(noteId)
      if (typeof mime !== 'string') throw new Error('Некорректный MIME-тип')
      if (!(data instanceof ArrayBuffer)) throw new Error('Некорректные данные изображения')
      return saveAsset(vault, id, mime, data)
    },
  )

  ipcMain.handle(
    IPC.notesPruneAssets,
    async (event, noteId: unknown): Promise<void> => {
      assertTrustedSender(event)
      const id = assertNoteId(noteId)
      await waitForPendingNoteWrites()
      const note = await vault.read(id)
      await pruneUnusedAssets(vault.path, id, note.content)
    },
  )

  ipcMain.handle(
    IPC.filesExport,
    async (event, format: unknown, input: unknown): Promise<ExportResult> => {
      assertTrustedSender(event)
      const win = BrowserWindow.fromWebContents(event.sender)
      return exportNote(win, assertExportFormat(format), assertExportInput(input))
    },
  )

  ipcMain.handle(IPC.filesImport, async (event, language: unknown): Promise<ImportResult> => {
    assertTrustedSender(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    return importDocument(win, assertLanguage(language))
  })
}

async function refreshIndex(vault: Vault): Promise<void> {
  syncIndex(await vault.listAll())
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const devServerUrl = process.env.VITE_DEV_SERVER_URL

  if (devServerUrl) {
    try {
      if (url.startsWith(new URL(devServerUrl).origin)) return
    } catch {
      // некорректный URL dev-сервера игнорируем
    }
  }
  if (url.startsWith('file://')) return

  throw new Error(`IPC-запрос из недоверенного источника: ${url || 'unknown'}`)
}

function assertNoteId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Некорректный идентификатор заметки')
  return id
}

function assertSearchQuery(query: unknown): string {
  if (typeof query !== 'string') throw new TypeError('Поисковый запрос должен быть строкой')
  const normalized = query.trim()
  if (!normalized) throw new TypeError('Поисковый запрос не может быть пустым')
  if (normalized.length > 200) throw new TypeError('Поисковый запрос слишком длинный')
  return normalized
}

function assertSearchLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return 30
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('Некорректный лимит результатов поиска')
  }
  return limit
}

function assertCreateInput(input: unknown): CreateNoteInput {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object') throw new TypeError('Некорректные данные заметки')

  const { title, content, parentId } = input as Record<string, unknown>
  return {
    title: typeof title === 'string' ? title : undefined,
    content: typeof content === 'string' ? content : undefined,
    parentId: parentId === null || parentId === undefined
      ? null
      : assertParentId(parentId),
  }
}

function assertParentId(parentId: unknown): string | null {
  if (parentId === null || parentId === undefined) return null
  if (typeof parentId !== 'string' || !parentId.trim()) {
    throw new TypeError('Некорректный идентификатор родительской заметки')
  }
  return parentId
}

function assertMoveIndex(index: unknown): number {
  if (index === null || index === undefined) return 0
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 100_000) {
    throw new TypeError('Некорректная позиция заметки')
  }
  return index
}

const ALLOWED_MIMES = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

const MAX_ASSET_SIZE = 10 * 1024 * 1024

function getExtension(mime: string): string | null {
  return ALLOWED_MIMES.get(mime) ?? null
}

function verifySignature(buffer: Buffer, mime: string): boolean {
  if (buffer.length < 4) return false
  if (mime === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  }
  if (mime === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mime === 'image/gif') {
    return buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38
  }
  if (mime === 'image/webp') {
    if (buffer.length < 12) return false
    return (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    )
  }
  return false
}

function randomToken(length: number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = randomBytes(length)
  let token = ''
  for (let i = 0; i < length; i++) token += alphabet[bytes[i] % alphabet.length]
  return token
}

async function saveAsset(vault: Vault, noteId: string, mime: string, data: ArrayBuffer): Promise<SavedAsset> {
  const ext = getExtension(mime)
  if (!ext) throw new Error('Неподдерживаемый тип изображения')
  const buffer = Buffer.from(data)
  if (buffer.length === 0) throw new Error('Пустой файл изображения')
  if (buffer.length > MAX_ASSET_SIZE) throw new Error('Изображение слишком большое (макс. 10 МиБ)')
  if (!verifySignature(buffer, mime)) throw new Error('Некорректный формат изображения')

  await vault.read(noteId)

  const noteDir = path.resolve(vault.path, noteId)
  const assetsDir = path.join(noteDir, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })

  const filename = `img-${Date.now().toString(36)}-${randomToken(8)}.${ext}`
  const target = path.join(assetsDir, filename)
  const temp = `${target}.tmp`

  try {
    await fs.writeFile(temp, buffer)
    await fs.rename(temp, target)
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }

  const relativePath = `assets/${filename}`
  const url = `thesis-asset://asset/${encodeURIComponent(noteId)}/${encodeURIComponent(filename)}`
  return { path: relativePath, url, mime, size: buffer.length }
}

function assertExportFormat(format: unknown): ExportFormat {  if (format === 'txt' || format === 'pdf' || format === 'docx' || format === 'md') return format
  throw new TypeError('Неподдерживаемый формат экспорта')
}

function assertLanguage(language: unknown): AppLanguage {
  if (language === 'ru' || language === 'en') return language
  throw new TypeError('Некорректный язык')
}

function assertExportInput(input: unknown): ExportNoteInput {
  if (input === undefined || input === null || typeof input !== 'object') {
    throw new TypeError('Некорректные данные для экспорта')
  }

  const { title, content, language } = input as Record<string, unknown>
  if (typeof title !== 'string') throw new TypeError('Некорректный заголовок заметки')
  if (typeof content !== 'string') throw new TypeError('Содержимое заметки должно быть строкой')
  if (content.length > 20_000_000) throw new Error('Заметка слишком большая для экспорта')

  return { title, content, language: assertLanguage(language) }
}

function assertSettingsPatch(input: unknown): Partial<AppSettings> {
  if (input === undefined || input === null || typeof input !== 'object') {
    throw new TypeError('Некорректные настройки')
  }

  const { language, accent } = input as Record<string, unknown>
  const patch: Partial<AppSettings> = {}
  if (language === 'ru' || language === 'en') patch.language = language
  if (typeof accent === 'string' && (APP_ACCENTS as readonly string[]).includes(accent)) {
    patch.accent = accent as AppAccent
  }
  return patch
}
