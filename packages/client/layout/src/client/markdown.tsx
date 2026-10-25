import { useEffect, useState } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'

const LABELS: MarkdownLabels = {
  code: { copyLabel: '复制代码', copiedLabel: '已复制' },
  footnotes: '脚注',
}

/** All story Markdown shares DSH's GFM/TeX renderer and safe-link behavior. */
export function MarkdownDocument({ text, compact = false }: { readonly text: string; readonly compact?: boolean }) {
  return <MarkdownText text={text} labels={LABELS} variant={compact ? 'compact' : 'body'} omitHtml />
}

/** Reading vs source editing is presentation-only; story mutations keep their existing boundary. */
export function MarkdownDraftField({
  value, onChangeText, rows, disabled, readOnly = false, placeholder, textareaClassName = 'input',
}: {
  readonly value: string
  readonly onChangeText: (next: string) => void
  readonly rows?: number
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly placeholder?: string
  readonly textareaClassName?: string
}) {
  const [preview, setPreview] = useState(readOnly)
  useEffect(() => { setPreview(readOnly) }, [readOnly])
  return <div className="narratica-markdown-field">
    <div className="row" role="group" aria-label="Markdown 阅读或编辑">
      <button type="button" className={`btn mini${preview ? ' primary' : ''}`} aria-pressed={preview} onClick={() => { setPreview(true) }}>预览</button>
      <button type="button" className={`btn mini${preview ? '' : ' primary'}`} aria-pressed={!preview} onClick={() => { setPreview(false) }}>{readOnly ? '源码' : '源码编辑'}</button>
    </div>
    {preview
      ? <div className="narratica-markdown-preview" style={{ minHeight: 180, minWidth: 0, overflowX: 'auto', padding: '16px 12px' }}><MarkdownDocument text={value} /></div>
      : <textarea className={textareaClassName} rows={rows} value={value} disabled={disabled} readOnly={readOnly} onChange={event => { onChangeText(event.target.value) }} placeholder={placeholder} />}
  </div>
}
