---
name: quick-start
description: 对齐马良 Quick Start：首页输入小说创意后选择设定生成策略并创建初始 setting session；设定调整与正式 save 统一交给 02-setting。
---
# quick-start

## 对齐来源
- 前端入口：`AINoval/lib/screens/novel_list/widgets/novel_input_new.dart`
- 设定生成页：`AINoval/lib/screens/setting_generation/novel_settings_generator_screen.dart`
- 前端事件：`AINoval/lib/blocs/setting_generation/setting_generation_event.dart`
- 后端入口：`AINovalServer/src/main/java/com/ainovel/server/controller/SettingGenerationController.java`
- 设定生成服务：`AINovalServer/src/main/java/com/ainovel/server/service/setting/generation/SettingGenerationService.java`
- Prompt Provider：`AINovalServer/src/main/java/com/ainovel/server/service/prompt/providers/SettingTreeGenerationPromptProvider.java`
- 番茄策略 Prompt：`AINovalServer/src/main/java/com/ainovel/server/service/setting/generation/SystemStrategyInitializationService.java`
- 番茄策略配置：`AINovalServer/src/main/java/com/ainovel/server/service/setting/generation/strategy/TomatoWebNovelStrategy.java`

## 触发
当用户从一个新创意开始，例如：
- “我想写一个……”
- “快速开始”
- “按番茄网文帮我把这个点子做成小说设定”
- “用九线法/三幕剧开始这本书”

如果用户明确要求编辑既有设定，不使用本 Skill，转 `02-setting`。

## 业务语义
Quick Start 不是“提炼 brief”本身，而是马良首页的快捷入口：

`用户创意 → 选择设定策略 → 生成结构化设定树 → 进入设定编辑会话 → 用户检查/调整 → 显式保存`

因此本 Skill 的主产物是**初始 setting session / 候选设定树**，而不是正文，也不是只有一页故事简介。正式保存由 `02-setting save` 统一处理。

## 输入
必需：
- `idea`：用户的小说创意；知识库纯复用模式下可以为空。

可选：
- `strategy`：用户指定的策略/Preset。
- `knowledge_base_mode`：`none | reuse | imitation | hybrid`。
- `reference_materials`：用户明确指定的参考资料。
- `novel_id` / 当前 Vault：若已存在小说工程则可直接关联。

## 策略选择
按照马良首页行为：
1. 用户明确指定策略时，以用户选择为准。
2. 未指定时优先 `tomato-web-novel`。
3. 番茄策略不可用时回退 `nine-line-method`。
4. 再不可用时才选择可用策略中的第一个。

MVP 的默认 Preset 为 `presets/01-quick-start/default.md`，其语义对齐 `tomato-web-novel`。

## 上下文装配
仅装配完成本次设定生成需要的上下文：
1. 用户创意 `idea`。
2. 当前策略名称、说明。
3. 策略要求的根节点模板及生成提示。
4. 策略的深度、节点数量和描述长度规则。
5. 用户显式提供的参考资料/知识库内容。
6. 若绑定已有小说，可读取 `01-brief/brief.md` 和相关正式设定，但不得静默覆盖既有事实。

Quick Start 默认不读取整部正文。

## 默认番茄网文设定结构
默认生成 11 个根类目，并允许继续细化子节点：
1. 核心卖点
2. 主角设定
3. 金手指系统
4. 世界观框架
5. 等级/力量体系
6. 反派势力
7. 情感线设定
8. 爽点布局
9. 期待感钩子
10. 支线剧情
11. 特色设定

### 核心要求
- 核心卖点：一句话能复述，直接体现最大吸引力。
- 主角设定：身份/标签、初始困境、阶段目标清楚。
- 金手指：机制、成长、限制/代价明确，并能持续制造剧情。
- 世界规则必须能容纳金手指与力量体系，不能互相打架。
- 反派按阶段递进施压，不是一次性工具人。
- 爽点与期待感形成“建立期待 → 兑现反馈 → 再建立期待”的连续循环。
- 前三章至少设计一个明确的大反馈/大爽点方向。
- 至少保留 2~3 个可持续推进的强钩子。
- 支线必须服务主线、成长或情绪反馈。
- 特色设定要能形成记忆点，避免通用套壳。

## 结构规模
对齐番茄策略默认配置：
- 期望根节点：11。
- 最大层级深度：4。
- 高优先级根节点通常规划 3~12 个子节点。
- 其他根节点通常规划 2~8 个子节点。
- 描述必须具体、可用于后续创作；核心节点优先更详细。
- 节点之间需要有明确关联，允许根据题材动态增删非核心子节点。

