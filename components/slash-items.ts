import type { Editor, Range } from '@tiptap/core'
import type { AppLanguage } from '~/shared/api'
import { resolveMessage, type MessageKey } from '~/composables/useI18n'

export interface SlashItem {
  titleKey: MessageKey
  descKey: MessageKey
  icon: string
  keywords: string[]
  command: (props: { editor: Editor; range: Range }) => void
}

export interface ResolvedSlashItem extends SlashItem {
  title: string
  description: string
}

export const slashItems: SlashItem[] = [
  {
    titleKey: 'slash.h1.title',
    descKey: 'slash.h1.desc',
    icon: 'H1',
    keywords: ['h1', 'heading', 'заголовок', 'title'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
    },
  },
  {
    titleKey: 'slash.h2.title',
    descKey: 'slash.h2.desc',
    icon: 'H2',
    keywords: ['h2', 'heading', 'заголовок'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
    },
  },
  {
    titleKey: 'slash.h3.title',
    descKey: 'slash.h3.desc',
    icon: 'H3',
    keywords: ['h3', 'heading', 'заголовок'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
    },
  },
  {
    titleKey: 'slash.h4.title',
    descKey: 'slash.h4.desc',
    icon: 'H4',
    keywords: ['h4', 'heading', 'заголовок'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run()
    },
  },
  {
    titleKey: 'slash.h5.title',
    descKey: 'slash.h5.desc',
    icon: 'H5',
    keywords: ['h5', 'heading', 'заголовок'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 5 }).run()
    },
  },
  {
    titleKey: 'slash.h6.title',
    descKey: 'slash.h6.desc',
    icon: 'H6',
    keywords: ['h6', 'heading', 'заголовок'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 6 }).run()
    },
  },
  {
    titleKey: 'slash.paragraph.title',
    descKey: 'slash.paragraph.desc',
    icon: '¶',
    keywords: ['paragraph', 'text', 'текст', 'абзац'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setParagraph().run()
    },
  },
  {
    titleKey: 'slash.bullet.title',
    descKey: 'slash.bullet.desc',
    icon: '•',
    keywords: ['bullet', 'list', 'список', 'маркированный'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    titleKey: 'slash.ordered.title',
    descKey: 'slash.ordered.desc',
    icon: '1.',
    keywords: ['ordered', 'list', 'список', 'нумерованный'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    titleKey: 'slash.quote.title',
    descKey: 'slash.quote.desc',
    icon: '❝',
    keywords: ['quote', 'blockquote', 'цитата'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    titleKey: 'slash.code.title',
    descKey: 'slash.code.desc',
    icon: '</>',
    keywords: ['code', 'код', 'кодблок'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    titleKey: 'slash.task.title',
    descKey: 'slash.task.desc',
    icon: '☑',
    keywords: ['task', 'todo', 'checkbox', 'задача', 'чекбокс'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    titleKey: 'slash.table.title',
    descKey: 'slash.table.desc',
    icon: '⊞',
    keywords: ['table', 'таблица'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
  },
  {
    titleKey: 'slash.calloutNote.title',
    descKey: 'slash.calloutNote.desc',
    icon: 'ℹ',
    keywords: ['note', 'callout', 'alert', 'заметка'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent('> [!NOTE]\n> ', { contentType: 'markdown' })
        .run()
    },
  },
  {
    titleKey: 'slash.calloutWarning.title',
    descKey: 'slash.calloutWarning.desc',
    icon: '⚠',
    keywords: ['warning', 'alert', 'предупреждение'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent('> [!WARNING]\n> ', { contentType: 'markdown' })
        .run()
    },
  },
  {
    titleKey: 'slash.calloutTip.title',
    descKey: 'slash.calloutTip.desc',
    icon: '💡',
    keywords: ['tip', 'hint', 'совет'],
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent('> [!TIP]\n> ', { contentType: 'markdown' })
        .run()
    },
  },
  {
    titleKey: 'slash.footnote.title',
    descKey: 'slash.footnote.desc',
    icon: '[^]',
    keywords: ['footnote', 'note', 'reference', 'сноска', 'примечание'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertFootnote().run()
    },
  },
  {
    titleKey: 'slash.divider.title',
    descKey: 'slash.divider.desc',
    icon: '—',
    keywords: ['rule', 'divider', 'hr', 'разделитель', 'линия'],
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
]

export function resolveSlashItems(language: AppLanguage): ResolvedSlashItem[] {
  return slashItems.map((item) => ({
    ...item,
    title: resolveMessage(language, item.titleKey),
    description: resolveMessage(language, item.descKey),
  }))
}

export function filterSlashItems(query: string, language: AppLanguage): ResolvedSlashItem[] {
  const items = resolveSlashItems(language)
  const normalized = query.toLowerCase().trim()
  if (!normalized) return items

  return items.filter((item) =>
    item.title.toLowerCase().includes(normalized)
    || item.keywords.some((keyword) => keyword.includes(normalized)),
  )
}
