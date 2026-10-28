<script setup lang="ts">
import type { AppInfo, ExportFormat, Note, NoteMeta, SearchHit, TocHeading } from '~/shared/api'
import { splitSearchSnippet } from '~/shared/search'

const { t, locale, toggleLanguage, loadLanguage } = useI18n()
const { cycleAccent, loadAccent } = useAccent()

useHead({ title: 'Thesis 5' })

const notes = ref<NoteMeta[]>([])
const active = ref<Note | null>(null)
const draft = ref('')
const info = ref<AppInfo | null>(null)
const status = ref('')
const statusError = ref(false)
const busy = ref(false)
const settingsOpen = ref(false)
const settingsError = ref('')
const exportOpen = ref(false)
const exportMenu = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const searchResults = ref<SearchHit[]>([])
const searching = ref(false)
const searchMode = computed(() => searchQuery.value.trim().length > 0)

type StatusKind = 'info' | 'saved' | 'moved' | 'error'
const statusKind = ref<StatusKind>('info')
let statusTimer: ReturnType<typeof setTimeout> | undefined
const collapsed = reactive(new Set<string>())
const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
const draggingOverRoot = ref(false)
const dropHint = ref<{ id: string; kind: 'before' | 'after'; parentId: string | null; index: number } | null>(null)
const contextMenu = ref<{ note: NoteMeta; x: number; y: number } | null>(null)
const contextMenuEl = ref<HTMLElement | null>(null)
const sidebarOpen = ref(true)
const tocOpen = ref(false)
const toc = ref<TocHeading[]>([])
const editorRef = ref<{ scrollToHeading: (index: number) => void } | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchRequest = 0

interface TreeRow {
  note: NoteMeta
  depth: number
  hasChildren: boolean
}

const treeRows = computed<TreeRow[]>(() => {
  const known = new Set(notes.value.map((note) => note.id))
  const byParent = new Map<string | null, NoteMeta[]>()

  for (const note of notes.value) {
    const parentId = note.parentId && known.has(note.parentId) ? note.parentId : null
    const siblings = byParent.get(parentId)
    if (siblings) siblings.push(note)
    else byParent.set(parentId, [note])
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  }

  const rows: TreeRow[] = []
  const visited = new Set<string>()

  const walk = (parentId: string | null, depth: number) => {
    for (const note of byParent.get(parentId) ?? []) {
      if (visited.has(note.id)) continue
      visited.add(note.id)
      const children = byParent.get(note.id) ?? []
      rows.push({ note, depth, hasChildren: children.length > 0 })
      if (children.length && !collapsed.has(note.id)) walk(note.id, depth + 1)
    }
  }

  walk(null, 0)
  return rows
})

const isDirty = computed(() => active.value !== null && draft.value !== active.value.content)
const canSave = computed(() => active.value !== null && isDirty.value && !busy.value)
const draftTitle = computed(() => {
  const match = draft.value.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || active.value?.title || t('note.untitled')
})

function updateToc(headings: TocHeading[]) {
  toc.value = headings
}

function goToHeading(index: number) {
  editorRef.value?.scrollToHeading(index)
}

function rendererApi() {
  if (!window.api) {
    throw new Error('IPC недоступен: приложение нужно запускать через Electron (npm run dev)')
  }
  return window.api
}

function clearStatus() {
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = undefined
  status.value = ''
  statusError.value = false
  statusKind.value = 'info'
}

function showStatus(
  message: string,
  options: { kind?: StatusKind; error?: boolean; timeout?: number } = {},
) {
  clearStatus()
  status.value = message
  statusError.value = options.error ?? false
  statusKind.value = options.kind ?? (options.error ? 'error' : 'info')
  if (options.timeout) statusTimer = setTimeout(clearStatus, options.timeout)
}

watch(draft, () => {
  if (statusKind.value === 'saved') clearStatus()
})

async function run(action: () => Promise<void>) {
  busy.value = true
  clearStatus()
  try {
    await action()
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error), { error: true })
  } finally {
    busy.value = false
  }
}

async function pruneAssets(noteId: string) {
  try {
    await rendererApi().notes.pruneAssets(noteId)
  } catch (error) {
    console.warn('Не удалось очистить неиспользуемые ассеты:', error)
  }
}

async function refreshNotes() {
  notes.value = await rendererApi().notes.list()
  if (searchMode.value) void runSearch(searchQuery.value)
}

async function runSearch(raw: string) {
  const query = raw.trim()
  if (!query) {
    searchResults.value = []
    searching.value = false
    return
  }

  const request = ++searchRequest
  searching.value = true
  try {
    const results = await rendererApi().search.query(query)
    if (request === searchRequest) searchResults.value = results
  } catch (error) {
    if (request !== searchRequest) return
    searchResults.value = []
    showStatus(error instanceof Error ? error.message : String(error), { error: true })
  } finally {
    if (request === searchRequest) searching.value = false
  }
}

function clearSearch() {
  searchQuery.value = ''
}

watch(searchQuery, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  const query = value.trim()
  searchRequest++

  if (!query) {
    searchResults.value = []
    searching.value = false
    return
  }

  searchResults.value = []
  searching.value = true
  searchTimer = setTimeout(() => void runSearch(query), 200)
})

