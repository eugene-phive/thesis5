import { promises as fs } from 'node:fs'
import path from 'node:path'
import { marked, type Token, type Tokens } from 'marked'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import mammoth from 'mammoth'
import { ensureTitleHeading, textToMarkdown } from '../shared/markdown'
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const

const CODE_FONT = 'Consolas'
const ACCENT_COLOR = '8B5CF6'
const CODE_FILL = 'F3F0FF'
const HEADER_FILL = 'EFEAFE'
const BULLET_REFERENCE = 'thesis-bullet'
const DECIMAL_REFERENCE = 'thesis-decimal'

const NUMBERING_CONFIG = [
  { reference: BULLET_REFERENCE, levels: numberingLevels(LevelFormat.BULLET) },
  { reference: DECIMAL_REFERENCE, levels: numberingLevels(LevelFormat.DECIMAL) },
]

interface RunStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
  link?: boolean
}

export function markdownToPlainText(markdown: string): string {
  const blocks = plainBlocks(marked.lexer(markdown))
  return `${blocks.filter(Boolean).join('\n\n').trim()}\n`
}

export function markdownToPdfHtml(markdown: string, title: string): string {
  const rendered = marked.parse(markdown, { async: false }) as string
  const body = stripScripts(rendered)
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #1f1f1f;
    background: #ffffff;
  }
  h1, h2, h3, h4, h5, h6 { color: #4c1d95; line-height: 1.25; margin: 1.2em 0 0.5em; }
  h1 { font-size: 24pt; margin-top: 0; }
  h2 { font-size: 18pt; }
  h3 { font-size: 15pt; }
  h4, h5, h6 { font-size: 13pt; }
  p { margin: 0.5em 0; }
  ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
  li { margin: 0.2em 0; }
  blockquote {
    margin: 0.8em 0;
    padding: 0.2em 0 0.2em 14px;
    border-left: 3px solid #8b5cf6;
    color: #4b4b4b;
  }
  code {
    font-family: 'Cascadia Mono', Consolas, monospace;
    font-size: 0.9em;
    background: #f3f0ff;
    color: #6d28d9;
    border-radius: 4px;
    padding: 0.1em 0.3em;
  }
  pre {
    background: #f6f4ff;
    border: 1px solid #e5defc;
    border-radius: 8px;
    padding: 10px 12px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  hr { border: none; border-top: 1px solid #c4b5fd; margin: 1.4em 0; }
  a { color: #6d28d9; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border: 1px solid #ddd6fe; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f3f0ff; }
  img { max-width: 100%; }
  del { color: #6b7280; }
</style>
</head>
<body>${body}</body>
</html>`
}

export async function markdownToDocx(markdown: string, title: string): Promise<Buffer> {
  const children = docxBlocks(marked.lexer(markdown))
  const document = new Document({
    title,
    description: title,
    numbering: { config: NUMBERING_CONFIG },
    styles: {
      paragraphStyles: [
        {
          id: 'Code',
          name: 'Code',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: CODE_FONT, size: 20 },
        },
      ],
    },
    sections: [
      {
        properties: {},
        children: children.length ? children : [new Paragraph({ text: title })],
      },
    ],
  })
  return Packer.toBuffer(document)
}

export async function docxToMarkdown(filePath: string): Promise<{ title: string; content: string }> {
  const result = await mammoth.convertToHtml(
    { path: filePath },
    { styleMap: ["p[style-name='Code'] => pre"] },
  )
  const html = result.value
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/(<t[hd][^>]*>)\s*<p>/gi, '$1')
    .replace(/<\/p>\s*(<\/t[hd]>)/gi, '$1')

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  })
  turndown.use(gfm)
  turndown.addRule('strikethrough', {
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  })
  turndown.addRule('plainPre', {
    filter: (node) =>
      node.nodeName === 'PRE' && !(node.firstChild && node.firstChild.nodeName === 'CODE'),
    replacement: (content) => {
      const code = content.replace(/ {2}\n/g, '\n').replace(/\n+$/, '')
      return `\n\n\`\`\`\n${code}\n\`\`\`\n\n`
    },
  })
  const markdown = turndown.turndown(html).replace(/\n{3,}/g, '\n\n')

  return ensureTitleHeading(markdown, fallbackTitle(filePath))
}

export async function markdownFileToNote(
  filePath: string,
): Promise<{ title: string; content: string }> {
  const raw = await fs.readFile(filePath, 'utf8')
  return ensureTitleHeading(raw, fallbackTitle(filePath))
}

export async function textFileToNote(
  filePath: string,
): Promise<{ title: string; content: string }> {
  const raw = await fs.readFile(filePath, 'utf8')
  return ensureTitleHeading(textToMarkdown(raw), fallbackTitle(filePath))
}

function fallbackTitle(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).trim() || 'Untitled'
}

