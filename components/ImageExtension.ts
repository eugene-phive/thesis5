import { ResizableNodeView } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import type { ImageOptions } from '@tiptap/extension-image'
import type { AppLanguage } from '../shared/api'
import { resolveMessage } from '../shared/i18n'
import { escapeHtmlAttribute, resolveImageSrc } from './imageAsset'

interface NoteImageOptions extends ImageOptions {
  noteId: string | null
}

function getContentWidth(editor: Editor): number {
  if (!editor.isInitialized || editor.isDestroyed) return 0
  const dom = editor.view.dom
  const styles = window.getComputedStyle(dom)
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0
  const width = dom.clientWidth - paddingLeft - paddingRight
  return width > 0 ? Math.floor(width) : 0
}

export function createImageExtension(noteId: string | null, language: AppLanguage = 'en') {
  return Image.extend<NoteImageOptions>({
    addOptions() {
      return {
        ...this.parent?.(),
        noteId,
      } as NoteImageOptions
    },

    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: (element) => element.getAttribute('src'),
          renderHTML: (attributes) => {
            if (!attributes.src) return {}
            return { src: attributes.src }
          },
        },
        width: {
          default: null,
          parseHTML: (element) => {
            const raw = element.getAttribute('width') ?? element.style.width
            if (!raw) return null
            const value = Number.parseInt(raw, 10)
            return Number.isFinite(value) && value > 0 ? value : null
          },
          renderHTML: (attributes) => {
            const value = Number(attributes.width)
            if (!Number.isFinite(value) || value <= 0) return {}
            return { width: Math.round(value) }
          },
        },
      }
    },

    renderHTML({ HTMLAttributes }) {
      const src = resolveImageSrc(HTMLAttributes.src, this.options.noteId)
      return ['img', { ...HTMLAttributes, src }]
    },

    addNodeView() {
      const extensionNoteId = this.options.noteId

      return ({ node, getPos, editor }) => {
        const image = document.createElement('img')
        image.draggable = false
        image.src = resolveImageSrc(String(node.attrs.src ?? ''), extensionNoteId)
        image.setAttribute('alt', String(node.attrs.alt ?? ''))
        if (node.attrs.title) image.setAttribute('title', String(node.attrs.title))

        const nodeView = new ResizableNodeView({
          element: image,
          editor,
          node,
          getPos,
          onResize: (width) => {
            image.style.width = `${width}px`
            image.style.height = ''
          },
          onCommit: (width) => {
            const pos = getPos()
            if (pos === undefined) return
            const current = editor.state.doc.nodeAt(pos)
            if (!current) return
            const nextWidth = Math.round(width)
            if (Number(current.attrs.width) === nextWidth) return
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(pos, undefined, {
                ...current.attrs,
                width: nextWidth,
              }),
            )
          },
          onUpdate: (updatedNode) => {
            if (updatedNode.type !== node.type) return false
            const nextSrc = resolveImageSrc(String(updatedNode.attrs.src ?? ''), extensionNoteId)
            if (image.getAttribute('src') !== nextSrc) image.src = nextSrc
            const nextAlt = String(updatedNode.attrs.alt ?? '')
            if (image.getAttribute('alt') !== nextAlt) image.setAttribute('alt', nextAlt)
            if (updatedNode.attrs.title) image.setAttribute('title', String(updatedNode.attrs.title))
            else image.removeAttribute('title')
            const nextWidth = Number(updatedNode.attrs.width)
            image.style.width = Number.isFinite(nextWidth) && nextWidth > 0 ? `${nextWidth}px` : ''
            return true
          },
          options: {
            directions: ['bottom-right'],
            min: { width: 48, height: 48 },
            preserveAspectRatio: true,
            className: {
              container: 'note-image',
              wrapper: 'note-image__wrapper',
              handle: 'note-image__handle',
              resizing: 'is-resizing',
            },
          },
        })

        const updateMaxWidth = () => {
          const width = getContentWidth(editor)
          if (width > 0) nodeView.maxSize = { width }
        }

        let resizeObserver: ResizeObserver | null = null
        let widthTimer: ReturnType<typeof setTimeout> | null = null

        const startObservingWidth = () => {
          widthTimer = null
          if (editor.isDestroyed) return
          if (!editor.isInitialized) {
            widthTimer = setTimeout(startObservingWidth, 50)
            return
          }
          updateMaxWidth()
          if (resizeObserver || typeof ResizeObserver === 'undefined') return
          resizeObserver = new ResizeObserver(() => updateMaxWidth())
          resizeObserver.observe(editor.view.dom)
        }

        widthTimer = setTimeout(startObservingWidth, 0)

        const deleteButton = document.createElement('button')
        deleteButton.type = 'button'
        deleteButton.className = 'note-image__delete'
        const deleteLabel = resolveMessage(language, 'image.delete')
        deleteButton.setAttribute('aria-label', deleteLabel)
        deleteButton.setAttribute('title', deleteLabel)
        deleteButton.textContent = '×'
        deleteButton.addEventListener('mousedown', (event) => event.preventDefault())
        deleteButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const pos = getPos()
          if (pos === undefined) return
          const current = editor.state.doc.nodeAt(pos)
          if (!current) return
          editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run()
        })
        nodeView.wrapper.appendChild(deleteButton)

        const originalDestroy = nodeView.destroy.bind(nodeView)
        nodeView.destroy = () => {
          if (widthTimer) clearTimeout(widthTimer)
          resizeObserver?.disconnect()
          originalDestroy()
        }

        return nodeView
      }
    },

    renderMarkdown(node) {
      const attrs = node.attrs ?? {}
      const src = String(attrs.src ?? '')
      const alt = String(attrs.alt ?? '')
      const title = attrs.title ? String(attrs.title) : ''
      const width = Number(attrs.width)

      if (Number.isFinite(width) && width > 0) {
        const parts = [
          `src="${escapeHtmlAttribute(src)}"`,
          `alt="${escapeHtmlAttribute(alt)}"`,
        ]
        if (title) parts.push(`title="${escapeHtmlAttribute(title)}"`)
        parts.push(`width="${Math.round(width)}"`)
        return `<img ${parts.join(' ')}>`
      }

      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`
    },
  })
}