async function openNote(id: string) {
  if (active.value?.id === id) return
  if (isDirty.value && !confirm(t('confirm.unsavedOpen'))) {
    return
  }
  const previous = active.value
  await run(async () => {
    const note = await rendererApi().notes.read(id)
    active.value = note
    draft.value = note.content
  })
  if (previous && active.value?.id !== previous.id) void pruneAssets(previous.id)
}

async function createNote(parentId: string | null = null) {
  if (isDirty.value && !confirm(t('confirm.unsavedCreate'))) {
    return
  }
  const previous = active.value
  await run(async () => {
    const note = await rendererApi().notes.create({
      title: parentId ? t('note.newChildTitle') : t('note.newTitle'),
      parentId,
    })
    if (parentId) collapsed.delete(parentId)
    await refreshNotes()
    active.value = note
    draft.value = note.content
  })
  if (previous && active.value?.id !== previous.id) void pruneAssets(previous.id)
}

function parentIdOf(id: string): string | null {
  const index = id.lastIndexOf('/')
  return index < 0 ? null : id.slice(0, index)
}

function isDescendant(id: string, ancestorId: string): boolean {
  return id === ancestorId || id.startsWith(`${ancestorId}/`)
}

function descendantCount(id: string): number {
  return notes.value.filter((note) => note.id.startsWith(`${id}/`)).length
}

function toggleCollapse(id: string) {
  if (collapsed.has(id)) collapsed.delete(id)
  else collapsed.add(id)
}

async function moveNote(id: string, parentId: string | null, index = 0) {
  if (id === parentId) return
  await run(async () => {
    const previousActive = active.value
    const meta = await rendererApi().notes.move(id, parentId, index)

    if (parentId) collapsed.delete(parentId)
    await refreshNotes()

    if (previousActive && isDescendant(previousActive.id, id)) {
      const nextId = meta.id + previousActive.id.slice(id.length)
      active.value = { ...previousActive, id: nextId, parentId: parentIdOf(nextId) }
    }
    showStatus(t('status.moved'), { kind: 'moved', timeout: 3000 })
  })
}

async function duplicateNote(note: NoteMeta) {
  closeContextMenu()
  await run(async () => {
    const copy = await rendererApi().notes.duplicate(note.id)
    if (note.parentId) collapsed.delete(note.parentId)
    await refreshNotes()
    showStatus(t('status.duplicated', { title: copy.title }))
  })
}

async function deleteNote(note: NoteMeta) {
  closeContextMenu()
  const count = descendantCount(note.id)
  const message = count
    ? t('confirm.deleteSubtree', { title: note.title, count })
    : t('confirm.delete', { title: note.title })
  if (!confirm(message)) return

  await run(async () => {
    await rendererApi().notes.remove(note.id)
    if (active.value && isDescendant(active.value.id, note.id)) {
      active.value = null
      draft.value = ''
    }
    await refreshNotes()
  })
}

function openContextMenu(event: MouseEvent, note: NoteMeta) {
  contextMenu.value = {
    note,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 196)),
  }
}

function closeContextMenu() {
  contextMenu.value = null
}

function createChild(note: NoteMeta) {
  closeContextMenu()
  void createNote(note.id)
}

function moveToRoot(note: NoteMeta) {
  closeContextMenu()
  void moveNote(note.id, null, 0)
}

function onDragStart(event: DragEvent, note: NoteMeta) {
  if (busy.value) {
    event.preventDefault()
    return
  }
  draggingId.value = note.id
  dragOverId.value = null
  draggingOverRoot.value = false
  dropHint.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', note.id)
  }
}

function onDragEnd() {
  draggingId.value = null
  dragOverId.value = null
  draggingOverRoot.value = false
  dropHint.value = null
}

function canDropOn(target: NoteMeta): boolean {
  const source = draggingId.value
  return Boolean(source) && source !== target.id && !target.id.startsWith(`${source}/`)
}

function onDragOverNote(event: DragEvent, note: NoteMeta) {
  event.stopPropagation()
  if (!canDropOn(note)) {
    dragOverId.value = null
    dropHint.value = null
    return
  }
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

  draggingOverRoot.value = false
  dragOverId.value = null
  dropHint.value = null

  const row = event.currentTarget as HTMLElement | null
  const rect = row?.getBoundingClientRect()
  const ratio = rect && rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5

  if (ratio < 0.3) {
    dropHint.value = {
      id: note.id,
      kind: 'before',
      parentId: note.parentId,
      index: note.position,
    }
  } else if (ratio > 0.7) {
    dropHint.value = {
      id: note.id,
      kind: 'after',
      parentId: note.parentId,
      index: note.position + 1,
    }
  } else {
    dragOverId.value = note.id
  }
}

function onDragLeaveNote(note: NoteMeta) {
  if (dragOverId.value === note.id) dragOverId.value = null
  if (dropHint.value?.id === note.id) dropHint.value = null
}

async function onDropOnNote(event: DragEvent, note: NoteMeta) {
  event.preventDefault()
  event.stopPropagation()
  const source = draggingId.value
  const allowed = canDropOn(note)
  const hint = dropHint.value?.id === note.id ? dropHint.value : null
  const nest = dragOverId.value === note.id
  onDragEnd()

  if (!source || !allowed) return
  if (hint) await moveNote(source, hint.parentId, hint.index)
  else if (nest) await moveNote(source, note.id, 0)
}

