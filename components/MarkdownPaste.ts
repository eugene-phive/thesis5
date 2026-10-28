import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { looksLikeMarkdown, normalizeLineEndings } from '~/shared/markdown'

export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (_view, event) => {
            const clipboard = event.clipboardData
            if (!clipboard) return false
            if (clipboard.getData('text/html').trim()) return false
            if (editor.isActive('codeBlock')) return false

            const text = clipboard.getData('text/plain')
            if (!text || !looksLikeMarkdown(text)) return false

            event.preventDefault()
            editor.commands.insertContent(normalizeLineEndings(text), {
              contentType: 'markdown',
            })
            return true
          },
        },
      }),
    ]
  },
})
