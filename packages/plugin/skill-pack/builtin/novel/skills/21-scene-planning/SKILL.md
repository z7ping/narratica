---
name: scene-planning
description: 将已确认章节计划拆为可执行的场景计划与场景节拍，作为正文生成前的中间计划层。
---
# 场景规划（scene-planning）

## 分类
派生外挂能力（derived-addon）。

## 定位

`章节大纲 → 场景计划 → 场景节拍 → 正文草稿`

不取代 `03-outline / 04-golden-three / 05-next-outline / 06-apply-outline`。

只有已确认的正式章节计划才能直接生成正式场景计划；候选方案或外部排演只能生成待确认场景计划。

## 作者可见语言规则（强制）

- 所有作者可见标题、章节说明、场景说明、状态、列表、字段标签、选项和错误提示，**默认使用简体中文**。
- 英文仅在中文无法准确表达、需要保留外部标准术语、命令、路径、稳定标识符或机器字段时出现，并优先写成“中文（English）”。
- 内部机器字段可以继续使用 `scene_id`、`entry_state`、`canonical` 等稳定键值，但**不得直接作为作者可见标签输出**。
- 作者可见场景计划中禁止直接出现 `Scene Plan`、`Scene Goal`、`Beat Sheet`、`Beats`、`action`、`reaction`、`information_change`、`pressure_change`、`proposed`、`canonical` 等裸英文界面词。
- 对应作者可见中文统一为：
  - `Scene Plan` → 场景计划
  - `Scene` → 场景
  - `Scene Goal` → 场景目标
  - `Beat Sheet / Beats` → 场景节拍
  - `action` → 行动
  - `reaction` → 反应
  - `information_change` → 信息变化
  - `pressure_change` → 压力变化
  - `proposed` → 待确认
  - `canonical` → 正式

## 输入

以下为内部参数，不直接展示给作者：

```yaml
chapter_id:
source_outline:
mode: plan | revise | inspect
target_scene_count: optional
```

## 上下文

调用 `16-context-assembly`，重点读取当前章节大纲、上级目标、相关设定、最近实际状态、当前运行状态投影、上一段正文、活跃未闭环线索。

## 写入

正式场景计划：`03-outline/scenes/<chapter-id>/<scene-id>.md`

待确认场景计划：`06-drafts/scene-plans/<chapter-id>/<scene-id>.md`

## 内部机器字段

以下字段用于稳定读取和自动处理，可以保留英文键名；作者阅读区必须使用对应中文标签：

```yaml
scene_id:
chapter_id:
scene_order:
pov:
time:
location:
participants:
entry_state:
goal:
conflict:
stakes:
information_to_reveal:
information_to_hide:
turn:
exit_state:
open_loops_touched:
new_open_loops:
must_not_happen:
```

## 作者可见场景计划格式

作者可见正文区至少使用以下中文结构，不直接暴露机器字段名：

```markdown
# 第四章 · 场景 1：《场景标题》

## 入场状态
...

## 场景目标
...

## 核心冲突
...

## 风险与代价
...

## 本场揭示
...

## 本场隐藏
...

## 场景转折
...

## 离场状态
...

## 推进的未闭环线索
...

## 新增未闭环线索
...

## 禁止发生
...

## 场景节拍

- 节拍：1
  - 行动：...
  - 反应：...
  - 信息变化：...
  - 压力变化：...
```

允许根据场景复杂度省略没有实际内容的小节，但**不得退回英文标签**。

## 场景节拍

每个场景通常包含 4～10 个节拍。每个节拍至少说明：

- 行动：发生了什么；
- 反应：人物如何回应；
- 信息变化：读者/人物新知道了什么；
- 压力变化：风险、紧张度、关系或目标发生了什么变化。

## 原则

- 每个场景至少推进目标、冲突、信息、关系、风险、资源或未闭环线索之一。
- 入场状态与离场状态必须有有效变化。
- 关键秘密尊重角色知识边界。
- 章纲可拆多场景，但不得擅自新增改变主线方向的大事件。
- 场景节拍是计划，不是散文正文。
- 作者阅读体验优先：术语和结构服务于理解，不为了机器结构牺牲可读性。

## 外部排演边界

外部排演结果默认只是模拟结果：

`外部排演 → 待确认场景计划 → 用户确认 → 正式场景计划`

不得把模拟结果静默升级为正式计划。

## 与扩写能力的关系

`08-expand` 优先使用目标场景计划 + 场景节拍；若只给粗章纲，可先调用本 Skill。

## 禁止

- 固定每章机械拆 3 场。
- 为戏剧性无视人物目标或正式设定。
- 外部排演结果静默升级为正式计划。
- 把内部英文机器字段直接当作作者界面。
- 新生成的场景计划再次出现裸英文标题 `Scene Plan / Beat Sheet / Scene Goal / Beats`。