function onRootDragOver(event: DragEvent) {
  if (!draggingId.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverId.value = null
  dropHint.value = null
  draggingOverRoot.value = true
}

async function onRootDrop(event: DragEvent) {
  event.preventDefault()
  const source = draggingId.value
  const rootCount = notes.value.filter((note) => note.parentId === null).length
  onDragEnd()
  if (source) await moveNote(source, null, rootCount)
}

async function saveNote() {
  const note = active.value
  if (!note) return
  await run(async () => {
    const meta = await rendererApi().notes.save(note.id, draft.value)
    active.value = { ...note, ...meta, content: draft.value }
    await refreshNotes()
    showStatus(t('status.saved'), { kind: 'saved' })
  })
}

async function removeNote() {
  const note = active.value
  if (!note) return
  await deleteNote(note)
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(locale.value === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(timestamp)
}

async function revealVault() {
  if (!info.value) return
  await run(async () => {
    await rendererApi().app.revealVault()
  })
}

function openSettings() {
  exportOpen.value = false
  closeContextMenu()
  settingsError.value = ''
  settingsOpen.value = true
}

function closeSettings() {
  settingsError.value = ''
  settingsOpen.value = false
}

async function changeVault() {
  if (busy.value) return
  busy.value = true
  settingsError.value = ''
  clearStatus()

  try {
    const result = await rendererApi().app.changeVault()
    if (result.canceled || !result.vaultPath) return
    info.value = await rendererApi().app.info()
    await refreshNotes()
    settingsOpen.value = false
    showStatus(t('status.vaultMoved', { path: result.vaultPath }))
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    busy.value = false
  }
}

async function exportNoteAs(format: ExportFormat) {
  if (!active.value) return
  const noteId = active.value.id
  exportOpen.value = false
  await run(async () => {
    const result = await rendererApi().files.exportNote(format, {
      title: draftTitle.value,
      content: draft.value,
      language: locale.value,
      noteId,
    })
    if (result.canceled || !result.filePath) return
    showStatus(t('status.exported', { name: result.filePath }))
  })
}

async function importDocument() {
  if (isDirty.value && !confirm(t('confirm.unsavedImport'))) return
  const previous = active.value

  await run(async () => {
    const result = await rendererApi().files.importDocument(locale.value)
    if (result.canceled || !result.content) return

    const note = await rendererApi().notes.create({ title: result.title, content: result.content })
    await refreshNotes()
    active.value = note
    draft.value = note.content
    showStatus(t('status.imported', { name: result.title }))
  })
  if (previous && active.value?.id !== previous.id) void pruneAssets(previous.id)
}

function onWindowClick(event: MouseEvent) {
  const target = event.target as Node | null

  if (exportOpen.value) {
    if (exportMenu.value && target && !exportMenu.value.contains(target)) {
      exportOpen.value = false
    }
  }

  if (contextMenu.value) {
    if (contextMenuEl.value && target && !contextMenuEl.value.contains(target)) {
      closeContextMenu()
    }
  }
}

function onWindowKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (canSave.value) void saveNote()
  }
  if (event.key === 'Escape') {
    if (settingsOpen.value) {
      closeSettings()
      return
    }
    if (contextMenu.value) {
      closeContextMenu()
      return
    }
    exportOpen.value = false
    if (searchMode.value) clearSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('click', onWindowClick)
  void run(async () => {
    await Promise.all([loadLanguage(), loadAccent()])
    info.value = await rendererApi().app.info()
    await refreshNotes()

    const first = notes.value[0]
    if (first) {
      const note = await rendererApi().notes.read(first.id)
      active.value = note
      draft.value = note.content
    }
  })
})

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (statusTimer) clearTimeout(statusTimer)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('click', onWindowClick)
})
</script>

