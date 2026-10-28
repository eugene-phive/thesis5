import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi, type CreateNoteInput } from '../shared/api'

const api: RendererApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    revealVault: () => ipcRenderer.invoke(IPC.appRevealVault),
    changeVault: () => ipcRenderer.invoke(IPC.appChangeVault),
  },
  notes: {
    list: () => ipcRenderer.invoke(IPC.notesList),
    read: (id: string) => ipcRenderer.invoke(IPC.notesRead, id),
    create: (input?: CreateNoteInput) => ipcRenderer.invoke(IPC.notesCreate, input),
    save: (id: string, content: string) => ipcRenderer.invoke(IPC.notesSave, id, content),
    move: (id: string, parentId: string | null, index?: number) =>
      ipcRenderer.invoke(IPC.notesMove, id, parentId, index),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.notesDuplicate, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.notesRemove, id),
    saveAsset: (noteId: string, mime: string, data: ArrayBuffer) =>
      ipcRenderer.invoke(IPC.notesSaveAsset, noteId, mime, data),
    pruneAssets: (noteId: string) => ipcRenderer.invoke(IPC.notesPruneAssets, noteId),
  },
  search: {
    query: (query, limit) => ipcRenderer.invoke(IPC.searchQuery, query, limit),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  },
  files: {
    exportNote: (format, input) => ipcRenderer.invoke(IPC.filesExport, format, input),
    importDocument: (language) => ipcRenderer.invoke(IPC.filesImport, language),
  },
}

contextBridge.exposeInMainWorld('api', api)
