import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { VueRenderer } from '@tiptap/vue-3'
import type { AppLanguage } from '~/shared/api'
import SlashMenu from './SlashMenu.vue'
import { filterSlashItems, type ResolvedSlashItem } from './slash-items'

export interface SlashCommandOptions {
  language: AppLanguage
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { language: 'en' }
  },

  addProseMirrorPlugins() {
    const language = this.options.language

    return [
      Suggestion<ResolvedSlashItem, ResolvedSlashItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterSlashItems(query, language),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          return $from.parent.type.name !== 'codeBlock'
        },
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        render: () => {
          let component: VueRenderer | null = null
          let unmount: (() => void) | null = null

          return {
            onStart: (props) => {
              component = new VueRenderer(SlashMenu, {
                props: {
                  items: props.items,
                  command: props.command,
                },
                editor: props.editor,
              })

              if (component.element) {
                unmount = props.mount(component.element as HTMLElement)
              }
            },
            onUpdate: (props) => {
              component?.updateProps({
                items: props.items,
                command: props.command,
              })
            },
            onKeyDown: (props) => component?.ref?.onKeyDown(props) ?? false,
            onExit: () => {
              unmount?.()
              unmount = null
              component?.destroy()
              component = null
            },
          }
        },
      }),
    ]
  },
})