<template>
  <div class="app">
    <aside
      id="notes-sidebar"
      class="app__sidebar"
      :class="{ 'app__sidebar--collapsed': !sidebarOpen }"
      :inert="!sidebarOpen"
    >
      <header class="app__sidebar__header">
        <div class="app__sidebar__header__brand">
          <div class="app__sidebar__header__brand-text">
            <h1 class="app__sidebar__header__brand-text__title">thesis 5</h1>
            <button
              class="app__sidebar__header__brand-text__vault-btn"
              type="button"
              :title="t('sidebar.revealVault')"
              :disabled="!info"
              @click="revealVault"
            >
              {{ t('sidebar.openVault') }}
            </button>
          </div>
        </div>
        <div class="app__sidebar__header__actions">
          <button
            class="app__btn app__sidebar__header__actions__lang-btn"
            type="button"
            :title="t('action.toggleLanguage')"
            :aria-label="t('action.toggleLanguage')"
            @click="toggleLanguage"
          >
            {{ locale === 'ru' ? 'RU' : 'EN' }}
          </button>
          <button
            class="app__btn app__sidebar__header__actions__accent-btn"
            type="button"
            :title="t('action.toggleAccent')"
            :aria-label="t('action.toggleAccent')"
            @click="cycleAccent"
          >
            <span class="app__sidebar__header__actions__accent-btn__swatch" aria-hidden="true"></span>
          </button>
          <button
            class="app__btn app__btn--primary app__sidebar__header__actions__create-btn"
            :disabled="busy"
            @click="createNote(null)"
          >
            {{ t('sidebar.create') }}
          </button>
          <button
            class="app__btn app__panel-toggle app__sidebar__header__actions__collapse-btn"
            type="button"
            :title="t('sidebar.collapse')"
            :aria-label="t('sidebar.collapse')"
            :aria-expanded="sidebarOpen"
            aria-controls="notes-sidebar"
            @click="sidebarOpen = false"
          >
            ‹
          </button>
        </div>
      </header>

      <div class="app__sidebar__search">
        <input
          v-model="searchQuery"
          class="app__sidebar__search__input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('search.placeholder')"
          :aria-label="t('search.placeholder')"
          :disabled="busy"
        />
        <button
          v-if="searchQuery"
          class="app__sidebar__search__clear"
          type="button"
          :title="t('search.clear')"
          :aria-label="t('search.clear')"
          @click="clearSearch"
        >
          ×
        </button>
      </div>

      <ul v-if="searchMode" class="app__sidebar__list">
        <li v-for="hit in searchResults" :key="hit.id">
          <button
            class="app__note-item app__sidebar__list-item"
            :class="{ 'app__note-item--active': hit.id === active?.id }"
            @click="openNote(hit.id)"
          >
            <span class="app__note-item__title">{{ hit.title }}</span>
            <span class="app__note-item__snippet">
              <template v-for="(part, index) in splitSearchSnippet(hit.snippet)" :key="index">
                <mark v-if="part.highlight" class="app__note-item__snippet__highlight">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span class="app__note-item__date">{{ formatDate(hit.updatedAt) }}</span>
          </button>
        </li>
        <li v-if="searching" class="app__sidebar__list__empty">{{ t('sidebar.loading') }}</li>
        <li v-else-if="!searchResults.length" class="app__sidebar__list__empty">{{ t('search.empty') }}</li>
      </ul>

      <ul
        v-else
        class="app__sidebar__list"
        @dragover="onRootDragOver"
        @drop="onRootDrop"
      >
        <li v-for="row in treeRows" :key="row.note.id">
          <div
            class="app__sidebar__list__tree-row"
            :class="{ 'app__sidebar__list__tree-row--drop-target': dragOverId === row.note.id }"
            :style="{ paddingLeft: `${row.depth * 14}px` }"
            draggable="true"
            @dragstart="onDragStart($event, row.note)"
            @dragend="onDragEnd"
            @dragover="onDragOverNote($event, row.note)"
            @dragleave="onDragLeaveNote(row.note)"
            @drop="onDropOnNote($event, row.note)"
            @contextmenu.prevent="openContextMenu($event, row.note)"
          >
            <button
              v-if="row.hasChildren"
              class="app__sidebar__list__tree-row__toggle"
              type="button"
              :title="collapsed.has(row.note.id) ? t('tree.expand') : t('tree.collapse')"
              :aria-label="collapsed.has(row.note.id) ? t('tree.expand') : t('tree.collapse')"
              :aria-expanded="!collapsed.has(row.note.id)"
              @click.stop="toggleCollapse(row.note.id)"
            >
              {{ collapsed.has(row.note.id) ? '▸' : '▾' }}
            </button>
            <span v-else class="app__sidebar__list__tree-row__spacer" aria-hidden="true"></span>
            <button
              class="app__note-item app__sidebar__list__tree-row__item"
              :class="{ 'app__note-item--active': row.note.id === active?.id }"
              @click="openNote(row.note.id)"
            >
              <span class="app__note-item__title">{{ row.note.title }}</span>
              <span class="app__note-item__date">{{ formatDate(row.note.updatedAt) }}</span>
            </button>
            <span
              v-if="dropHint?.id === row.note.id && dropHint.kind === 'before'"
              class="app__sidebar__list__tree-row__drop-line app__sidebar__list__tree-row__drop-line--before"
              aria-hidden="true"
            ></span>
            <span
              v-if="dropHint?.id === row.note.id && dropHint.kind === 'after'"
              class="app__sidebar__list__tree-row__drop-line app__sidebar__list__tree-row__drop-line--after"
              aria-hidden="true"
            ></span>
          </div>
        </li>
        <li v-if="draggingId && draggingOverRoot" class="app__sidebar__list__drop-hint">
          {{ t('tree.dropToRoot') }}
        </li>
        <li v-if="!notes.length" class="app__sidebar__list__empty">
          {{ t('sidebar.empty') }}
        </li>
      </ul>

      <footer v-if="info" class="app__sidebar__footer">
        <button
          class="app__btn app__sidebar__footer__btn"
          type="button"
          :title="t('file.import')"
          :disabled="busy"
          @click="importDocument"
        >
          {{ t('sidebar.import') }}
        </button>
        <button
          class="app__btn app__sidebar__footer__btn"
          type="button"
          :title="t('settings.open')"
          :disabled="busy"
          @click="openSettings"
        >
          {{ t('settings.open') }}
        </button>
        <span class="app__sidebar__footer__index-status">
          {{ info.indexDbReady ? t('sidebar.index.ready') : t('sidebar.index.unavailable') }}
        </span>
      </footer>
    </aside>

    <main class="app__content">
      <template v-if="active">
        <header class="app__content__header">
          <button
            v-if="!sidebarOpen"
            class="app__btn app__panel-toggle app__content__reveal-btn"
            type="button"
            :title="t('sidebar.expand')"
            :aria-label="t('sidebar.expand')"
            :aria-expanded="sidebarOpen"
            aria-controls="notes-sidebar"
            @click="sidebarOpen = true"
          >
            ›
          </button>
          <div class="app__content__heading">
            <h2 class="app__content__heading__title">// {{ draftTitle }}</h2>
            <p class="app__content__heading__meta">
              {{ t('status.updated') }}: {{ formatDate(active.updatedAt) }}
              <span v-if="isDirty" class="app__content__heading__meta__dirty">• {{ t('status.dirty') }}</span>
            </p>
          </div>
          <div class="app__content__actions">
            <button
              class="app__btn app__panel-toggle app__content__actions__toc-btn"
              :class="{ 'app__panel-toggle--active': tocOpen }"
              type="button"
              :title="tocOpen ? t('toc.close') : t('toc.open')"
              :aria-label="tocOpen ? t('toc.close') : t('toc.open')"
              :aria-expanded="tocOpen"
              aria-controls="toc-sidebar"
              @click="tocOpen = !tocOpen"
            >
              ☰
            </button>
            <div ref="exportMenu" class="app__content__actions__export">
              <button
                class="app__btn app__btn--save app__content__actions__export__toggle"
                type="button"
                :disabled="busy"
                :aria-expanded="exportOpen"
                aria-haspopup="menu"
                @click="exportOpen = !exportOpen"
              >
                {{ t('file.export') }}
                <span class="app__content__actions__export__toggle__chevron" aria-hidden="true">▾</span>
              </button>
              <ul v-if="exportOpen" class="app__content__actions__export__menu" role="menu">
                <li>
                  <button
                    class="app__content__actions__export__menu__item"
                    role="menuitem"
                    type="button"
                    @click="exportNoteAs('txt')"
                  >
                    {{ t('file.exportTxt') }}
                  </button>
                </li>
                <li>
                  <button
                    class="app__content__actions__export__menu__item"
                    role="menuitem"
                    type="button"
                    @click="exportNoteAs('pdf')"
                  >
                    {{ t('file.exportPdf') }}
                  </button>
                </li>
                <li>
                  <button
                    class="app__content__actions__export__menu__item"
                    role="menuitem"
                    type="button"
                    @click="exportNoteAs('docx')"
                  >
                    {{ t('file.exportDocx') }}
                  </button>
                </li>
                <li>
                  <button
                    class="app__content__actions__export__menu__item"
                    role="menuitem"
                    type="button"
                    @click="exportNoteAs('md')"
                  >
                    {{ t('file.exportMd') }}
                  </button>
                </li>
              </ul>
            </div>
            <button
              class="app__btn app__btn--save app__content__actions__save-btn"
              :disabled="!canSave"
              @click="saveNote"
            >
              {{ t('action.save') }}
            </button>
            <button
              class="app__btn app__btn--danger app__content__actions__delete-btn"
              :disabled="busy"
              @click="removeNote"
            >
              {{ t('action.delete') }}
            </button>
          </div>
        </header>

        <NoteEditor
          :key="active.id + '-' + locale"
          ref="editorRef"
          v-model="draft"
          :note-id="active.id"
          @toc="updateToc"
        />
      </template>

      <template v-else>
        <button
          v-if="!sidebarOpen"
          class="app__btn app__panel-toggle app__content__reveal-btn app__content__reveal-btn--empty"
          type="button"
          :title="t('sidebar.expand')"
          :aria-label="t('sidebar.expand')"
          :aria-expanded="sidebarOpen"
          aria-controls="notes-sidebar"
          @click="sidebarOpen = true"
        >
          ›
        </button>
        <div class="app__content__placeholder">
          <h2 class="app__content__placeholder__title">{{ t('placeholder.title') }}</h2>
          <p class="app__content__placeholder__text">{{ t('placeholder.text') }}</p>
        </div>
      </template>

      <p
        v-if="status"
        class="app__content__status"
        :class="{ 'app__content__status--error': statusError }"
      >
        {{ status }}
      </p>
    </main>

    <aside
      id="toc-sidebar"
      class="app__toc"
      :class="{ 'app__toc--collapsed': !tocOpen || !active }"
      :aria-hidden="!tocOpen || !active"
      :inert="!tocOpen || !active"
    >
      <div v-if="active" class="app__toc__inner">
        <header class="app__toc__header">
          <span class="app__toc__header__title">{{ t('toc.title') }}</span>
          <button
            class="app__btn app__panel-toggle app__toc__header__close-btn"
            type="button"
            :title="t('toc.close')"
            :aria-label="t('toc.close')"
            :aria-expanded="tocOpen"
            aria-controls="toc-sidebar"
            @click="tocOpen = false"
          >
            ×
          </button>
        </header>
        <nav v-if="toc.length" class="app__toc__nav" :aria-label="t('toc.title')">
          <button
            v-for="(heading, index) in toc"
            :key="index"
            class="app__toc__nav__link"
            :class="`app__toc__nav__link--level-${heading.level}`"
            type="button"
            :title="heading.text || t('note.untitled')"
            :style="{ paddingLeft: `${10 + Math.max(0, heading.level - 1) * 12}px` }"
            @click="goToHeading(index)"
          >
            {{ heading.text || t('note.untitled') }}
          </button>
        </nav>
        <p v-else class="app__toc__empty">{{ t('toc.empty') }}</p>
      </div>
    </aside>

    <div v-if="settingsOpen" class="app__modal-overlay" @click.self="closeSettings">
      <section
        class="app__modal-overlay__dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('settings.title')"
      >
        <header class="app__modal-overlay__dialog__header">
          <h2 class="app__modal-overlay__dialog__header__title">{{ t('settings.title') }}</h2>
          <button
            class="app__modal-overlay__dialog__header__close-btn"
            type="button"
            :title="t('settings.close')"
            :aria-label="t('settings.close')"
            @click="closeSettings"
          >
            ×
          </button>
        </header>
        <div class="app__modal-overlay__dialog__body">
          <h3 class="app__modal-overlay__dialog__body__title">{{ t('settings.vault') }}</h3>
          <p class="app__modal-overlay__dialog__body__hint">{{ t('settings.vaultHint') }}</p>
          <code class="app__modal-overlay__dialog__body__path">{{ info?.vaultPath ?? '—' }}</code>
          <p class="app__modal-overlay__dialog__body__hint">{{ t('settings.moveHint') }}</p>
          <div class="app__modal-overlay__dialog__body__actions">
            <button
              class="app__btn app__btn--save app__modal-overlay__dialog__body__actions__btn"
              type="button"
              :disabled="busy"
              @click="changeVault"
            >
              {{ t('settings.changeVault') }}
            </button>
            <button
              class="app__btn app__btn--save app__modal-overlay__dialog__body__actions__btn"
              type="button"
              :disabled="!info || busy"
              @click="revealVault"
            >
              {{ t('settings.reveal') }}
            </button>
          </div>
          <p v-if="settingsError" class="app__modal-overlay__dialog__body__error">{{ settingsError }}</p>
        </div>
        <footer class="app__modal-overlay__dialog__footer">
          <button
            class="app__btn app__btn--primary app__modal-overlay__dialog__footer__btn"
            type="button"
            @click="closeSettings"
          >
            {{ t('settings.close') }}
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="contextMenu"
      ref="contextMenuEl"
      class="app__context-menu"
      role="menu"
      :aria-label="t('tree.actions')"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <button
        class="app__context-menu__item"
        role="menuitem"
        type="button"
        @click="createChild(contextMenu.note)"
      >
        {{ t('tree.newChild') }}
      </button>
      <button
        class="app__context-menu__item"
        role="menuitem"
        type="button"
        @click="duplicateNote(contextMenu.note)"
      >
        {{ t('tree.duplicate') }}
      </button>
      <button
        class="app__context-menu__item"
        role="menuitem"
        type="button"
        :disabled="!contextMenu.note.parentId"
        @click="moveToRoot(contextMenu.note)"
      >
        {{ t('tree.moveToRoot') }}
      </button>
      <button
        class="app__context-menu__item app__context-menu__item--danger"
        role="menuitem"
        type="button"
        @click="deleteNote(contextMenu.note)"
      >
        {{ t('action.delete') }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.app {
  display: flex;
  height: 100vh;
  margin: 0;
  overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--color-light-main);
  background: var(--color-dark-main);

  &__panel-toggle {
    flex-shrink: 0;
    font-size: 18px;
    letter-spacing: normal;
    text-transform: none;

    &--active {
      color: var(--color-light-muted);
      border-color: var(--color-light-extra-muted);
      background: var(--color-accent-main-op10);
    }
  }


  &__btn--danger {
    border-color: transparent;

    &:hover:not(:disabled) {
      border-color: var(--color-danger);
      color: var(--color-danger);
    }
  }

  &__note-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    padding: 10px 12px;
    margin-bottom: 4px;
    border: 1px solid transparent;
    border-radius: 8px;
    background-color: var(--color-dark-main);
    text-align: left;
    cursor: pointer;
    transition: .2s;

    &:hover {
      background: var(--color-accent-main-op10);
    }

    &--active {
      background: var(--color-accent-main-op15);

      &:hover {
        background: var(--color-accent-main-op15);
        color: var(--color-light-main);
      }

      .app__note-item__title {
        color: var(--color-accent-secondary);
      }

      .app__note-item__date {
        color: var(--color-light-muted);
      }
    }

    &__title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-accent-secondary-op95);
    }

    &__snippet {
      display: -webkit-box;
      overflow: hidden;
      font-size: 11px;
      line-height: 1.45;
      color: var(--color-light-muted);
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 2;

      &__highlight {
        padding: 0 1px;
        border-radius: 3px;
        background: var(--color-accent-secondary-op35);
        color: var(--color-light-secondary);
      }
    }

    &__date {
      font-size: 11px;
      color: var(--color-light-extra-muted);
    }
  }

  &__sidebar {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    width: 320px;
    min-height: 0;
    overflow: hidden;
    border-right: 1px solid var(--color-light-extra-muted);
    background: var(--color-dark-main);
    box-sizing: border-box;
    transition: margin-left .26s ease, border-color .26s ease;

    &--collapsed {
      margin-left: -320px;
      border-right-color: transparent;
    }

    &__header {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: 12px;
      padding: 8px 16px 16px 16px;
      border-bottom: 1px solid var(--color-light-extra-muted);
      flex-shrink: 0;

      &__brand {
        display: flex;
        align-items: flex-start;
      }

      &__brand-text {
        flex: 1;
        min-width: 0;

        &__title {
          margin: 0;
          font-size: 32px;
          color: var(--color-accent-main);
          text-transform: uppercase;
          letter-spacing: 6px;
        }

        &__vault-btn {
          display: block;
          margin: 4px 0 0;
          padding: 0;
          border: none;
          background: transparent;
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          text-align: left;
          font-family: inherit;
          font-size: 10px;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-light-extra-muted);
          cursor: pointer;
          transition: .2s;

          &:hover:not(:disabled),
          &:focus-visible:not(:disabled) {
            color: var(--color-accent-secondary);
            outline: none;
            border: none;
          }

          &:disabled {
            cursor: default;
          }
        }
      }

      &__actions {
        display: flex;
        align-items: center;
        gap: 8px;

        &__lang-btn {
          padding: 0 8px;
        }

        &__accent-btn {
          padding: 0 8px;



          &:hover:not(:disabled),
          &:focus-visible:not(:disabled) {
            outline: none;
          }

          &__swatch {
            width: 18px;
            height: 18px;
            border-radius: 50%;
            background: linear-gradient(
              90deg,
              var(--color-accent-main-op75) 0 50%,
              var(--color-accent-secondary-op75) 50% 100%
            );
          }
        }

        &__collapse-btn {
          margin-left: auto;
        }
      }
    }

    &__search {
      position: relative;
      padding: 12px 16px 4px;
      flex-shrink: 0;

      &__input {
        width: 100%;
        box-sizing: border-box;
        padding: 9px 36px 9px 12px;
        border: 1px solid var(--color-light-extra-muted);
        border-radius: 8px;
        background: var(--color-accent-main-op05);
        color: var(--color-light-secondary);
        font-family: inherit;
        font-size: 13px;
        transition: .2s;

        &::placeholder {
          color: var(--color-light-muted);
        }

        &:hover:not(:disabled) {
          border-color: var(--color-accent-main-op35);
        }

        &:focus {
          outline: none;
          border-color: var(--color-accent-main-op25);
          box-shadow: 0 0 0 2px var(--color-accent-main-op15);
        }
      }

      &__clear {
        position: absolute;
        top: 50%;
        right: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        transform: translateY(-50%);
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--color-light-muted);
        font-size: 16px;
        line-height: 1;

        &:hover,
        &:focus-visible {
          border: none;
          border-radius: 50%;
          background: var(--color-accent-main-op15);
          color: var(--color-accent-main);
        }
      }
    }

    &__list {
      list-style: none;
      margin: 0;
      padding: 8px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;

      &-item {
        min-width: 0;
      }

      &__tree-row {
        position: relative;
        display: flex;
        align-items: stretch;
        gap: 2px;
        margin-bottom: 4px;
        border-radius: 8px;

        &--drop-target {
          outline: 1px dashed var(--color-accent-main-op75);
          outline-offset: 2px;
        }

        &__toggle {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 20px;
          height: 48px;
          border: none;
          padding: 0;
          border-radius: 4px;
          background: transparent;
          color: var(--color-accent-secondary-op60);
          font-size: 14px;
          line-height: 1;
          transition: .2s;

          &:hover,
          &:focus-visible {
            border: none;
            border-radius: 4px;
            background: var(--color-accent-main-op15);
            color: var(--color-accent-secondary);
          }
        }

        &__spacer {
          flex-shrink: 0;
          width: 20px;
          align-self: center;
        }

        &__item {
          flex: 1;
          width: auto;
          min-width: 0;
          margin-bottom: 0;
        }

        &__drop-line {
          position: absolute;
          left: 0;
          right: 0;
          z-index: 2;
          height: 2px;
          border-radius: 2px;
          background: var(--color-accent-main);
          pointer-events: none;

          &::before {
            position: absolute;
            top: 50%;
            left: -3px;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--color-accent-main);
            content: '';
            transform: translateY(-50%);
          }

          &--before {
            top: -3px;
          }

          &--after {
            bottom: -3px;
          }
        }
      }

      &__empty {
        padding: 16px;
        font-size: 13px;
        color: var(--color-accent-secondary-muted);
      }

      &__drop-hint {
        padding: 10px 12px;
        border: 1px dashed var(--color-accent-main-op35);
        border-radius: 8px;
        color: var(--color-accent-main);
        font-size: 11px;
        text-align: center;
      }
    }

    &__footer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 16px;
      border-top: 1px solid var(--color-light-extra-muted);
      font-size: 11px;
      color: var(--color-light-extra-muted);
      flex-shrink: 0;

      &__btn {
        width: 100%;
      }

      &__index-status {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
  }

  &__content {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 24px 28px 16px;
    background-color: var(--color-dark-main);

    &__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      flex-shrink: 0;
    }

    &__reveal-btn {
      align-self: flex-start;

      &--empty {
        margin-bottom: 12px;
      }
    }

    &__heading {
      flex: 1;
      min-width: 0;

      &__title {
        margin: 0;
        font-size: 22px;
        font-weight: 400;
        color: var(--color-light-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &__meta {
        margin: 4px 0 0;
        font-size: 12px;
        color: var(--color-light-extra-muted);

        &__dirty {
          padding: 2px 8px;
          border-radius: 4px;
          background-color: var(--color-danger-op15);
          color: var(--color-light-muted);
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
        }
      }
    }

    &__actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;

      &__export {
        position: relative;

        &__toggle {
          gap: 6px;

          &__chevron {
            font-size: 10px;
            line-height: 1;
            opacity: .7;
          }
        }

        &__menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          z-index: 20;
          min-width: 190px;
          margin: 0;
          padding: 6px;
          list-style: none;
          border: 1px solid var(--color-accent-main-op35);
          border-radius: 10px;
          background: var(--color-dark-secondary);
          box-shadow: 0 12px 30px color-mix(in srgb, var(--color-dark-main) 70%, transparent);

          &__item {
            width: 100%;
            padding: 9px 12px;
            border: none;
            border-radius: 7px;
            background: transparent;
            color: var(--color-light-muted);
            font-size: 12px;
            letter-spacing: .5px;
            text-align: left;
            transition: .2s;

            &:hover:not(:disabled),
            &:focus-visible:not(:disabled) {
              background: var(--color-accent-main-op15);
              color: var(--color-light-secondary);
              border-radius: 7px;
              outline: none;
            }
          }
        }
      }
    }

    &__placeholder {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--color-light-muted);
      text-align: center;

      &__title {
        margin: 0 0 8px;
        color: var(--color-light-muted);
      }

      &__text {
        margin: 0;
      }
    }

    &__status {
      margin: 12px 0 0;
      font-size: 12px;
      color: var(--color-light-extra-muted);

      &--error {
        color: var(--color-danger);
      }
    }
  }

  &__toc {
    flex-shrink: 0;
    width: 240px;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid var(--color-light-extra-muted);
    background: var(--color-dark-main);
    box-sizing: border-box;
    transition: margin-right .26s ease, border-color .26s ease;

    &--collapsed {
      margin-right: -240px;
      border-left-color: transparent;
    }

    &__inner {
      display: flex;
      flex-direction: column;
      width: 240px;
      height: 100%;
      min-height: 0;
    }

    &__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 14px 14px 12px 16px;
      border-bottom: 1px solid var(--color-light-extra-muted);
      flex-shrink: 0;

      &__title {
        font-size: 14px;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        color: var(--color-light-muted);
      }

      &__close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border-color: transparent;
        border-radius: 5%;
        font-size: 18px;
        color: var(--color-light-muted);
        &:hover{
          border-radius: 50%;
          color: var(--color-danger);
          border-color: transparent;
        }
      }
    }

    &__nav {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 10px 8px 16px;

      &__link {
        display: block;
        width: 100%;
        padding: 7px 10px;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--color-light-muted);
        font-family: inherit;
        font-size: 12px;
        letter-spacing: 1px;
        line-height: 1.4;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
        transition: .15s;

        &:hover,
        &:focus-visible {
          color: var(--color-accent-secondary);
          background: var(--color-dark-secondary);
          outline: none;
        }

        &--level-1 {
          color: var(--color-light-muted);
          font-size: 13px;
          font-weight: 500;
        }
      }
    }

    &__empty {
      margin: 16px;
      color: var(--color-light-extra-muted);
      font-size: 12px;
      line-height: 1.5;
    }
  }

  &__modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, var(--color-dark-main) 75%, transparent);

    &__dialog {
      display: flex;
      flex-direction: column;
      width: min(560px, 100%);
      max-height: calc(100vh - 48px);
      overflow: hidden;
      border: 1px solid var(--color-accent-main-op35);
      border-radius: 14px;
      background: var(--color-dark-secondary);
      box-shadow: 0 24px 60px color-mix(in srgb, var(--color-dark-main) 70%, transparent);

      &__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-light-extra-muted);

        &__title {
          margin: 0;
          font-size: 18px;
          font-weight: 400;
          color: var(--color-accent-secondary);
        }

        &__close-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          padding: 0;
          border: none;
          border-radius: 5%;
          background: transparent;
          color: var(--color-light-muted);
          font-size: 22px;
          line-height: 1;
          transition: .2s;

          &:hover,
          &:focus-visible {
            border: none;
            border-radius: 50%;
            background: var(--color-danger-op50);
            color: var(--color-light-main);
          }
        }
      }

      &__body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        overflow-y: auto;

        &__title {
          margin: 0;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--color-light-muted);
        }

        &__hint {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--color-light-extra-muted);
        }

        &__path {
          display: block;
          padding: 10px 12px;
          border: 1px solid var(--color-light-extra-muted);
          border-radius: 8px;
          background: var(--color-dark-main);
          color: var(--color-light-secondary);
          font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
          font-size: 12px;
          white-space: pre-wrap;
          word-break: break-all;
        }

        &__actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 4px;

          &__btn {
            &:hover:not(:disabled) {
              border-color: var(--color-accent-secondary);
              color: var(--color-accent-secondary);
            }
          }
        }

        &__error {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--color-danger);
        }
      }

      &__footer {
        display: flex;
        justify-content: flex-end;
        padding: 14px 20px;
        border-top: 1px solid var(--color-light-extra-muted);
      }
    }
  }

  &__context-menu {
    position: fixed;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 216px;
    padding: 6px;
    border: 1px solid var(--color-accent-main-op35);
    border-radius: 10px;
    background: var(--color-dark-secondary);
    box-shadow: 0 12px 30px color-mix(in srgb, var(--color-dark-main) 70%, transparent);

    &__item {
      width: 100%;
      padding: 9px 12px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--color-light-muted);
      font-size: 12px;
      letter-spacing: .5px;
      text-align: left;

      &:hover:not(:disabled),
      &:focus-visible:not(:disabled) {
        border: none;
        border-radius: 7px;
        background: var(--color-accent-main-op15);
        color: var(--color-light-main);
      }

      &--danger {
        color: var(--color-danger-op85);

        &:hover:not(:disabled),
        &:focus-visible:not(:disabled) {
          background: var(--color-danger-op15);
          color: var(--color-danger);
        }
      }
    }
  }
}
</style>
