import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { Note } from '../shared/api'

const MANAGED_ASSET = /^img-[a-z0-9]+-[a-z0-9]+\.(?:png|jpe?g|webp|gif)$/i

function resolveAssetsDir(vaultPath: string, noteId: string): string {
  if (!noteId || path.isAbsolute(noteId)) throw new Error('Некорректный ID заметки')

  const root = path.resolve(vaultPath)
  const noteDir = path.resolve(root, noteId)
  const relative = path.relative(root, noteDir)

  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Некорректный ID заметки')
  }

  return path.join(noteDir, 'assets')
}

export async function pruneUnusedAssets(
  vaultPath: string,
  noteId: string,
  savedContent: string,
): Promise<string[]> {
  const assetsDir = resolveAssetsDir(vaultPath, noteId)
  let entries: Dirent[]

  try {
    entries = await fs.readdir(assetsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const removed: string[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !MANAGED_ASSET.test(entry.name)) continue
    if (savedContent.includes(`assets/${entry.name}`)) continue

    try {
      await fs.unlink(path.join(assetsDir, entry.name))
      removed.push(entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  await fs.rmdir(assetsDir).catch(() => undefined)
  return removed
}

export async function pruneAllAssets(
  vaultPath: string,
  notes: ReadonlyArray<Pick<Note, 'id' | 'content'>>,
): Promise<void> {
  for (const note of notes) {
    try {
      await pruneUnusedAssets(vaultPath, note.id, note.content)
    } catch (error) {
      console.error(`Не удалось очистить ассеты заметки ${note.id}:`, error)
    }
  }
}
