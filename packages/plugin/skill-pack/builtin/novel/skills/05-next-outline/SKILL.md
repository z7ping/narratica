---
name: next-outline
description: 根据当前章节、关系、世界观和既有大纲生成多个明显不同的后续剧情候选，支持单卡独立重抽。
---
# next-outline

## 分类
马良原生功能（native）。README 对“多模型抽卡、上下文智能分析、分支剧情、独立重生成、一键应用”有明确说明。

## 命令
- `/next-outline`：生成多个候选；本项目默认 3~5 个（具体数量是项目策略，不声称为马良固定值）。
- `/next-outline reroll <candidate_id>`：只重生成指定候选。

## 输入上下文
优先调用 `16-context-assembly`，至少覆盖：
1. 当前卷目标。
2. 当前章节/场景状态。
3. 最近 **fresh** actual summary；stale 摘要不得当 current state。
4. 直接相关人物及关系。
5. 相关世界硬规则、物品和地点。
6. 已存在的未来大纲约束。
7. 必要时最近正文结尾。

## 多模型语义
宿主能并行调用多个模型时，可让不同模型分别给候选；宿主只有一个模型时，用显式不同策略制造候选。多模型只改变创意来源，不改变 candidate 隔离规则。

## 候选必须真正不同
差异至少体现在一项以上：
- 冲突来源
- 主角选择/目标
- 参与角色
- 信息揭示方式
- 代价
- 节奏
- 反转机制
- 对已有伏笔的使用方式

不能只换标题和措辞。

## 每张卡契约
```yaml
candidate_id: C1
status: candidate
source: next-outline
target: <chapter-or-scene-id>
target_kind: chapter-outline|planned-summary
target_scope: chapter|scene # planned-summary 时必填
generator: <model-id-or-strategy>
```
正文至少包含：
- 一句话方向
- 核心事件链
- 主要冲突
- 参与角色及各自推进
- 使用/推进的既有设定、关系或伏笔
- 新信息/反转
- 代价与风险
- 结尾钩子
- 后续可扩展空间
- 与 canon 的潜在冲突
- 生成来源（模型或策略），便于多模型抽卡对比和单卡重抽追踪

## 单卡重抽
- 只替换指定 `candidate_id`。
- 其他候选保持不变。
- 继续使用同一份硬约束上下文。
- 新卡应尽量走与被淘汰方案不同的路线。

## 写入
统一写 `06-drafts/next-outline/<target>.md`，所有方案始终是 candidate。

`target`、`target_kind` 必须持久化在候选文件/候选卡中，不能只存在于聊天上下文；planned summary 还必须保存 `target_scope`。`06-apply-outline` 只允许应用回这个明确目标类型/范围，除非用户重新发起一次目标变更。

候选集合文件本身不使用 story-status，因为一个文件在 apply 后可能同时包含 `candidate` 与 `archived` 卡；`status` 属于每张 candidate 卡。

## 应用
用户明确选卡后转 `06-apply-outline`。本 Skill 本身不写正式章节蓝图/摘要。

## 禁止
- 自动替用户选卡。
- candidate 直接变 canonical。
- 为制造惊喜违反已确认世界规则。
- 借候选偷偷修改角色过去事实。
