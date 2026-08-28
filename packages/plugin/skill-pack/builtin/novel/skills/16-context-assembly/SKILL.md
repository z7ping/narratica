---
name: context-assembly
description: 为长篇生成任务按相关性和预算装配最小上下文包；统一处理计划、Canon、Runtime 投影、摘要与历史检索。
---
# context-assembly

## 分类
派生内部能力（derived）。

## 是否直接生成小说内容
否。它只返回 `ContextPacket`。

## 输入
```yaml
task_type:
current_volume:
current_chapter:
current_scene:
target:
budget: optional
```

## 核心原则
**相关性 > 全量；原始 Authority > 派生索引。**

正文来源先看 `08-config/project.md#prose_source`：
- `scenes`：canonical `04-scenes/`
- `imported-chapters`：canonical `09-imports/chapters/`
- `mixed`：两类不重叠 canonical prose

## Runtime 使用规则
`11-runtime/**` 是可选加速层：
- `state/current.md`：优先定位“现在人物/关系/知识/物品处于什么状态”。
- `bible/canon-registry.md`：定位 canonical source。
- `bible/open-loops.md`：定位活跃伏笔/秘密/冲突。
- `commits/**`：定位历史状态变化。

注入 Runtime 前必须检查：
1. `authority: derived` 或等价派生标记；
2. `runtime_status: current`；
3. provenance / source revisions 可追溯；
4. 相关 canonical source 未发生 revision mismatch。

Runtime stale / source 不可验证时不进入 Hard Constraints，回读原始 canonical source。

## 装配顺序
1. 用户当前明确要求和任务目标。
2. 当前 Skill 的直接输入文件/计划。
3. 当前层级上级大纲约束；未来生成只把 `origin: planned` 当直接蓝图。
4. 从任务抽取实体 ID。
5. 精确读取相关 canonical 设定与一跳关系；排除 `02-settings/snapshots/**`。
6. 读取相关 **current Runtime projection** 作为状态导航；关键硬约束回查 evidence source。
7. 最近 2~3 个 **fresh actual summary**；逐 source 校验 `derived_from + source_revisions`。
8. 续写/扩写需要时加入邻接 canonical prose。
9. 必要时从有效 Chapter Commit / OpenViking 找更早关键事件，再回源确认。
10. 只取当前有约束力的远期总纲/卷纲片段。
11. 用户或 Preset 明确要求时才加入 reference knowledge。

## Scene ordering
最近 scene/summary 以 `chapter_id + scene_order` 判断；缺失/重复时列为 Conflict，禁止按文件名/mtime 猜。

## 设定可见性
尊重 visibility；对 AI 隐藏的秘密不得因为 Runtime/OpenViking 召回而泄露。

## 事实判定
- 世界规则：用户确认 > canonical setting。
- 已发生剧情：用户确认 > canonical prose > fresh actual summary；Runtime 只做派生导航。
- 未来计划：用户确认 > canonical planned outline / active planned summary > candidate/proposed。
- reference 永不覆盖故事事实。

## ContextPacket
```markdown
# Task
# Hard Constraints
# Current Outline
# Relevant Settings
# Runtime State
# Relations
# Recent Story State
# Recent Prose
# Historical Retrieval
# Reference Knowledge
# Unknowns / Conflicts
```
每块注明 `source`、authority 与 freshness。

## Token/字符预算
超预算优先删除：reference → 远期细节 → 低相关设定 → 更老摘要 → 历史原文。最后才压缩硬规则、当前计划、最近正文。

## OpenViking
Vault 是 Source of Truth。默认不索引临时 draft、snapshot、stale Runtime、archived 旧正文/旧计划。

## 禁止
- candidate/simulation 当事实。
- Runtime projection 覆盖 evidence source。
- 同名实体不经 ID 消歧合并。
- 为“完整”塞入整本正文。