不要为了凑数量生成低质量节点；强制要求的是核心根类目和逻辑覆盖。

## 执行流程
1. 检查 `06-drafts/setting-session.md`：若已存在 `lifecycle: working` 的未保存会话，停止新建并提示先继续编辑、save，或由用户明确放弃当前会话；不得直接覆盖。只有 `idle/saved` 才可复用该单一 session 文件。
2. 读取用户创意并确认本次策略；未指定则选默认番茄网文策略。
3. 分析创意中已经确定的事实与尚未确定的空间，禁止把推测伪装成用户设定。
4. 先构建全部必需根节点，保证核心结构完整。
5. 再按优先级逐个细化子节点，而不是先无限扩展某一个局部。
6. 每个子节点必须回答“这是什么、如何运作、会怎样进入剧情/影响读者体验”中的至少两个问题。
7. 做一次内部一致性检查：主角目标、金手指、世界规则、力量体系、反派压力、爽点、钩子是否互相支撑。
8. 将结果写入 `06-drafts/setting-session.md`，作为 `lifecycle: working` 的初始设定会话；树内尚未确认的设定节点保持 proposed 语义。
9. 向用户展示关键摘要和需要确认/调整的地方。
10. 用户要求继续修改时，转 `02-setting` 在同一个 working session 内处理。
11. 用户明确“保存/采用/就这样”时，调用 `02-setting save`；由 02 统一负责 snapshot、实体拆分、canonical 写入和 brief 导航摘要更新。

## 候选输出位置
未确认前统一写入：
`06-drafts/setting-session.md`

Quick Start 不维护第二份 `quick-start-settings.md`，避免同一棵设定树出现两个 working Source of Truth。不要直接写入正式：
- `02-settings/`
- `03-outline/`
- `04-scenes/`

## 候选输出格式
```markdown
---
type: setting-session
lifecycle: working
strategy: tomato-web-novel
source: quick-start
---

# Quick Start 初始设定会话

## 核心定位
- 一句话卖点：...
- 主角起点：...
- 核心驱动：...

## 设定树
### 核心卖点
...

### 主角设定
...

### 金手指系统
...

### 世界观框架
...

### 等级/力量体系
...

### 反派势力
...

### 情感线设定
...

### 爽点布局
...

### 期待感钩子
...

### 支线剧情
...

### 特色设定
...

## 关联与一致性
- ...

## 待确认/可调整
- ...
```

## 正式保存 Handoff
下列正式映射由 `02-setting save` 执行；`01-quick-start` 本身不直接写这些 canonical 文件：
- 总体世界规则 → `02-settings/world.md`
- 人物 → `02-settings/characters/`
- 地点 → `02-settings/locations/`
- 势力 → `02-settings/factions/`
- 关键物品/系统 → `02-settings/items/`
- 关系 → `02-settings/relations.md`
- 其他无法自然拆分的核心设定，可留在 `02-settings/world.md` 的专题章节。
- `01-brief/brief.md` 只保存核心卖点、题材、主角起点、核心驱动等导航性摘要。

## 知识库模式映射
若用户提供参考材料：
- `reuse`：优先复用明确选中的知识元素，可允许创意为空。
- `imitation`：参考结构/方法/风格特征，不复制原文表达。
- `hybrid`：区分“要复用的要素”和“只作参考的要素”。
- `none`：只根据用户创意和策略生成。

使用 OpenViking 时，将其视为上述参考上下文提供者，不改变正式 Vault 的 Source of Truth 地位。

## 禁止行为
- 不把 Quick Start 降级成只写一份 brief。
- 不跳过策略选择直接用通用“小说策划”提示词。
- 默认番茄策略下不得遗漏核心卖点、主角、金手指、世界、力量体系、反派、爽点、期待钩子等核心要素。
- 不直接拥有正式设定写权限；用户确认后 handoff 到 `02-setting save`。
- 不生成章节正文。
- 不自动进入大纲；设定确认后由 Agent 决定是否调用 `03-outline`。
- 不为了模仿参考作品而复刻其具体表达、人物或情节。

## 完成条件
本 Skill 只有在以下条件满足时才算完成：
- 已选择明确策略；
- 候选设定树达到策略要求；
- 核心设定之间没有明显自相矛盾；
- 候选与正式状态边界清楚；
- 已创建可继续编辑的 working setting session；
- 若用户要求保存，已正确 handoff 到 `02-setting save`，而不是由 Quick Start 自己绕过快照/确认流程。
