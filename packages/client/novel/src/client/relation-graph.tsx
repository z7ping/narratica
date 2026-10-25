import { useId, useMemo, useState } from 'react'
import type { NovelRelation, NovelRelationRegistryState, NovelSettingNode } from '@narratica/contracts'

type RelationView = 'graph' | 'list'
type RelationRow = { readonly relation: NovelRelation; readonly proposed: boolean }

interface GraphNode {
  readonly id: string
  readonly name: string
  readonly x: number
  readonly y: number
}

/** Read-only projections of the real relation registry; never writes canonical facts. */
export function RelationGraph({ state, entities }: {
  readonly state: NovelRelationRegistryState | undefined
  readonly entities: readonly NovelSettingNode[]
}) {
  const [view, setView] = useState<RelationView>('graph')
  const [focused, setFocused] = useState<string | null>(null)
  const markerId = useId().replaceAll(':', '')
  const labels = useMemo(() => new Map(entities.map(item => [item.id, item.name] as const)), [entities])
  const records: readonly RelationRow[] = useMemo(() => [
    ...(state?.canonical ?? []).map(relation => ({ relation, proposed: false })),
    ...(state?.proposed ?? []).map(relation => ({ relation, proposed: true })),
  ], [state])
  const nodes = useMemo<readonly GraphNode[]>(() => {
    const ids = [...new Set(records.flatMap(item => [item.relation.fromId, item.relation.toId]))]
    return ids.map((id, index) => {
      const angle = (2 * Math.PI * index) / Math.max(ids.length, 1) - Math.PI / 2
      return { id, name: labels.get(id) ?? id, x: 400 + 285 * Math.cos(angle), y: 220 + 155 * Math.sin(angle) }
    })
  }, [records, labels])
  const positions = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes])
  const related = focused === null ? records : records.filter(({ relation }) => relation.fromId === focused || relation.toId === focused)
  const [chosenRelation, setChosenRelation] = useState<string | null>(null)
  const selectedRelation = records.find(item => item.relation.id === chosenRelation)

  if (state === undefined) return <p className="meta">正在读取真实人物关系…</p>
  if (records.length === 0) return <div className="empty-card"><strong>暂无关系事实</strong><p>由小说导演添加候选，作者确认后才形成正式关系。</p></div>
  return <div className="narratica-relation-view">
    <div className="row" role="group" aria-label="人物关系展示方式">
      <button className={`btn mini${view === 'graph' ? ' primary' : ''}`} type="button" aria-pressed={view === 'graph'} onClick={() => { setView('graph') }}>关系图谱</button>
      <button className={`btn mini${view === 'list' ? ' primary' : ''}`} type="button" aria-pressed={view === 'list'} onClick={() => { setView('list') }}>关系列表</button>
      <span className="meta">已确认 {state.canonical.length} · 待确认 {state.proposed.length} · 虚线表示待确认</span>
    </div>
    {view === 'graph' && <div className="narratica-relation-scroll">
      <div className="narratica-relation-canvas">
        <svg viewBox="0 0 800 440" aria-hidden="true" preserveAspectRatio="none">
          <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" fill="none" stroke="currentColor" /></marker></defs>
          {records.map(({ relation, proposed }) => {
            const from = positions.get(relation.fromId), to = positions.get(relation.toId)
            if (!from || !to) return null
            return <line key={relation.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              className={proposed ? 'relation-edge proposed' : 'relation-edge'}
              markerEnd={relation.direction === 'directed' ? `url(#${markerId})` : undefined} />
          })}
        </svg>
        {nodes.map(node => <button key={node.id} type="button"
          className={`narratica-relation-node${focused === node.id ? ' active' : ''}`}
          style={{ left: `${node.x / 8}%`, top: `${node.y / 4.4}%` }}
          title={node.id} aria-pressed={focused === node.id}
          onClick={() => { setFocused(current => current === node.id ? null : node.id); setChosenRelation(null) }}>
          {node.name}
        </button>)}
      </div>
    </div>}
    <div className="narratica-relation-detail">
      <div className="row">
        <strong>{focused === null ? '关系详情' : `${labels.get(focused) ?? focused} · 相关关系`}</strong>
        {focused !== null && <button className="btn mini" type="button" onClick={() => { setFocused(null) }}>显示全部</button>}
      </div>
      {view === 'list' || focused !== null ? <div className="narratica-relation-table-scroll">
        <table className="table"><thead><tr><th>起点</th><th>关系</th><th>终点</th><th>状态</th><th>说明</th></tr></thead><tbody>
          {related.map(({ relation, proposed }) => <tr key={relation.id}><td><button className="link-button" type="button" onClick={() => { setChosenRelation(relation.id) }}>{labels.get(relation.fromId) ?? relation.fromId}</button></td><td>{relation.type}{relation.direction === 'bidirectional' ? ' ↔' : ' →'}</td><td>{labels.get(relation.toId) ?? relation.toId}</td><td>{proposed ? '待确认' : '正式'}</td><td>{relation.description || '—'}</td></tr>)}
        </tbody></table>
      </div> : <p className="meta">点击节点查看关联事实，或切换到关系列表查看全部详情。</p>}
      {selectedRelation && <div className="narratica-relation-selected"><strong>关系 {selectedRelation.relation.id}</strong><p>{selectedRelation.relation.description || '尚无关系描述'}</p><span className="meta">来源：{selectedRelation.relation.source} · {selectedRelation.proposed ? '待作者确认' : '已确认'}</span></div>}
    </div>
  </div>
}
