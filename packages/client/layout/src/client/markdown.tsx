import { useEffect, useMemo, useRef, useState } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const parser = new Marked({ gfm: true, breaks: false })

/** Render GFM and sanitize untrusted HTML and unsafe URLs. */
export function MarkdownDocument({ text, compact = false }: { readonly text: string; readonly compact?: boolean }) {
  const html = useMemo(() => DOMPurify.sanitize(parser.parse(text, { async: false }) as string, {
    USE_PROFILES: { html: true },
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['style', 'form', 'iframe'],
  }), [text])
  return <div className={`narratica-markdown${compact ? ' compact' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

/** Headings are derived only from current Markdown; no secondary outline store. */
export function extractMarkdownHeadings(text: string): readonly { depth: number; title: string }[] {
  return parser.lexer(text).flatMap(token => token.type === 'heading'
    ? [{ depth: token.depth, title: token.text.trim() }]
    : [])
}

/** Authoring stays in Markdown: previews never change file bytes or bypass draft confirmation. */
export function MarkdownDraftField({
  value, onChangeText, rows, disabled, readOnly = false, placeholder, textareaClassName = 'input', label = 'Markdown 源码',
}: {
  readonly value: string
  readonly onChangeText: (next: string) => void
  readonly rows?: number
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly placeholder?: string
  readonly textareaClassName?: string
  readonly label?: string
}) {
  type Mode = 'source' | 'split' | 'preview'
  const [mode, setMode] = useState<Mode>(readOnly ? 'preview' : 'split')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (readOnly) setMode('preview') }, [readOnly])
  const applyFormat = (before: string, after = '') => {
    const input = inputRef.current
    if (!input || disabled || readOnly) return
    const from = input.selectionStart
    const to = input.selectionEnd
    const selected = value.slice(from, to)
    const replacement = before + selected + after
    onChangeText(value.slice(0, from) + replacement + value.slice(to))
    queueMicrotask(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(from + before.length, from + before.length + selected.length)
    })
  }
  return <div className="narratica-markdown-field">
    <div className="row narratica-markdown-controls" role="group" aria-label="Markdown 阅读和编辑模式">
      <button className={`btn mini${mode === 'preview' ? ' primary' : ''}`} type="button" aria-pressed={mode === 'preview'} onClick={() => { setMode('preview') }}>阅读</button>
      {!readOnly && <button className={`btn mini${mode === 'split' ? ' primary' : ''}`} type="button" aria-pressed={mode === 'split'} onClick={() => { setMode('split') }}>实时预览</button>}
      <button className={`btn mini${mode === 'source' ? ' primary' : ''}`} type="button" aria-pressed={mode === 'source'} onClick={() => { setMode('source') }}>{readOnly ? '源码' : '源码编辑'}</button>
    </div>
    {mode !== 'preview' && !readOnly && !disabled && <div className="row narratica-markdown-format" role="toolbar" aria-label="Markdown 格式">
      <button type="button" className="btn mini" onClick={() => { applyFormat('## ') }}>标题</button>
      <button type="button" className="btn mini" onClick={() => { applyFormat('**', '**') }}>加粗</button>
      <button type="button" className="btn mini" onClick={() => { applyFormat('- ') }}>列表</button>
      <button type="button" className="btn mini" onClick={() => { applyFormat('> ') }}>引用</button>
      <button type="button" className="btn mini" onClick={() => { applyFormat('`', '`') }}>行内代码</button>
    </div>}
    <div className={`narratica-markdown-editor-layout${mode === 'split' ? ' split' : ''}`}>
      {mode !== 'preview' && <textarea ref={inputRef} aria-label={label} className={textareaClassName} rows={rows} value={value} disabled={disabled} readOnly={readOnly} onChange={event => { onChangeText(event.target.value) }} placeholder={placeholder} />}
      {mode !== 'source' && <div className="narratica-markdown-preview" aria-label="Markdown 实时排版预览"><MarkdownDocument text={value} /></div>}
    </div>
  </div>
}
