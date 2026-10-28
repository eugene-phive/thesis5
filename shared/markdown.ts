const ATX_H1 = /^#\s+(.+?)\s*#*\s*$/
const FENCE_START = /^\s*(```+|~~~+)/
const UNICODE_BULLET = /^(\s*)[•◦▪●○■□]\s+/
const ORDERED_PAREN = /^(\s*)(\d+)\)\s+/

export function normalizeLineEndings(value: string): string {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

export function extractMarkdownTitle(markdown: string): string | null {
  let fence: string | null = null

  for (const line of normalizeLineEndings(markdown).split('\n')) {
    const fenceMatch = FENCE_START.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence) continue

    const match = ATX_H1.exec(line)
    if (match) return match[1].trim()
  }

  return null
}

export function ensureTitleHeading(
  markdown: string,
  fallbackTitle: string,
): { title: string; content: string } {
  const normalized = normalizeLineEndings(markdown).trim()
  const existingTitle = extractMarkdownTitle(normalized)
  const title = existingTitle || fallbackTitle.trim() || 'Untitled'
  const content = existingTitle ? normalized : `# ${title}\n\n${normalized}`.trim()

  return { title, content: `${content.trimEnd()}\n` }
}

export function textToMarkdown(value: string): string {
  const lines = normalizeLineEndings(value).split('\n')
  const result: string[] = []
  let fence: string | null = null

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const fenceMatch = FENCE_START.exec(line)

    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (fence === marker) fence = null
      result.push(line)
      continue
    }

    if (fence) {
      result.push(line)
      continue
    }

    const next = lines[index + 1] ?? ''
    if (/^=+\s*$/.test(next) && isSetextCandidate(line)) {
      result.push(`# ${line.trim()}`)
      index++
      continue
    }
    if (/^-{2,}\s*$/.test(next) && isSetextCandidate(line)) {
      result.push(`## ${line.trim()}`)
      index++
      continue
    }

    result.push(line.replace(UNICODE_BULLET, '$1- ').replace(ORDERED_PAREN, '$1$2. '))
  }

  return result.join('\n')
}

export function looksLikeMarkdown(value: string): boolean {
  const text = normalizeLineEndings(value)
  if (!text.trim()) return false

  return (
    /^\s*(```|~~~)/m.test(text)
    || /^#{1,6}\s+\S/m.test(text)
    || /^\s*>\s?\S/m.test(text)
    || /^\s*(?:[-*+]|\d+[.)])\s+\S/m.test(text)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(text)
    || /^\S[^\n]*\n(?:=+|-{2,})\s*$/m.test(text)
    || /\*\*[^\n*]+\*\*/.test(text)
    || /__[^\n_]+__/.test(text)
    || /(^|[\s(])(?:\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_)(?=[\s).,!?:;]|$)/m.test(text)
    || /`[^`\n]+`/.test(text)
    || /~~[^\n~]+~~/.test(text)
    || /!?\[[^\]\n]+\]\([^)\n]+\)/.test(text)
  )
}

function isSetextCandidate(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  return !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|)/.test(trimmed)
}
