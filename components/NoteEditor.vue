<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import DragHandle from '@tiptap/extension-drag-handle-vue-3'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import type { TocHeading } from '~/shared/api'
import { Callout } from './CalloutExtension'
import { Footnote, FootnoteDefinition, FootnoteReference } from './FootnoteExtension'
import { createImageExtension } from './ImageExtension'
import { LanguageCodeBlock } from './LanguageCodeBlock'
import { ListKeymap } from './ListKeymap'
import { MarkdownPaste } from './MarkdownPaste'
import { SlashCommand } from './SlashCommand'

const { t, locale } = useI18n()

const props = defineProps<{
  modelValue: string
  noteId?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  toc: [headings: TocHeading[]]
}>()

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

async function saveImageFromFile(file: File): Promise<string | null> {
  if (!props.noteId || !ALLOWED_IMAGE_MIMES.has(file.type)) return null
  if (typeof window === 'undefined' || !window.api) return null
  try {
    const data = await readFileAsArrayBuffer(file)
    const result = await window.api.notes.saveAsset(props.noteId, file.type, data)
    return result.path
  } catch {
    return null
  }
}

const editor = useEditor({
  content: props.modelValue,
  contentType: 'markdown',
  extensions: [
    StarterKit.configure({ codeBlock: false }),
    LanguageCodeBlock,
    createImageExtension(props.noteId ?? null, locale.value),
    Table.configure({
      resizable: false,
    }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
    ListKeymap,
    Callout,
    FootnoteReference,
    FootnoteDefinition,
    Footnote,
    Markdown,
    MarkdownPaste,
    SlashCommand.configure({ language: locale.value }),
  ],
  editorProps: {
    attributes: {
      class: 'note-prose',
      spellcheck: 'false',
    },
    handlePaste: (_view, event) => {
      const clipboard = event.clipboardData
      if (!clipboard || !props.noteId) return false
      const items = Array.from(clipboard.items || [])
      const imageItems = items.filter((item) => item.kind === 'file' && item.type && ALLOWED_IMAGE_MIMES.has(item.type))
      const files = imageItems.length === 0
        ? Array.from(clipboard.files || []).filter((file) => ALLOWED_IMAGE_MIMES.has(file.type))
        : []
      if (imageItems.length === 0 && files.length === 0) return false

      event.preventDefault()
      void (async () => {
        const instance = editor.value
        if (!instance || instance.isDestroyed) return
        if (imageItems.length > 0) {
          for (const item of imageItems) {
            const file = item.getAsFile()
            if (!file) continue
            const path = await saveImageFromFile(file)
            if (!path) continue
            instance.chain().focus().setImage({ src: path }).run()
          }
          return
        }
        for (const file of files) {
          const path = await saveImageFromFile(file)
          if (!path) continue
          instance.chain().focus().setImage({ src: path }).run()
        }
      })()
      return true
    },
    handleDOMEvents: {
      copy: (view, event) => {
        const { from, to } = view.state.selection
        if (from === to || !event.clipboardData) return false

        let touchesCallout = false
        view.state.doc.nodesBetween(from, to, (node) => {
          if (node.type.name === 'callout') {
            touchesCallout = true
            return false
          }
          return true
        })
        if (!touchesCallout) return false

        event.clipboardData.setData('text/plain', view.state.doc.textBetween(from, to, '\n', '\n'))
        event.preventDefault()
        return true
      },
    },
  },
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getMarkdown())
  },
})

watch(() => props.modelValue, (value) => {
  const instance = editor.value
  if (!instance || instance.isDestroyed) return
  if (value === instance.getMarkdown()) return

  instance.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
  syncToc()
})

function collectHeadings(): TocHeading[] {
  const instance = editor.value
  if (!instance || instance.isDestroyed) return []

  const headings: TocHeading[] = []
  instance.state.doc.descendants((node) => {
    if (node.type.name !== 'heading') return
    headings.push({
      level: Number(node.attrs.level) || 1,
      text: node.textContent.trim(),
    })
  })
  return headings
}

function syncToc() {
  emit('toc', collectHeadings())
}

