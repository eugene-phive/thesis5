import { app, dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { ChangeVaultResult } from '../shared/api'
import { resolveMessage, type MessageKey } from '../shared/i18n'
import { syncIndex } from './index-db'
import type { Settings } from './settings'
import { VaultMoveError, type Vault, type VaultMoveErrorCode } from './vault'

const ERROR_KEYS: Record<VaultMoveErrorCode, MessageKey> = {
  same: 'settings.error.same',
  inside: 'settings.error.inside',
  ancestor: 'settings.error.ancestor',
  'not-directory': 'settings.error.notDirectory',
  'not-empty': 'settings.error.notEmpty',
}

export async function changeVault(
  win: BrowserWindow | null,
  vault: Vault,
  settings: Settings,
): Promise<ChangeVaultResult> {
  const language = settings.get().language
  const options: OpenDialogOptions = {
    title: resolveMessage(language, 'settings.dialog.pick'),
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  }
  const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const target = picked.filePaths[0]
  if (picked.canceled || !target) return { canceled: true, vaultPath: null }

  const confirmOptions = {
    type: 'question' as const,
    title: resolveMessage(language, 'settings.title'),
    message: resolveMessage(language, 'settings.confirmMove', { path: target }),
    buttons: [
      resolveMessage(language, 'settings.confirmMoveAction'),
      resolveMessage(language, 'action.cancel'),
    ],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const confirmation = win
    ? await dialog.showMessageBox(win, confirmOptions)
    : await dialog.showMessageBox(confirmOptions)
  if (confirmation.response !== 0) return { canceled: true, vaultPath: null }

  const previous = vault.path

  try {
    await vault.moveTo(target)
  } catch (error) {
    if (error instanceof VaultMoveError) {
      throw new Error(resolveMessage(language, ERROR_KEYS[error.code]))
    }
    throw new Error(
      resolveMessage(language, 'settings.error.moveFailed', {
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  try {
    await settings.set({ vaultPath: vault.path })
  } catch (error) {
    await vault.moveTo(previous).catch((rollbackError) => {
      console.error('[vault] Не удалось откатить перенос после ошибки настроек:', rollbackError)
    })
    await settings.set({ vaultPath: previous }).catch(() => undefined)
    throw error
  }

  try {
    await vault.init()
    syncIndex(await vault.listAll())
  } catch (error) {
    console.warn('[vault] Хранилище перемещено, но индекс не обновлён:', error)
  }

  return { canceled: false, vaultPath: vault.path }
}
