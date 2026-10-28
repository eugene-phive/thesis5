import { protocol } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'thesis-asset',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

export function registerAssetProtocol(getVaultPath: () => string): void {
  protocol.handle('thesis-asset', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset') return notFound()
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length < 2) return notFound()

      const noteId = decodeURIComponent(parts[0])
      const filename = decodeURIComponent(parts.slice(1).join('/'))
      if (!noteId || !filename || filename.includes('..') || path.isAbsolute(filename)) {
        return notFound()
      }

      const assetsDir = path.resolve(getVaultPath(), noteId, 'assets')
      const filePath = path.resolve(assetsDir, filename)
      if (isOutside(assetsDir, filePath)) return notFound()

      let realAssetsDir: string
      let realFilePath: string
      try {
        realAssetsDir = await fs.realpath(assetsDir)
        realFilePath = await fs.realpath(filePath)
      } catch {
        return notFound()
      }
      if (isOutside(realAssetsDir, realFilePath)) return notFound()

      const data = await fs.readFile(realFilePath)
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': getContentType(path.extname(realFilePath)),
          'Cache-Control': 'no-cache',
        },
      })
    } catch {
      return notFound()
    }
  })
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}

function getContentType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

function isOutside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
}
