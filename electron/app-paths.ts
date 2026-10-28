import { app } from 'electron'
import { promises as fs, cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Settings } from './settings'

const DEV_DATA_DIR = '_thesis5_temp'
const PACKAGED_DATA_DIR = 'data'
const LEGACY_APP_ENTRIES = [
  'settings.json',
  'settings.json.tmp',
  'index.db',
  'index.db-wal',
  'index.db-shm',
  'vault',
]

export interface AppDataPaths {
  root: string
  vault: string
  temp: string
  sessionData: string
  logs: string
  crashDumps: string
  cache: string
  legacyRoot: string | null
}

export function configureAppDataPaths(): AppDataPaths {
  const legacyRoot = app.getPath('userData')
  const root = app.isPackaged
    ? path.join(path.dirname(app.getPath('exe')), PACKAGED_DATA_DIR)
    : path.join(app.getAppPath(), DEV_DATA_DIR)

  mkdirSync(root, { recursive: true })
  migrateLegacyData(legacyRoot, root)

  const paths: AppDataPaths = {
    root,
    vault: path.join(root, 'vault'),
    temp: path.join(root, 'temp'),
    sessionData: path.join(root, 'session'),
    logs: path.join(root, 'logs'),
    crashDumps: path.join(root, 'crashDumps'),
    cache: path.join(root, 'cache'),
    legacyRoot: samePath(legacyRoot, root) ? null : legacyRoot,
  }

  for (const dir of [paths.temp, paths.sessionData, paths.logs, paths.crashDumps, paths.cache]) {
    mkdirSync(dir, { recursive: true })
  }

  app.setPath('userData', paths.root)
  app.setPath('sessionData', paths.sessionData)
  app.setPath('logs', paths.logs)
  app.setPath('crashDumps', paths.crashDumps)
  app.setPath('cache', paths.cache)
  app.setPath('temp', paths.temp)

  return paths
}

export async function resolveVaultPath(settings: Settings, paths: AppDataPaths): Promise<string> {
  const configured = settings.get().vaultPath
  if (!configured) return paths.vault

  const configuredPath = path.resolve(configured)

  if (samePath(configuredPath, paths.root)) {
    await settings.set({ vaultPath: paths.vault })
    return paths.vault
  }

  if (paths.legacyRoot && isPathInside(configuredPath, paths.legacyRoot)) {
    const remapped = path.join(paths.root, path.relative(paths.legacyRoot, configuredPath))
    if (await isDirectory(remapped)) {
      await settings.set({ vaultPath: remapped })
      return remapped
    }
  }

  if (await isDirectory(configuredPath)) return configuredPath

  console.warn(`[app-data] Папка хранилища не найдена, используется стандартная: ${paths.vault}`)
  await settings.set({ vaultPath: paths.vault })
  return paths.vault
}

export function isPathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(normalizeForCompare(parent), normalizeForCompare(candidate))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function samePath(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b)
}

function migrateLegacyData(legacyRoot: string, root: string): void {
  if (samePath(legacyRoot, root) || !existsSync(legacyRoot)) return

  if (!hasAppData(root)) {
    try {
      for (const name of LEGACY_APP_ENTRIES) {
        const from = path.join(legacyRoot, name)
        const to = path.join(root, name)
        if (!existsSync(from) || existsSync(to)) continue
        movePath(from, to)
      }
      console.log(`[app-data] Данные из ${legacyRoot} перенесены в ${root}`)
    } catch (error) {
      console.error('[app-data] Не удалось перенести старые данные приложения:', error)
    }
  }

  if (hasAppData(legacyRoot)) return

  try {
    rmSync(legacyRoot, { recursive: true, force: true })
  } catch (error) {
    console.warn('[app-data] Старую папку данных пока нельзя удалить:', error)
  }
}

function hasAppData(root: string): boolean {
  return ['settings.json', 'index.db', 'vault'].some((name) => existsSync(path.join(root, name)))
}

function movePath(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    cpSync(from, to, { recursive: true, preserveTimestamps: true })
    rmSync(from, { recursive: true, force: true })
  }
}

async function isDirectory(value: string): Promise<boolean> {
  try {
    return (await fs.stat(value)).isDirectory()
  } catch {
    return false
  }
}
