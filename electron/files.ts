import { app, BrowserWindow, dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import type {
  AppLanguage,
  ExportFormat,
  ExportNoteInput,
  ExportResult,
  ImportResult,
} from '../shared/api'
import { resolveMessage, type MessageKey } from '../shared/i18n'
import { normalizeLineEndings } from '../shared/markdown'
import {
  docxToMarkdown,
  markdownFileToNote,
  markdownToDocx,
  markdownToPdfHtml,
  markdownToPlainText,
  textFileToNote,
} from './converters'

const FORMATS: Record<
  ExportFormat,
  { extension: string; filterKey: MessageKey; documentsOnly?: boolean }
> = {
  txt: { extension: 'txt', filterKey: 'file.filter.txt', documentsOnly: true },
  pdf: { extension: 'pdf', filterKey: 'file.filter.pdf', documentsOnly: true },
  docx: { extension: 'docx', filterKey: 'file.filter.docx', documentsOnly: true },
  md: { extension: 'md', filterKey: 'file.filter.md', documentsOnly: true },
}

export async function exportNote(
  win: BrowserWindow | null,
  format: ExportFormat,
  input: ExportNoteInput,
): Promise<ExportResult> {
  const config = FORMATS[format]
  const baseDir = config.documentsOnly ? safeDocumentsPath() : app.getPath('temp')
  const filePath = await selectSavePath(win, {
    title: resolveMessage(input.language, 'file.dialog.export'),
    defaultPath: path.join(baseDir, `${sanitizeFileName(input.title)}.${config.extension}`),
    filters: [
      {
        name: resolveMessage(input.language, config.filterKey),
        extensions: [config.extension],
      },
    ],
  })

  if (!filePath) return { canceled: true, filePath: null }

  if (format === 'txt') {
    await fs.writeFile(filePath, markdownToPlainText(input.content), 'utf8')
  } else if (format === 'pdf') {
    await writePdf(filePath, input.content, input.title)
  } else if (format === 'md') {
    const markdown = normalizeLineEndings(input.content)
    await fs.writeFile(filePath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8')
  } else {
    await fs.writeFile(filePath, await markdownToDocx(input.content, input.title))
  }

  return { canceled: false, filePath }
}

export async function importDocument(
  win: BrowserWindow | null,
  language: AppLanguage,
): Promise<ImportResult> {
  const filePath = await selectOpenPath(win, {
    title: resolveMessage(language, 'file.dialog.import'),
    properties: ['openFile'],
    filters: [
      {
        name: resolveMessage(language, 'file.filter.document'),
        extensions: ['docx', 'txt', 'md', 'markdown'],
      },
      {
        name: resolveMessage(language, 'file.filter.docx'),
        extensions: ['docx'],
      },
      {
        name: resolveMessage(language, 'file.filter.txt'),
        extensions: ['txt'],
      },
      {
        name: resolveMessage(language, 'file.filter.md'),
        extensions: ['md', 'markdown'],
      },
    ],
  })

  if (!filePath) {
    return { canceled: true, filePath: null, title: '', content: '' }
  }

  const extension = path.extname(filePath).toLowerCase()
  let result: { title: string; content: string }

  if (extension === '.docx') {
    result = await docxToMarkdown(filePath)
  } else if (extension === '.md' || extension === '.markdown') {
    result = await markdownFileToNote(filePath)
  } else if (extension === '.txt') {
    result = await textFileToNote(filePath)
  } else {
    throw new Error(resolveMessage(language, 'file.error.unsupported'))
  }

  return { canceled: false, filePath, ...result }
}

async function writePdf(filePath: string, markdown: string, title: string): Promise<void> {
  const tempFile = path.join(app.getPath('temp'), `thesis5-${crypto.randomUUID()}.html`)
  await fs.writeFile(tempFile, markdownToPdfHtml(markdown, title), 'utf8')

  const printWindow = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: false,
    },
  })

  try {
    await printWindow.loadFile(tempFile)
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4',
    })
    await fs.writeFile(filePath, pdf)
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy()
    await fs.unlink(tempFile).catch(() => undefined)
  }
}

async function selectSavePath(
  win: BrowserWindow | null,
  options: SaveDialogOptions,
): Promise<string | null> {
  const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

async function selectOpenPath(
  win: BrowserWindow | null,
  options: OpenDialogOptions,
): Promise<string | null> {
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const [filePath] = result.filePaths
  return result.canceled || !filePath ? null : filePath
}

function safeDocumentsPath(): string {
  try {
    return app.getPath('documents')
  } catch {
    return app.getPath('userData')
  }
}

function sanitizeFileName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)

  if (!cleaned) return 'note'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return `_${cleaned}`
  return cleaned
}
