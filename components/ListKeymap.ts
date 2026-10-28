import { Extension } from '@tiptap/core'

export const ListKeymap = Extension.create({
  name: 'listKeymap',

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const { editor } = this
        if (editor.isActive('listItem')) {
          editor.commands.sinkListItem('listItem')
          return true
        }
        if (editor.isActive('taskItem')) {
          editor.commands.sinkListItem('taskItem')
          return true
        }
        return false
      },
      'Shift-Tab': () => {
        const { editor } = this
        if (editor.isActive('listItem')) {
          editor.commands.liftListItem('listItem')
          return true
        }
        if (editor.isActive('taskItem')) {
          editor.commands.liftListItem('taskItem')
          return true
        }
        return false
      },
    }
  },
})
