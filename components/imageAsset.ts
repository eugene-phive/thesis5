export function resolveImageSrc(src: string, noteId: string | null | undefined): string {
  if (!src) return src
  if (src.startsWith('thesis-asset://') || src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src
  }
  if (src.startsWith('assets/')) {
    if (!noteId) return src
    const filename = src.slice('assets/'.length).split('/').pop() ?? src
    return `thesis-asset://asset/${encodeURIComponent(noteId)}/${encodeURIComponent(filename)}`
  }
  return src
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
