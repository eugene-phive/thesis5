export const SEARCH_HIGHLIGHT_OPEN = '\u0001'
export const SEARCH_HIGHLIGHT_CLOSE = '\u0002'

export interface SearchSnippetPart {
  text: string
  highlight: boolean
}

/**
 * Разбирает сниппет с маркерами подсветки на безопасные текстовые части.
 * Маркеры — служебные символы, поэтому renderer может рендерить части
 * через обычный текст (без v-html) и не рисковать XSS.
 */
export function splitSearchSnippet(snippet: string): SearchSnippetPart[] {
  const parts: SearchSnippetPart[] = []
  let buffer = ''
  let highlight = false

  const flush = () => {
    if (!buffer) return
    parts.push({ text: buffer, highlight })
    buffer = ''
  }

  for (const char of snippet) {
    if (char === SEARCH_HIGHLIGHT_OPEN) {
      flush()
      highlight = true
    } else if (char === SEARCH_HIGHLIGHT_CLOSE) {
      flush()
      highlight = false
    } else {
      buffer += char
    }
  }
  flush()

  return parts
}
