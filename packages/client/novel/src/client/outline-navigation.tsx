import { useMemo, useRef } from 'react'
import { extractMarkdownHeadings, MarkdownDocument } from '@narratica/client-layout/markdown'

/** A navigation projection of the real heading tokens; it never changes story content. */
export function OutlineNavigation({ text }: { readonly text: string }) {
  const headings = useMemo(() => extractMarkdownHeadings(text), [text])
  const contentRef = useRef<HTMLDivElement>(null)
  const jump = (index: number) => {
    const root = contentRef.current
    const target = root?.querySelectorAll('h1,h2,h3,h4,h5,h6').item(index)
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return <div className="narratica-outline-layout">
    {headings.length > 0 && <nav className="narratica-outline-index" aria-label="大纲章节目录">
      <strong>大纲结构</strong>
      <ol>
        {headings.map((heading, index) => <li key={index} style={{ paddingInlineStart: `${Math.min(heading.depth - 1, 5) * 12}px` }}>
          <button type="button" className="btn mini" onClick={() => { jump(index) }} title={heading.title}>{heading.title || `第 ${index + 1} 节`}</button>
        </li>)}
      </ol>
    </nav>}
    <div className="narratica-outline-body" ref={contentRef}><MarkdownDocument text={text} /></div>
  </div>
}
