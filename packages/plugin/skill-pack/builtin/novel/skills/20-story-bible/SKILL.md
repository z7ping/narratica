---
name: story-bible
description: 维护可追溯 Canon Registry、当前故事状态投影与 Open Loops；不复制正式事实，不替代 settings / canonical prose。
---
# story-bible

## 分类
派生外挂能力（derived-addon）。

## 定位
不创建第二套 Source of Truth。

权威仍是：
- 世界规则 / 静态设定：`02-settings/**`
- 已发生剧情：canonical prose
- actual summary：正文派生索引
- future outline：未来计划

本 Skill 维护：
1. `Canon Registry`
2. `Current State Projection`
3. `Open Loops Index`

## 输入
```yaml
mode: rebuild | update | inspect
scope: project | chapter | entities
chapter_id: optional
entity_ids: optional
```

## Canon Registry
写入 `11-runtime/bible/canon-registry.md`。

只记录 source 引用/provenance，不复制完整设定：
```yaml
- id: char-linmo
  kind: character
  authority: canonical-setting
  source: 02-settings/characters/linmo.md
```

## Current State Projection
写入 `11-runtime/state/current.md`。

文件元数据使用：
```yaml
authority: derived
runtime_status: current | stale | superseded
last_commit:
source_revisions: {}
```

至少投影：时间/地点、人物状态、关系、关键物品、角色知识、秘密/伏笔、未解决冲突、活跃 plot threads。

每条状态必须带 evidence；无法由 canonical source 支撑的推断标 `confidence: low/medium` + `uncertain: true`，不得进入硬约束。

## Open Loops
写入 `11-runtime/bible/open-loops.md`。

类型：`unresolved_conflict / unanswered_question / foreshadowing / secret / promise / countdown / plot_thread`。

每条包含 id、runtime_status、introduced_at、evidence、affected_entities、resolved_at（若有）。

## 更新规则
1. 新 `23-chapter-commit` 成功后 `update`。
2. 旧 canonical prose revision 改变 → 相关 projection 标 stale。
3. `rebuild` 从原始 canonical sources + 有效 commits 重算，不以旧 projection 自我循环。

## 与 Context
`16-context-assembly` 可读 current projection 减少重复扫描，但关键硬约束必须能回查 evidence source。

## 禁止
- Story Bible 优先于正文/设定。
- planned/simulation/candidate 污染 Registry。
- 自动把低置信度推断升级成故事事实。
