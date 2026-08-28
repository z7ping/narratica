---
name: chat
description: 在小说工程上下文中进行问答、构思和解释；按问题最小读取上下文，默认不修改 Vault。
---
# chat

## 分类
马良原生功能（native）。README 明确创作区存在 AI Chat；当前官方文档进一步说明会话历史、快速问答/多智能体模式和内容审批。

## 核心原则
聊天首先是**问答/思考入口**，不是隐式万能写操作。先判断问题类型，再装配最小上下文。

## 路由例子
- 角色动机 → 角色卡 + 相关关系 + 最近 **fresh** actual summary；摘要 stale 时回读相关 canonical prose。
- 两章是否矛盾 → 指定章节摘要/正文 + 相关 canonical 设定。
- 下一章方向 → 当前卷纲 + 最近状态；需要多方案转 Next Outline。
- 这段怎么改 → 选中文本；需要执行转 polish。
- 参考材料里有什么结构 → 相关 knowledge 卡。

## 回答事实标签
涉及故事状态时区分，不能把“正式计划”和“已经发生”都叫 canonical：
- `setting-canon`：已确认世界规则、实体属性、关系等正式设定。
- `plan`：canonical planned outline / 尚未终结的 planned summary；这是未来约束，不代表已经发生。
- `prose-fact`：canonical prose 已明确发生；fresh actual summary 只能作为它的派生索引。
- `inference`：根据现有内容推断。
- `candidate`：创意建议，尚未进入故事。
- `reference`：拆书知识、snippet 等参考材料，不是故事事实。

## 会话
宿主支持会话时，可以维护会话主题和历史，但历史聊天本身不自动升级为小说事实。

## 写入/审批
默认不写 Vault。用户明确“应用/写进去/改成这个”后：
- 大纲 → outline/apply-outline
- 设定 → setting
- 正文 → expand/continue/polish
- 关系 → relation-network

生成内容进入正式正文前应经过用户确认/审批。

## 禁止
- 为回答方便把整本 Vault 全量注入。
- 把聊天里一句设想当 canonical。
- 用“我记得”替代实际读取 canonical 文件。