function scrollToHeading(index: number) {
  const instance = editor.value
  if (!instance || instance.isDestroyed) return

  const headings = instance.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
  headings[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

watch(editor, (instance) => {
  if (!instance) return
  instance.on('update', syncToc)
  syncToc()
}, { immediate: true })

onBeforeUnmount(() => {
  editor.value?.off('update', syncToc)
})

defineExpose({ scrollToHeading })
</script>

<template>
  <div class="editor-shell">
    <div v-if="editor" class="editor-shell__toolbar">
      <div class="editor-shell__toolbar__group">
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :title="t('editor.undo')"
          :disabled="!editor.can().undo()"
          @mousedown.prevent
          @click="editor.chain().focus().undo().run()"
        >
          ↶
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :title="t('editor.redo')"
          :disabled="!editor.can().redo()"
          @mousedown.prevent
          @click="editor.chain().focus().redo().run()"
        >
          ↷
        </button>
      </div>

      <div class="editor-shell__toolbar__group">
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('heading', { level: 1 }) }"
          :title="t('editor.heading1')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
        >
          H1
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('heading', { level: 2 }) }"
          :title="t('editor.heading2')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
        >
          H2
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('heading', { level: 3 }) }"
          :title="t('editor.heading3')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
        >
          H3
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('heading', { level: 4 }) }"
          :title="t('editor.heading4')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleHeading({ level: 4 }).run()"
        >
          H4
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('heading', { level: 5 }) }"
          :title="t('editor.heading5')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleHeading({ level: 5 }).run()"
        >
          H5
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('heading', { level: 6 }) }"
          :title="t('editor.heading6')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleHeading({ level: 6 }).run()"
        >
          H6
        </button>
      </div>

      <div class="editor-shell__toolbar__group">
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('bold') }"
          :title="t('editor.bold')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleBold().run()"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('italic') }"
          :title="t('editor.italic')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleItalic().run()"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('strike') }"
          :title="t('editor.strike')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleStrike().run()"
        >
          <s>S</s>
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('code') }"
          :title="t('editor.inlineCode')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleCode().run()"
        >
          &lt;/&gt;
        </button>
      </div>

      <div class="editor-shell__toolbar__group">
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('bulletList') }"
          :title="t('editor.bulletList')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleBulletList().run()"
        >
          ••
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('orderedList') }"
          :title="t('editor.orderedList')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleOrderedList().run()"
        >
          1.
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('taskList') }"
          :title="t('editor.taskList')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleTaskList().run()"
        >
          ☑
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('blockquote') }"
          :title="t('editor.blockquote')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleBlockquote().run()"
        >
          ❝
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :class="{ 'editor-shell__toolbar__group__btn--active': editor.isActive('codeBlock') }"
          :title="t('editor.codeBlock')"
          @mousedown.prevent
          @click="editor.chain().focus().toggleCodeBlock().run()"
        >
          { }
        </button>
      </div>

      <div class="editor-shell__toolbar__group">
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :title="t('editor.insertTable')"
          @mousedown.prevent
          @click="editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
        >
          ⊞
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :disabled="!editor.can().addColumnAfter()"
          :title="t('editor.addColumn')"
          @mousedown.prevent
          @click="editor.chain().focus().addColumnAfter().run()"
        >
          +|
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :disabled="!editor.can().addRowAfter()"
          :title="t('editor.addRow')"
          @mousedown.prevent
          @click="editor.chain().focus().addRowAfter().run()"
        >
          +-
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :disabled="!editor.can().deleteColumn()"
          :title="t('editor.deleteColumn')"
          @mousedown.prevent
          @click="editor.chain().focus().deleteColumn().run()"
        >
          -|
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :disabled="!editor.can().deleteRow()"
          :title="t('editor.deleteRow')"
          @mousedown.prevent
          @click="editor.chain().focus().deleteRow().run()"
        >
          --
        </button>
        <button
          type="button"
          class="editor-shell__toolbar__group__btn"
          :disabled="!editor.can().deleteTable()"
          :title="t('editor.deleteTable')"
          @mousedown.prevent
          @click="editor.chain().focus().deleteTable().run()"
        >
          ×
        </button>
      </div>

      <span class="editor-shell__toolbar__hint">{{ t('editor.slashHint') }}</span>
    </div>

    <div class="editor-shell__surface">
      <EditorContent class="editor-shell__surface__content" :editor="editor" />
      <DragHandle v-if="editor" :editor="editor">
        <span class="editor-shell__grip" aria-hidden="true">⠿</span>
      </DragHandle>
    </div>
  </div>
</template>

<style scoped lang="scss">
.editor-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 12px;
  background: var(--color-dark-main);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--color-light-main);

  &:focus-within {
    border-color: var(--color-dark-secondary);
  }

  &__toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 10px;
    background: var(--color-dark-secondary);
    flex-shrink: 0;

    &__group {
      display: flex;
      align-items: center;
      gap: 2px;
      padding-right: 6px;
      border-right: 1px solid var(--color-light-extra-muted);

      &:last-of-type {
        border-right: none;
      }

      &__btn {
        min-width: 30px;
        height: 30px;
        padding: 0 8px;
        border: 1px solid transparent;
        border-radius: 7px;
        background: transparent;
        color: var(--color-light-muted);
        font-family: inherit;
        font-size: 13px;
        line-height: 1;
        cursor: pointer;
        transition: .2s;

        &:hover:not(:disabled) {
          color: var(--color-accent-tertiary);
        }

        &--active {
          color: var(--color-accent-tertiary);
        }

        &:disabled {
          opacity: .4;
          cursor: default;
        }
      }
    }

    &__hint {
      margin-left: auto;
      font-size: 11px;
      color: var(--color-light-extra-muted);
    }
  }

  &__surface {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;

    &__content {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }
  }
}
</style>
