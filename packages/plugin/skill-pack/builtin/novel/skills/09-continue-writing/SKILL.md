---
name: continue-writing
description: 从当前光标或正文结尾继续当前场景，保持视角、语气、事实和未完成动作连续。
---
# continue-writing

## 分类
马良原生功能（native）。README 明确：“AI续写：在当前光标位置后，由AI继续生成内容”。

## 与 expand 的区别
- `expand`：有摘要/大纲作为主要生成蓝图。
- `continue-writing`：以**当前光标前的最近正文**为第一上下文，继续正在发生的场景。

## 输入优先级
1. 光标前最近正文片段（第一上下文）。
2. 若光标后已有正文，读取一小段**右侧邻接文本**作为衔接约束；它是只读边界，不能被改写。
3. 当前未完成动作/对白/问题。
4. 当前章节/场景目标。
5. 直接相关角色、地点、物品和关系。
6. 最近 **fresh** actual summary；stale 时回读相关 canonical prose。
7. 必要的上层大纲约束。

## 执行
1. 识别当前 POV、人称、时态、地点、在场人物。
2. 提取最后一个未完成动作、对话意图或悬念。
3. 判断继续写作的自然短目标。
4. 生成有限长度续写，不默认包办整章。
5. 检查知识状态和世界规则。
6. 如果光标后已有正文，检查生成结尾能否自然接回右侧邻接文本。
7. 默认 preview；用户接受后只插入/追加到光标处，不修改光标前后已有正文。**编辑目标继承原 authority**：目标在 `06-drafts/prose/` 时仍保持 `status: proposed` 并更新 draft `updated_at`，不得因一次续写自动提升 canonical；用户随后明确“定稿/作为正式正文”时 handoff 到 `/expand confirm <scene-id>`。
8. 目标是 `04-scenes/` canonical prose 时，确认写入前保存可撤销旧版/`06-drafts/history/` safety backup，再修改同一 canonical scene，并更新其 `updated_at`。任何 `source_revisions` 仍记录该 source 旧 revision 的 actual summary 随即视为 stale；若场景在本次续写后再次完成，建议重跑 `07-scene-summary`。
9. 当前目标若是 `09-imports/chapters/` 中的 parsed canonical prose，也可按同样规则编辑；确认写入前保留安全历史，写入后更新 `updated_at` 并标 `source_diverged: true`，表示它已不再逐字等同原始导入范围；`source_revisions` 中仍记录该 source 旧 revision token 的 actual summary 同样变 stale。`09-imports/source/` 原始导入文件永远只读。

## Narratica 宿主适配

Narratica 不允许 Agent 直接原地覆盖 `04-scenes/` 正式正文，因此上面第 8 条在 Narratica 中改为显式重写流程，创作语义不变，只加强写入审批边界：

1. 先读取目标场景最新状态与正式正文 revision。
2. 调用 Narratica 的“开始重写”能力，从当前正式正文创建一份**待确认重写工作稿**；此时原正式正文保持不变。
3. 本 Skill 的续写只修改这份待确认工作稿，并继续使用最新 draft/canonical revision 做并发校验。
4. 用户未明确确认前，不得替换正式正文。
5. 用户明确“这版可以 / 定稿 / 就这样”后，由 Narratica 的确定性确认链执行晋升：旧正式正文归档为 `superseded`，重写工作稿归档为 `promoted`，新版本成为当前正式正文。
6. 正式正文 revision 改变后，绑定旧 revision 的 actual summary、一致性结果、质量门禁、章节提交和 Runtime 投影都必须视为 stale 或重建；若宿主尚未完成对应派生更新，不得声称这些状态已经同步。

这项适配不改变“续写什么、如何保持连续性”的生成规则，只改变 Narratica 中 canonical prose 的落盘方式。

## 停止条件
遇到以下情况应停止在决策点：
- 下一步会决定重大剧情分支。
- 需要新增不可逆世界设定。
- 当前大纲与实际正文已经明显不匹配。
此时建议 `05-next-outline` 或 `03-outline revise`。

## 禁止
- 重述大段前文。
- 无过渡跳时间/地点。
- 让人物知道其尚未获知的信息。
- 为方便续写突然创造万能能力。
- 修改光标之前的正文。
