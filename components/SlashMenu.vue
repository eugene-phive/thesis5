<script setup lang="ts">
import type { ResolvedSlashItem } from './slash-items'

const { t } = useI18n()

const props = defineProps<{
  items: ResolvedSlashItem[]
  command: (item: ResolvedSlashItem) => void
}>()

const selectedIndex = ref(0)
const listRef = ref<HTMLElement | null>(null)

watch(() => props.items, () => {
  selectedIndex.value = 0
})

watch(selectedIndex, async (index) => {
  await nextTick()
  const element = listRef.value?.children[index] as HTMLElement | undefined
  element?.scrollIntoView({ block: 'nearest' })
})

function select(index: number) {
  const item = props.items[index]
  if (item) props.command(item)
}

function onKeyDown({ event }: { event: KeyboardEvent }): boolean {
  if (!props.items.length) return false

  if (event.key === 'ArrowUp') {
    selectedIndex.value = (selectedIndex.value + props.items.length - 1) % props.items.length
    return true
  }

  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
    return true
  }

  if (event.key === 'Enter' || event.key === 'Tab') {
    select(selectedIndex.value)
    return true
  }

  return false
}

defineExpose({ onKeyDown })
</script>

<template>
  <div class="slash-menu" role="listbox" :aria-label="t('slash.blocks')">
    <header class="slash-menu__header">
      <span>{{ t('slash.blocks') }}</span>
      <span class="slash-menu__header__hint">↑↓ · Enter</span>
    </header>

    <div ref="listRef" class="slash-menu__list">
      <button
        v-for="(item, index) in items"
        :key="item.title"
        type="button"
        class="slash-menu__list__item"
        :class="{ 'slash-menu__list__item--selected': index === selectedIndex }"
        role="option"
        :aria-selected="index === selectedIndex"
        @mouseenter="selectedIndex = index"
        @mousedown.prevent
        @click="select(index)"
      >
        <span class="slash-menu__list__item__icon">{{ item.icon }}</span>
        <span class="slash-menu__list__item__text">
          <span class="slash-menu__list__item__text__title">{{ item.title }}</span>
          <span class="slash-menu__list__item__text__description">{{ item.description }}</span>
        </span>
      </button>

      <p v-if="!items.length" class="slash-menu__list__empty">{{ t('slash.empty') }}</p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.slash-menu {
  z-index: 1000;
  display: flex;
  flex-direction: column;
  width: 280px;
  max-height: 340px;
  overflow: hidden;
  border: 1px solid var(--color-accent-main-op45);
  border-radius: 12px;
  background: var(--color-dark-tertiary);
  box-shadow: 0 12px 32px var(--color-dark-main);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--color-light-main);

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-light-extra-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--color-light-muted);

    &__hint {
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
    }
  }

  &__list {
    padding: 6px;
    overflow-y: auto;

    &__item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: .2s;

      &--selected {
        background: var(--color-accent-main-op10);
      }

      &__icon {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 30px;
        height: 30px;
        border-radius: 8px;
        background: var(--color-dark-secondary);
        font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-accent-secondary);
      }

      &__text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;

        &__title {
          font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
          font-size: 13px;
          font-weight: 500;
          color: var(--color-light-secondary);
        }

        &__description {
          font-size: 11px;
          color: var(--color-light-muted);
        }
      }
    }

    &__empty {
      margin: 0;
      padding: 12px;
      font-size: 12px;
      color: var(--color-light-muted);
      text-align: center;
    }
  }
}
</style>