function plainBlocks(tokens: Token[], level = 0): string[] {
  const result: string[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
      case 'paragraph':
      case 'text':
        result.push(inlineText(inlineTokens(token)))
        break
      case 'blockquote': {
        const inner = plainBlocks(childTokens(token), level).join('\n')
        result.push(inner.split('\n').map((line) => `> ${line}`).join('\n'))
        break
      }
      case 'code':
        result.push(token.text)
        break
      case 'list':
        result.push(plainList(token as Tokens.List, level))
        break
      case 'table':
        result.push(plainTable(token as Tokens.Table))
        break
      case 'hr':
        result.push('-'.repeat(40))
        break
      case 'html': {
        const text = stripHtml(token.text).trim()
        if (text) result.push(text)
        break
      }
      case 'space':
      case 'def':
        break
      default: {
        const text = inlineText(inlineTokens(token))
        if (text.trim()) result.push(text.trim())
      }
    }
  }

  return result
}

function plainList(token: Tokens.List, level: number): string {
  const lines: string[] = []
  const start = Number(token.start || 1)

  token.items.forEach((item, index) => {
    const marker = token.ordered ? `${start + index}.` : '-'
    const indent = '  '.repeat(level)
    const content = item.tokens
      .filter((child) => child.type !== 'list' && child.type !== 'space')
      .map((child) => inlineText(inlineTokens(child)).trim())
      .filter(Boolean)
      .join(' ')
    lines.push(`${indent}${marker} ${content}`)

    for (const child of item.tokens) {
      if (child.type === 'list') lines.push(plainList(child as Tokens.List, level + 1))
    }
  })

  return lines.join('\n')
}

function plainTable(token: Tokens.Table): string {
  const rows = [token.header, ...token.rows].map((cells) =>
    cells.map((cell) => inlineText(cell.tokens).trim().replace(/\s+/g, ' ')).join(' | '),
  )
  const separator = token.header
    .map(() => '---')
    .join(' | ')
  return [rows[0], separator, ...rows.slice(1)].join('\n')
}

function inlineText(tokens: Token[]): string {
  let result = ''

  for (const token of tokens) {
    switch (token.type) {
      case 'br':
        result += '\n'
        break
      case 'codespan':
      case 'escape':
        result += token.text
        break
      case 'image':
        result += token.text || ''
        break
      case 'link':
        result += inlineTokens(token).length ? inlineText(inlineTokens(token)) : token.text
        break
      case 'html': {
        const text = stripHtml(token.text)
        if (text) result += text
        break
      }
      default: {
        const nested = inlineTokens(token)
        result += nested.length ? inlineText(nested) : textOf(token)
      }
    }
  }

  return result
}

function inlineTokens(token: Token): Token[] {
  if ('tokens' in token && Array.isArray(token.tokens) && token.tokens.length) {
    return token.tokens
  }
  return []
}

function childTokens(token: Token): Token[] {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return token.tokens
  }
  return []
}

function textOf(token: Token): string {
  if ('text' in token && typeof token.text === 'string') return token.text
  return ''
}

function docxBlocks(tokens: Token[]): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = []
  let listInstance = 0

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const level = Math.min(Math.max(token.depth, 1), 6) - 1
        children.push(
          new Paragraph({
            heading: HEADINGS[level],
            children: docxRuns(inlineTokens(token)),
            spacing: { before: 200, after: 100 },
          }),
        )
        break
      }
      case 'paragraph':
        children.push(
          new Paragraph({
            children: docxRuns(inlineTokens(token)),
            spacing: { after: 120 },
          }),
        )
        break
      case 'text':
        children.push(new Paragraph({ children: docxRuns(inlineTokens(token)) }))
        break
      case 'blockquote':
        children.push(
          new Paragraph({
            children: docxRuns(inlineTokens(token)),
            indent: { left: 360 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT_COLOR, space: 8 },
            },
            spacing: { after: 120 },
          }),
        )
        break
      case 'code':
        children.push(codeParagraph(token.text))
        break
      case 'list':
        children.push(...docxList(token as Tokens.List, 0, ++listInstance))
        break
      case 'table':
        children.push(docxTable(token as Tokens.Table))
        break
      case 'hr':
        children.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_COLOR } },
            spacing: { before: 120, after: 120 },
          }),
        )
        break
      case 'html': {
        const text = stripHtml(token.text).trim()
        if (text) children.push(new Paragraph({ text, spacing: { after: 120 } }))
        break
      }
      case 'space':
      case 'def':
        break
      default: {
        const text = inlineText(inlineTokens(token)).trim()
        if (text) children.push(new Paragraph({ text, spacing: { after: 120 } }))
      }
    }
  }

  return children
}

