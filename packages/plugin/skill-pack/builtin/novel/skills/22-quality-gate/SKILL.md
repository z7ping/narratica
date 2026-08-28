---
name: quality-gate
description: 在正文进入 Chapter Commit 前执行硬一致性与最低叙事质量门禁，输出 PASS / FAIL / WARN，不自动修改 canon。
---
# quality-gate

## 分类
派生外挂能力（derived-addon）。

## 定位
`17-consistency-check` 查事实一致性；本 Skill 组合 consistency evidence + scene completion + narrative progress + prose minimum，决定能否进入 Chapter Commit。

## 模式
```yaml
mode: scene | chapter
target:
strictness: normal | strict
```

## 正式 PASS 前置
目标必须是有明确 revision 的 canonical prose。proposed draft 只能 preview gate。

## Gate
- G1 Canon
- G2 Character / 明确 OOC
- G3 Knowledge boundary
- G4 Timeline
- G5 Continuity
- G6 Progress
- G7 Scene entry→exit change
- G8 Repetition
- G9 Plan drift（通常 WARN/INFO，不因偏离计划直接 FAIL）
- G10 Prose minimum：明显总结腔、空泛说明、机械重复、无功能填充。
- G11 Dialogue readability：连续多轮对白是否退化成聊天记录；读者轻微跳读后是否仍能判断谁在说话、人物在做什么、场景在哪里。必要时应存在动作、视线、表情、环境或明确说话者锚点，但不机械规定每几句必须插一次。
- G12 Narrative viewpoint integrity：角色不得无设定依据感知“第几章 / 本章 / 读者 / 作者 / 剧情安排”等故事外结构；检查 POV 越界、元叙事穿帮和不属于角色认知的叙述信息。
- G13 Reading accessibility / cognitive load：正文是否要求读者在短距离内同时处理过多术语、抽象概念、多层推理或隐含前提；普通读者正常速度读一遍，是否能理解“现在发生什么、人物在争什么、为什么重要、这一段推进到了哪里”。

## 阅读体验判定补充

以下情况至少记 `P2/MINOR`，严重影响理解时可升级 `P1/MAJOR`：
- 连续裸对白过长，移除上下文后难以判断说话者；
- 大量“嗯 / 对 / 什么 / 为什么”式重复确认，没有推进信息、关系或情绪；
- 对话只承载设定解释，缺少人物动作和现场反馈，读起来像聊天记录或问答稿；
- 场景中人物长时间没有可感知动作/位置变化，读者失去空间感；
- 第一人称/限知 POV 中出现角色不可能知道的章节编号、作者意图等故事外信息；
- 短距离内连续出现多个技术术语或抽象名词，且读者必须先理解术语才能继续剧情；
- 一段话同时包含多个前提、反例、转折和结论，首次阅读容易需要回看；
- 高概念讨论连续占据较长篇幅，却没有具体动作、选择、后果或生活化例子帮助读者落地；
- 人物为了讲清概念突然失去原有口吻，像在读论文、讲课或替作者做总结；
- 核心情节其实简单，但表达方式把它包装得比情节本身更难理解。

检查目标不是追求固定“对白占比”、固定句长或词汇越简单越好，而是同时满足两层体验：

1. **即时理解**：读者正常速度读一遍，不需要频繁回看，就能跟上人物、动作、冲突和基本因果。
2. **读后回味**：主题、悬念和哲学问题可以比表层剧情更深，允许读者读完以后继续想。

核心标准：**主题可以深，但阅读过程不能费劲。不要要求读者先解一道概念题，才能知道剧情正在发生什么。**

## 严重度
- `P0/BLOCKER`：明确 canon / knowledge / timeline 硬冲突。
- `P1/MAJOR`：场景未完成、无推进、严重 continuity，或阅读结构/认知负担已经明显妨碍理解核心剧情。
- `P2/MINOR`：重复、节奏、表达、对白锚点不足、轻度 POV/元叙事问题，或局部认知负担偏高、需要回看才能顺畅理解。
- `INFO`：合理 plan drift、可选优化。

## 判定
- `PASS`：无 P0/P1。
- `PASS_WITH_WARNINGS`：无 P0/P1，但有 P2/INFO。
- `FAIL`：存在 P0/P1。

## 输出
`10-analysis/quality-gates/<target>-<revision>.md`

必须记录 target、revision、result、blockers、majors、minors、info、evidence；涉及阅读体验时应明确记录 G11/G13 结论，避免只写笼统“文笔问题”。

正文 revision 改变后旧 Gate 自动 stale。

## 与 Chapter Commit
`23-chapter-commit` 只接受 PASS / PASS_WITH_WARNINGS。

## 禁止
- 以“文笔不够好”无限阻塞。
- 自动重写全文或修改 canon。
- 因正文合理偏离旧计划直接 FAIL。
- 用机械规则要求固定对白比例、固定句数插动作、固定句长或无意义环境描写。
- 为了“降低难度”删掉故事真正需要的主题深度、人物智力或关键因果。
