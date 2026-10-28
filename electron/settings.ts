import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppAccent, AppLanguage, AppSettings } from '../shared/api'
import { APP_ACCENTS, DEFAULT_SETTINGS } from '../shared/api'

const SETTINGS_FILE = 'settings.json'
const LANGUAGES: AppLanguage[] = ['ru', 'en']

/**
 * Хранилище пользовательских настроек: JSON-файл в app data root
 * (см. electron/app-paths.ts), чтобы выбор пользователя сохранялся
 * между запусками и переезжал вместе с папкой данных.
 */
export class Settings {
  private readonly file: string
  private cached: AppSettings = { ...DEFAULT_SETTINGS }

  constructor(private readonly root: string) {
    this.file = path.join(root, SETTINGS_FILE)
  }

  async init(): Promise<void> {
    this.cached = await this.read()
  }

  get(): AppSettings {
    return { ...this.cached }
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.cached = sanitize({ ...this.cached, ...patch })
    const temp = `${this.file}.tmp`
    await fs.writeFile(temp, JSON.stringify(this.cached, null, 2), 'utf8')
    await fs.rename(temp, this.file)
    return { ...this.cached }
  }

  private async read(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      return sanitize(JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<AppSettings>)
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }
}

function sanitize(input: Partial<AppSettings>): AppSettings {
  const language = LANGUAGES.includes(input.language as AppLanguage)
    ? (input.language as AppLanguage)
    : DEFAULT_SETTINGS.language
  const accent = (APP_ACCENTS as readonly string[]).includes(input.accent as string)
    ? (input.accent as AppAccent)
    : DEFAULT_SETTINGS.accent
  const vaultPath =
    typeof input.vaultPath === 'string' &&
    input.vaultPath.trim() &&
    path.isAbsolute(input.vaultPath)
      ? path.normalize(input.vaultPath)
      : null
  return { language, accent, vaultPath }
}
