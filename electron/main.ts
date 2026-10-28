// electron/main.ts
import { app, BrowserWindow, nativeImage, session } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureAppDataPaths, resolveVaultPath } from './app-paths'
import { registerAssetProtocol, registerAssetScheme } from './asset-protocol'
import { pruneAllAssets } from './asset-files'
import { initIndexDatabase, syncIndex } from './index-db'
import { registerIpcHandlers, waitForPendingNoteWrites } from './ipc'
import { Settings } from './settings'
import { Vault } from './vault'

registerAssetScheme()

app.setName('Thesis 5')

if (process.platform === 'win32') {
    app.setAppUserModelId('com.thesis5.app')
}

const appData = configureAppDataPaths()

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const devServerUrl = process.env.VITE_DEV_SERVER_URL

let cleanupVault: Vault | null = null
let quitCleanupDone = false
let quitCleanupRunning = false


function resolveIconPath(): string | undefined {
    const candidates = [
        path.join(process.cwd(), 'public', 'favicon.ico'),
        path.join(process.cwd(), 'public', 'favicon.png'),
        path.join(process.cwd(), 'public', 'icon.ico'),
        path.join(process.cwd(), 'public', 'icon.png'),
        path.join(currentDir, '..', 'public', 'favicon.ico'),
        path.join(currentDir, '..', 'public', 'favicon.png'),
        path.join(currentDir, '..', '..', 'public', 'favicon.ico'),
        path.join(currentDir, '..', '..', 'public', 'favicon.png'),
        path.join(app.getAppPath(), '.output', 'public', 'favicon.ico'),
        path.join(app.getAppPath(), '.output', 'public', 'favicon.png'),
        path.join(process.resourcesPath, 'favicon.ico'),
        path.join(process.resourcesPath, 'favicon.png'),
        path.join(process.resourcesPath, 'icon.ico'),
        path.join(process.resourcesPath, 'icon.png'),
    ]
    const found = candidates.find((candidate) => existsSync(candidate))
    if (!found) {
        console.warn('Не найдена иконка приложения. Кандидаты:', candidates)
    } else {
        console.log('Иконка приложения:', found)
    }
    return found
}

function createNativeImage(iconPath?: string) {
    if (!iconPath) return undefined
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
        console.warn('Иконка пустая или не загружена:', iconPath)
        return undefined
    }
    return image
}

function resolveProdEntry(): string | undefined {
    const candidates = [
        path.join(app.getAppPath(), '.output', 'public', 'index.html'),
        path.join(process.resourcesPath, 'app', '.output', 'public', 'index.html'),
        path.join(process.resourcesPath, '.output', 'public', 'index.html'),
        path.join(currentDir, '..', '.output', 'public', 'index.html'),
    ]
    return candidates.find((candidate) => existsSync(candidate))
}

function createWindow(): void {
    const iconPath = resolveIconPath()
    const icon = createNativeImage(iconPath)
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Thesis 5',
        ...(icon ? { icon } : {}),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(currentDir, 'preload.cjs'),
        },
    })

    if (icon) {
        try {
            win.setIcon(icon)
        } catch (error) {
            console.warn('Не удалось установить иконку окна:', error)
        }
        if (process.platform === 'win32') {
            try {
                app.setAppUserModelId('com.thesis5.app')
            } catch (error) {
                console.warn('Не удалось обновить AppUserModelId:', error)
            }
        }
    }

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self'; " +
                    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
                    "style-src 'self' 'unsafe-inline'; " +
                    "img-src 'self' data: thesis-asset:;"
                ].join('; ')
            }
        })
    })


    if (devServerUrl) {
        console.log('URL для загрузки:', devServerUrl)
        void win.loadURL(devServerUrl)
        win.webContents.openDevTools()
    } else {
        const entry = resolveProdEntry()
        if (entry) {
            console.log('Файл для загрузки:', entry)
            void win.loadFile(entry)
        } else {
            console.error('Не найден собранный SPA-вход: выполните `npm run generate`')
            void win.loadURL('data:text/html,<h1>Thesis 5</h1><p>Build not found. Run npm run generate.</p>')
        }
    }
}

async function bootstrap(): Promise<void> {
    const settings = new Settings(appData.root)

    registerAssetProtocol(() => {
        const currentSettings = settings.get()
        return currentSettings.vaultPath || appData.vault
    })

    try {
        await settings.init()
    } catch (error) {
        console.error('Не удалось прочитать настройки:', error)
    }

    const vault = new Vault(await resolveVaultPath(settings, appData))
    cleanupVault = vault

    try {
        await vault.init()
        initIndexDatabase()
        const allNotes = await vault.listAll()
        await pruneAllAssets(vault.path, allNotes)
        syncIndex(allNotes)
    } catch (error) {
        console.error('Не удалось инициализировать хранилище заметок:', error)
    }

    registerIpcHandlers(vault, settings)
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
}

app.whenReady().then(bootstrap)

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', (event) => {
    if (quitCleanupDone) return

    const vault = cleanupVault
    if (!vault) {
        quitCleanupDone = true
        return
    }

    event.preventDefault()
    if (quitCleanupRunning) return
    quitCleanupRunning = true

    void (async () => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null
        try {
            const timeout = new Promise<boolean>((resolve) => {
                timeoutId = setTimeout(() => resolve(false), 3000)
            })
            const savesSettled = await Promise.race([
                waitForPendingNoteWrites().then(() => true),
                timeout,
            ])

            if (!savesSettled) {
                console.warn('Очистка ассетов при выходе пропущена: не удалось дождаться сохранений')
                return
            }

            await pruneAllAssets(vault.path, await vault.listAll())
        } catch (error) {
            console.error('Не удалось очистить неиспользуемые ассеты при выходе:', error)
        } finally {
            if (timeoutId) clearTimeout(timeoutId)
            quitCleanupDone = true
            app.quit()
        }
    })()
})