function codeParagraph(code: string): Paragraph {
  const lines = code.length ? code.split('\n') : ['']
  const runs: TextRun[] = []

  lines.forEach((line, index) => {
    if (index > 0) runs.push(new TextRun({ break: 1 }))
    runs.push(new TextRun({ text: line || ' ', font: CODE_FONT, size: 20 }))
  })

  return new Paragraph({
    children: runs,
    style: 'Code',
    shading: { type: ShadingType.CLEAR, fill: CODE_FILL },
    spacing: { before: 120, after: 120 },
  })
}

function docxList(token: Tokens.List, level: number, instance: number): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const reference = token.ordered ? DECIMAL_REFERENCE : BULLET_REFERENCE

  token.items.forEach((item) => {
    const inline = item.tokens
      .filter((child) => child.type !== 'list' && child.type !== 'space')
      .flatMap((child) => {
        const nested = inlineTokens(child)
        return nested.length ? nested : [child]
      })

    paragraphs.push(
      new Paragraph({
        children: docxRuns(inline),
        numbering: { reference, level, instance },
        spacing: { after: 60 },
      }),
    )

    for (const child of item.tokens) {
      if (child.type === 'list') {
        paragraphs.push(...docxList(child as Tokens.List, level + 1, instance))
      }
    }
  })

  return paragraphs
}

function numberingLevels(format: (typeof LevelFormat)[keyof typeof LevelFormat]) {
  return Array.from({ length: 6 }, (_, level) => ({
    level,
    format,
    text:
      format === LevelFormat.BULLET
        ? ['•', '◦', '▪'][level % 3]
        : `${Array.from({ length: level + 1 }, (_, index) => `%${index + 1}`).join('.')}.`,
    alignment: AlignmentType.LEFT,
    style: {
      paragraph: {
        indent: { left: 720 * (level + 1), hanging: 360 },
      },
    },
  }))
}

function docxTable(token: Tokens.Table): Table {
  const rows = [token.header, ...token.rows].map(
    (cells, rowIndex) =>
      new TableRow({
        tableHeader: rowIndex === 0,
        children: cells.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: docxRuns(cell.tokens) })],
              shading:
                rowIndex === 0
                  ? { type: ShadingType.CLEAR, fill: HEADER_FILL }
                  : undefined,
            }),
        ),
      }),
  )

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

function docxRuns(tokens: Token[], style: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        runs.push(...docxRuns(inlineTokens(token), { ...style, bold: true }))
        break
      case 'em':
        runs.push(...docxRuns(inlineTokens(token), { ...style, italics: true }))
        break
      case 'del':
        runs.push(...docxRuns(inlineTokens(token), { ...style, strike: true }))
        break
      case 'link':
        runs.push(...docxRuns(inlineTokens(token), { ...style, link: true }))
        break
      case 'codespan':
        runs.push(
          new TextRun({
            text: token.text,
            font: CODE_FONT,
            shading: { type: ShadingType.CLEAR, fill: CODE_FILL },
          }),
        )
        break
      case 'br':
        runs.push(new TextRun({ break: 1 }))
        break
      case 'image':
        if (token.text) runs.push(new TextRun({ text: token.text, ...runStyle(style) }))
        break
      case 'html': {
        const text = stripHtml(token.text)
        if (text) runs.push(new TextRun({ text, ...runStyle(style) }))
        break
      }
      case 'escape':
        runs.push(new TextRun({ text: token.text, ...runStyle(style) }))
        break
      default: {
        const nested = inlineTokens(token)
        if (nested.length) {
          runs.push(...docxRuns(nested, style))
        } else {
          const text = textOf(token)
          if (text) runs.push(new TextRun({ text, ...runStyle(style) }))
        }
      }
    }
  }

  return runs
}

function runStyle(style: RunStyle) {
  return {
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? CODE_FONT : undefined,
    color: style.link ? ACCENT_COLOR : undefined,
    underline: style.link ? {} : undefined,
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function stripScripts(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, '')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
