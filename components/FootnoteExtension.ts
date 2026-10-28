import { Extension, mergeAttributes, Node } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { MarkdownToken } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: () => ReturnType
    }
  }
}

interface FootnoteDefinitionSource {
  label: string
  content: string
  raw: string
}

function readDefinition(src: string): FootnoteDefinitionSource | null {
  const lines = src.split('\n')
  const first = lines[0]?.match(/^\[\^([^\]\s]+)\]:[ \t]*(.*)$/)
  if (!first) return null

  const contentLines = [first[2] ?? '']
  let consumed = 1

  while (consumed < lines.length) {
    const line = lines[consumed]
    if (line.trim() === '') {
      const next = lines[consumed + 1]
      if (next !== undefined && /^[ \t]{2,}\S/.test(next)) {
        contentLines.push('')
        consumed += 1
        continue
      }
      break
    }

    if (/^[ \t]{2,}/.test(line)) {
      contentLines.push(line.replace(/^[ \t]{2,4}/, '').replace(/[ \t]+$/, ''))
      consumed += 1
      continue
    }

    break
  }

  return {
    label: first[1],
    content: contentLines.join('\n').trim(),
    raw: lines.slice(0, consumed).join('\n'),
  }
}

function normalizeLabel(value: unknown): string {
  const label = String(value ?? '').trim()
  return label || '1'
}

export const FootnoteReference = Node.create({
  name: 'footnoteReference',

  group: 'inline',

  inline: true,

  atom: true,

  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '1',
        parseHTML: (element) => normalizeLabel(element.getAttribute('data-footnote-ref')),
        renderHTML: (attributes) => ({ 'data-footnote-ref': normalizeLabel(attributes.label) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote-ref]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = normalizeLabel(node.attrs.label)
    return [
      'sup',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { class: 'note-footnote-ref' }),
      `[${label}]`,
    ]
  },

  markdownTokenizer: {
    name: 'footnoteReference',
    level: 'inline',
    start: (src: string) => src.indexOf('[^'),
    tokenize(src: string) {
      const match = src.match(/^\[\^([^\]\s]+)\]/)
      if (!match) return undefined

      return {
        type: 'footnoteReference',
        raw: match[0],
        label: match[1],
        tokens: [],
      }
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('footnoteReference', { label: normalizeLabel(token.label) })
  },

  renderMarkdown(node) {
    return `[^${normalizeLabel(node.attrs?.label)}]`
  },
})

export const FootnoteDefinition = Node.create({
  name: 'footnoteDefinition',

  priority: 1000,

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      label: {
        default: '1',
        parseHTML: (element) => normalizeLabel(element.getAttribute('data-footnote-definition')),
        renderHTML: (attributes) => ({
          'data-footnote-definition': normalizeLabel(attributes.label),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-footnote-definition]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'note-footnote-definition',
      }),
      0,
    ]
  },

  markdownTokenizer: {
    name: 'footnoteDefinition',
    level: 'block',
    start: (src: string) => {
      const match = /^\[\^[^\]\s]+\]:/m.exec(src)
      return match ? match.index : -1
    },
    tokenize(src: string, _tokens, lexer) {
      const parsed = readDefinition(src)
      if (!parsed) return undefined

      return {
        type: 'footnoteDefinition',
        raw: parsed.raw,
        label: parsed.label,
        tokens: parsed.content ? lexer.blockTokens(parsed.content) : [],
      } as MarkdownToken
    },
  },

  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? []
    const content = tokens.length
      ? (helpers.parseBlockChildren?.(tokens) ?? helpers.parseChildren(tokens))
      : [helpers.createNode('paragraph')]

    if (content.length === 0) {
      content.push(helpers.createNode('paragraph'))
    }

    return helpers.createNode('footnoteDefinition', { label: normalizeLabel(token.label) }, content)
  },

  renderMarkdown(node, helpers) {
    const label = normalizeLabel(node.attrs?.label)
    const body = helpers.renderChildren(node.content ?? [], '\n\n')
    const lines = body.split('\n')
    const first = lines.shift() ?? ''
    const rest = lines.map((line) => (line ? `    ${line}` : ''))

    return [`[^${label}]: ${first}`, ...rest].join('\n')
  },
})

export const Footnote = Extension.create({
  name: 'footnote',

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ state, dispatch }) => {
          if (!dispatch) return true

          const used = new Set<string>()
          state.doc.descendants((node) => {
            if (node.type.name !== 'footnoteReference' && node.type.name !== 'footnoteDefinition') {
              return
            }
            const label = String(node.attrs.label ?? '').trim()
            if (label) used.add(label)
          })

          let index = 1
          while (used.has(String(index))) index += 1
          const label = String(index)

          const referenceType = state.schema.nodes.footnoteReference
          const definitionType = state.schema.nodes.footnoteDefinition
          const paragraphType = state.schema.nodes.paragraph
          if (!referenceType || !definitionType || !paragraphType) return false

          const reference = referenceType.create({ label })
          const definition = definitionType.create({ label }, paragraphType.create())
          const definitionPos = state.doc.content.size

          const tr = state.tr
          tr.replaceSelectionWith(reference)
          tr.insert(tr.doc.content.size, definition)
          tr.setSelection(TextSelection.near(tr.doc.resolve(definitionPos + 2)))

          dispatch(tr.scrollIntoView())
          return true
        },
    }
  },
})
