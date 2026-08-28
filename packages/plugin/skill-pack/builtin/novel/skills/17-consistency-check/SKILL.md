---
name: consistency-check
description: 在写前/写后基于 canonical sources、fresh actual summary 与可验证 Runtime 状态检查长篇一致性冲突。
---
# consistency-check

## 分类
派生接口（derived）+ 马良原生一致性机制映射。

## 模式
- `prewrite`：计划写前检查。
- `postwrite`：正文写后检查。
- `range`：指定范围检查。

## 输入
通过 `16-context-assembly` 获取：
- 目标文本/计划；
- canonical 角色、地点、物品、势力、关系；
- 时间/卷章位置；
- fresh actual summaries；
- 可验证的 current Runtime projection（辅助定位）；
- 相关历史事实。

## Runtime 证据规则
Runtime 不能单独把冲突升级为 `ERROR`。

如果 `11-runtime/state/current.md` 与当前正文/设定不同：
1. 先沿 provenance/evidence 回查 canonical source；
2. 若原始 source 已变，Runtime 记 `INFO/runtime-state-stale` 并重建；
3. 只有两个有效 canonical facts 不能同时成立时，才是内容一致性 `ERROR`。

## 检查维度
1. 人物身份、年龄/阶段、能力、伤势、位置。
2. 物品所有权、数量、获得/消耗。
3. 地点与时间连续性。
4. 关系状态。
5. 世界硬规则。
6. “谁知道什么”。
7. 已发生事件 vs 当前/未来大纲。
8. 实体名称/属性漂移。
9. actual summary / Runtime 与正文是否 stale 或矛盾。
10. 伏笔/秘密是否提前泄露。

## 冲突解释
- 正文违反 confirmed world rule：内容一致性问题。
- fresh actual summary 与正文冲突：优先修 summary。
- Runtime 与 source 冲突：优先标 Runtime stale / rebuild。
- 已完成正文与旧 planned outline 不同：默认 `INFO/plan-drift`。
- candidate/reference 与 canonical 冲突：candidate/reference 降权。

## prewrite
回答：“照这个计划写，会不会违反当前事实？”不修改大纲。

## postwrite
回答：
- 新正文与现有事实是否冲突？
- 出现哪些状态变化/新关系/新实体？

状态提取先形成 proposed patch；正式状态提交由 `23-chapter-commit` 执行，不直接改 canon/Runtime current。

## 等级
- `ERROR`：证据明确，两个 current canonical facts 不能同时成立。
- `RISK`：可能冲突或上下文不足。
- `INFO`：plan drift、derived index stale 等。

每条包含 evidence_a / evidence_b / reason / affected_scope / 修复方向。

## 写入
`10-analysis/consistency/<timestamp-or-range>.md`

## 与 Quality Gate
`22-quality-gate` 会消费本 Skill postwrite 输出：明确 `ERROR` 通常成为 P0；RISK 需结合证据判断，不机械阻断。

## 边界
- 不自动修 canon。
- 不直接写 `11-runtime/state/**`。
- 无证据推断不能写成事实冲突。
