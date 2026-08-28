---
name: scene-summary
description: 将已经完成的长场景正文压缩为可检索的事实摘要，记录事件结果和状态变化，供长篇上下文继续使用。
---
# scene-summary

## 分类
马良原生功能（native）。README 明确：“场景摘要：AI 自动为长篇场景内容生成精炼摘要”。

## 关键修正
本 Skill 只承担**正文 → actual summary**。原 v4 的 `plan` 模式并非 README 对“场景摘要”的定义，已移除；场景规划属于 outline / Golden Three / Next Outline 的计划层。

## 输入
- 已完成且已确认的 **canonical** 目标 scope 正文（必要）：通常是一个 scene；导入旧作/章级维护时也可以是已经完整的 canonical chapter prose。若输入仍位于 `06-drafts/prose/` 且 `status: proposed`，只能返回 preview summary，不得写 canonical actual summary。
- 可选：章节蓝图，用于报告“实际 vs 计划”偏差。
- 可选：当前角色/物品/关系状态，用于识别真正的状态变化。

## 输出契约
```yaml
kind: actual
status: canonical
source: <prose-source>
derived_from: [<canonical-prose-source-id-or-path>]
source_revisions:
  <source-id-or-path>: sha256:<content-hash>
scope_complete: true
```
至少记录：
1. 场景 ID / 章节 ID。
2. 时间与地点。
3. 主要参与人物。
4. 场景开始状态。
5. 关键事件及因果。
6. 核心冲突如何结束/暂时停住。
7. 谁获得/失去了什么。
8. 角色、关系、物品、地点状态变化。
9. 谁知道了什么新信息。
10. 新出现或仍未解决的问题。
11. 场景结束状态。
12. 若有计划：与计划的显著偏差。

## 摘要方法
1. 先确认本次 summary 的正文 authority、revision 与 scope：输入必须是 canonical prose，且每个 source 都能按 `08-config/project.md#prose_revision_method` 取得可靠 revision token；scene summary 还需要该 scene 已到明确结束点，chapter summary 需要整章所有 canonical prose 都已纳入。若正文仍是 proposed draft、source 无法取得可验证 revision token，或无法证明目标 scope 已完整，只能输出 preview；**不写入 `05-summaries/**`**，也不生成任何看起来像 current actual state 的持久化摘要。
2. 只从正文提事实，禁止补写。
3. 删除修辞、对白细节和重复动作。
4. 保留后续一致性会依赖的状态变化。
5. 对不确定指代用实体 ID/明确名称消歧。
6. 不能确定的内容标 `uncertain`，不要猜。
7. 摘要必须保留完整 `derived_from` 列表 + `source_revisions` 映射。scene summary 通常只有一个 source；chapter summary 若由多个 canonical scenes 组成，必须枚举本章实际纳入的所有 source，并记录每个 source 当前 revision token。默认 `prose_revision_method: sha256`，token 为 canonical prose 文件当前 UTF-8 内容的 SHA-256；因此 Obsidian 手工编辑也能被检测。只有宿主能保证每次手工/程序编辑都同步维护 frontmatter `updated_at` 时，才允许使用 `updated_at:<ISO>` fallback。任一 source revision 改变、被移除/归档，或 chapter scope 新增了尚未纳入的 canonical prose，该摘要立即视为 stale，不再作为 current actual state 注入，直到重新生成；正文与摘要冲突时正文优先。
8. 若同一 target 存在 status 为 canonical 且尚未进入终态 resolution 的 planned summary，只有在该 plan 的 `scope` 对应内容**确实完成**后才做收口：保留原计划文本，将其改为 `status: archived`，并写 `resolution: realized|diverged`、`resolved_by: <actual-prose-or-summary>`。scene plan 在 scene 完成时可收口；chapter plan 必须等整章完成，不能写完一个 scene 就提前归档。

## 写入
- `05-summaries/scenes/<scene-id>.md`：只有 scene 已完成时写 canonical，并标 `scope_complete: true`。
- `05-summaries/chapters/<chapter-id>.md`：只有整章范围明确完整时写 canonical，并标 `scope_complete: true`；不能仅凭“已有若干 scene”猜整章已结束。

## 与其他 Skill
- 对应 planned summary 的完成态收口只改变其 status/resolution，不重写原计划内容。
- 摘要后可由 `17-consistency-check --postwrite` 做检查。
- 后续 `16-context-assembly` 优先使用 **fresh** actual summary，而不是每次重读远古正文；多 source chapter summary 必须逐一校验 revision。

## 禁止
- 把大纲计划写成“已发生”。
- 为了摘要顺畅修改事件因果。
- 评价文笔或替作者修文。
