export const IPC = {
  appInfo: 'app:info',
  appRevealVault: 'app:revealVault',
  appChangeVault: 'app:changeVault',
  notesList: 'notes:list',
  notesRead: 'notes:read',
  notesCreate: 'notes:create',
  notesSave: 'notes:save',
  notesRemove: 'notes:remove',
  notesMove: 'notes:move',
  notesDuplicate: 'notes:duplicate',
  notesSaveAsset: 'notes:saveAsset',
  notesPruneAssets: 'notes:pruneAssets',
  searchQuery: 'search:query',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  filesExport: 'files:export',
  filesImport: 'files:import',
} as const

export type AppLanguage = 'ru' | 'en'

export const APP_ACCENTS = [
  'violet',
  'violet-reverse',
  'warm',
  'ocean',
  'ocean-reverse',
  'emerald',
  'emerald-reverse',
  'berry',
  'berry-reverse',
  'royal',
  'royal-reverse',
  'sunset',
  'sunset-reverse',
] as const

export type AppAccent = (typeof APP_ACCENTS)[number]

export interface AppSettings {
  language: AppLanguage
  accent: AppAccent
  vaultPath: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  accent: 'violet',
  vaultPath: null,
}

export interface NoteMeta {
  id: string
  title: string
  parentId: string | null
  createdAt: number
  updatedAt: number
  position: number
}

export interface Note extends NoteMeta {
  content: string
}

export interface TocHeading {
  level: number
  text: string
}

export interface CreateNoteInput {
  title?: string
  content?: string
  parentId?: string | null
}

export interface AppInfo {
  vaultPath: string
  indexDbPath: string | null
  indexDbReady: boolean
}

export interface ChangeVaultResult {
  canceled: boolean
  vaultPath: string | null
}

export interface NotesApi {
  list: () => Promise<NoteMeta[]>
  read: (id: string) => Promise<Note>
  create: (input?: CreateNoteInput) => Promise<Note>
  save: (id: string, content: string) => Promise<NoteMeta>
  move: (id: string, parentId: string | null, index?: number) => Promise<NoteMeta>
  duplicate: (id: string) => Promise<Note>
  remove: (id: string) => Promise<void>
  saveAsset: (noteId: string, mime: string, data: ArrayBuffer) => Promise<SavedAsset>
  pruneAssets: (noteId: string) => Promise<void>
}

export interface SearchHit {
  id: string
  title: string
  snippet: string
  updatedAt: number
}

export interface SearchApi {
  query: (query: string, limit?: number) => Promise<SearchHit[]>
}

export interface SettingsApi {
  get: () => Promise<AppSettings>
  set: (patch: Partial<AppSettings>) => Promise<AppSettings>
}

export type ExportFormat = 'txt' | 'pdf' | 'docx' | 'md'

export interface ExportNoteInput {
  title: string
  content: string
  language: AppLanguage
  noteId?: string | null
}

export interface ExportResult {
  canceled: boolean
  filePath: string | null
}

export interface ImportResult {
  canceled: boolean
  filePath: string | null
  title: string
  content: string
}

export interface SavedAsset {
  path: string
  url: string
  mime: string
  size: number
}

export interface FilesApi {
  exportNote: (format: ExportFormat, input: ExportNoteInput) => Promise<ExportResult>
  importDocument: (language: AppLanguage) => Promise<ImportResult>
}

export interface RendererApi {
  app: {
    info: () => Promise<AppInfo>
    revealVault: () => Promise<void>
    changeVault: () => Promise<ChangeVaultResult>
  }
  notes: NotesApi
  search: SearchApi
  settings: SettingsApi
  files: FilesApi
}
