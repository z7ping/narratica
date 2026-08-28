---
name: expand
description: 将已确认的 planned summary、章节蓝图或场景计划扩写成完整场景正文；不得把 actual summary 当作待扩写计划。
---
# expand

## 分类
马良原生功能（native）。README 明确：“摘要扩写：将简单的摘要或大纲扩写为完整的场景内容”。

## 模式
- `/expand`：按计划生成/重生成 proposed scene draft。
- `/expand confirm <scene-id>`：**确定性提升**现有 `06-drafts/prose/<scene-id>.md`；不重新生成正文，只校验 target/authority/重叠后将当前 draft 提升为 canonical。

## 输入
- 一个明确的 **planned summary / 场景计划**；`kind: actual` 的 summary 只描述已经发生的正文，不能作为“重新扩写这段剧情”的默认蓝图。
- 若只提供章节蓝图，它作为上层约束，不代表可以把整章多场景一次性糊成一个场景。
- 本次 `target_scene`（或能明确推出的单一场景边界）。
- 当前章节目标。
- `16-context-assembly` 返回的最小相关上下文。
- 当前正文 Preset。

## 上下文硬约束
必须识别：
- 场景开始状态与预期结束状态。
- POV / 人称 / 时态。
- 当前时间地点。
- 在场角色及各自已知信息。
- 必须发生的事件和不可违反的世界规则。

## Prompt 契约
模型任务不是“自由续写”，而是：**在不改变计划结果的前提下，把结构化计划变成具有动作、对白、感知和内心活动的完整场景。**

默认阅读目标：**主题可以深，但阅读过程不能费劲。** 优先让读者顺着事件和人物反应自然理解问题，再留下可回味的主题；不要要求读者在首次阅读时先解一道概念题才能继续剧情。

## 执行
1. 装配最小上下文。
2. 解析本次 `target_scene`。若调用方没有给 scene ID，但当前是在某章中新建 scene，按稳定规则分配 `<chapter-id>-scene-<NN>`：扫描该章**所有曾经分配过**的 scene ID（canonical、proposed、archived/history 中能识别出的 ID 都算），取最大数字序号 + 1；scene ID 一经分配永不复用。另写 `chapter_id` 与 `scene_order`。`scene_order` 在同一 chapter 当前有效 scenes 中必须唯一、可排序；插入/重排时可以重排这些 order 元数据，但已有 `scene_id` 永不改名。如果输入只有章节蓝图且包含多个地点/时间跳转/独立冲突段，先为本次要写的单一场景建立临时 beat plan；不要把整章多场景一次混写。
3. 把本场景计划拆为必须完成的 beat。
4. 识别场景开头与结尾状态。
5. 生成正文草稿并写入 proposed draft 元数据：首次创建时设置 `created_at`，每次模型重生成/Continue/Polish 修改 draft 时更新 `updated_at`；draft revision 只用于工作副本追踪，不因此获得 canonical authority。
6. 自检：每个硬 beat 是否写到；是否新增硬设定；是否发生知识穿越；是否与上一场景衔接；是否出现对白阅读体验、认知负担过高或 POV 穿帮问题。
7. 默认作为 preview/draft 返回。
8. 确认前检查本 scene 的故事范围是否已被 canonical imported chapter 覆盖。若重叠，它是“重写/迁移旧章”而不是新增正文：默认停在 draft，不能直接再造一份 canonical scene；用户明确迁移时按 import 的 migration 规则处理。
9. 用户确认后才进入正式正文；若确认发生在后续回合（例如 draft 已经过 Continue/Polish），调用 `/expand confirm <scene-id>` 只提升当前 proposed draft，不重新调用模型。首次提升时保留 draft 的 `created_at`（缺失则补当前时间），并把 `updated_at` 设置为本次确认时间；成功写入 canonical 后，原 proposed draft 必须删除或降为 `status: archived` + `resolution: promoted`，不能继续保留成一份看起来仍待确认的活跃草稿。宿主不支持审批时至少保留旧版本，不静默覆盖。
10. 若确认后的新 scene 是在 `prose_source: imported-chapters` 的导入旧作之后继续创作、且与旧章不重叠，把 `08-config/project.md#prose_source` 切为 `mixed`；这是正文来源元数据更新，不改旧正文。
11. 正文已确认 canonical 且目标 scope 完整后建议生成 actual scene summary。

## 写作约束
- 设定说明只能服务当前场景。
- 对话必须有角色目的。
- 不重复总结刚刚发生的事情。
- 不用无铺垫巧合解决核心冲突。
- 新增不可逆主线变化时停止并转 Next Outline。
- 连续多轮对白必须维持清晰的说话者与现场锚点。可使用动作、视线、表情、停顿、环境反应或明确提示重新定位；不机械规定固定句数，但若读者轻微跳读两三行就容易不知道“谁在说、人在做什么、场景在哪里”，应重写。
- 删除不承担信息、情绪、关系或节奏功能的重复确认型对白，避免正文退化成聊天记录。
- 第一人称或限知 POV 中，角色不得无设定依据感知“第几章 / 本章 / 作者 / 读者 / 剧情安排”等故事外结构。
- 环境描写只用于维持空间感、节奏和情绪，不为了给对白“硬插动作”而制造无意义填充。

### 阅读难度 / 认知负担
- 默认面向大众连续阅读场景；**可保留深层主题，但首次阅读必须能顺畅跟上人物此刻在争什么、为什么重要、发生了什么变化。**
- 抽象概念优先通过具体动作、选择、后果、生活化例子承载；能说“删掉以后还算不算你”时，不优先写成“连续性身份判定”。
- 不在短距离内连续堆叠多个术语或抽象名词。技术词若不是情节必须，改成人话；必须出现时，用上下文或具体例子让读者自然理解，不做百科式解释。
- 高概念对白一次只推进一个核心问题。若一段同时要求读者理解三层以上转折、前提或推论，拆开或改用具体例子。
- 重要结论尽量让人物先“碰到”再“说出来”，避免先给概念定义再要求读者套入剧情。
- 允许适度重复关键问题帮助读者定位，但重复必须换来新的证据、情绪或关系变化，不做同义改写循环。
- 判断标准不是“词越简单越好”，而是：普通读者正常速度读一遍，无需回看前文，也能说清当前冲突和这一段的结论；更深的哲学含义可以留到读完以后再想。

## 写入
- preview/draft：`06-drafts/prose/<scene-id>.md`，保持 `status: proposed`。
- 用户确认后的正式正文：由本 Skill 的确认步骤或 `/expand confirm <scene-id>` 将当前 proposed draft 提升到 `04-scenes/<scene-id>.md`（或宿主等价场景正文路径），标 `status: canonical`。
- 旧版/被替换版本：`06-drafts/history/`。

同一个 scene 不允许同时把 draft 和正式文件都当 canonical。

## 禁止
- 擅自改变大纲结果。
- 为凑字数制造无效往返。
- 直接覆盖用户手写正文。
