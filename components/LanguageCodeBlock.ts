import { mergeAttributes } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'

export const LanguageCodeBlock = CodeBlock.extend({
  renderHTML({ node, HTMLAttributes }) {
    const language = typeof node.attrs.language === 'string' ? node.attrs.language.trim() : ''
    const attributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
    if (language) attributes['data-language'] = language

    return [
      'pre',
      attributes,
      [
        'code',
        {
          class:
            language && this.options.languageClassPrefix
              ? `${this.options.languageClassPrefix}${language}`
              : null,
        },
        0,
      ],
    ]
  },
})
