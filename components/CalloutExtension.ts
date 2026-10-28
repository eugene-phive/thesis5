import { mergeAttributes, Node } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'

const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const

export type CalloutKind = (typeof CALLOUT_KINDS)[number]

const CALLOUT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(\n|$)/i

function normalizeKind(value: unknown): CalloutKind {
  const kind = String(value ?? '').toLowerCase()
  return (CALLOUT_KINDS as readonly string[]).includes(kind) ? (kind as CalloutKind) : 'note'
}

export const Callout = Node.create({
  name: 'callout',

  markdownTokenName: 'blockquote',

  priority: 1000,

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: (element) => normalizeKind(element.getAttribute('data-callout')),
        renderHTML: (attributes) => ({ 'data-callout': normalizeKind(attributes.kind) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = normalizeKind(node.attrs.kind)
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: `note-callout note-callout--${kind}`,
      }),
      0,
    ]
  },

  parseMarkdown(token, helpers) {
    const firstToken = token.tokens?.[0]
    if (!firstToken || firstToken.type !== 'paragraph') {
      return []
    }

    const text = String(firstToken.text ?? '')
    const marker = text.match(CALLOUT_MARKER)
    if (!marker) {
      return []
    }

    const kind = normalizeKind(marker[1])
    const body = text.slice(marker[0].length)
    const content: JSONContent[] = []

    if (body.trim()) {
      const inlineTokens = helpers.tokenizeInline?.(body) ?? [
        { type: 'text', raw: body, text: body },
      ]
      content.push(helpers.createNode('paragraph', undefined, helpers.parseInline(inlineTokens)))
    }

    const rest = (token.tokens ?? []).slice(1).filter((child) => child.type !== 'space')
    if (rest.length > 0) {
      content.push(...(helpers.parseBlockChildren?.(rest) ?? helpers.parseChildren(rest)))
    }

    if (content.length === 0) {
      content.push(helpers.createNode('paragraph'))
    }

    return helpers.createNode('callout', { kind }, content)
  },

  renderMarkdown(node, helpers) {
    const body = helpers.renderChildren(node.content ?? [], '\n\n')
    const quoted = body
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n')

    if (node.type !== 'callout') {
      return quoted
    }

    const kind = normalizeKind(node.attrs?.kind).toUpperCase()
    return `> [!${kind}]\n${quoted}`
  },
})
