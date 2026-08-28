---
name: snippet-manager
description: 管理灵感片段、素材、待办、对白和场景想法；片段默认只是参考材料，不属于正式剧情。
---
# snippet-manager

## 分类
马良原生侧边栏能力（native）。README 明确“片段管理：记录灵感片段、素材或待办事项”。

## 是否需要 Prompt
**核心 CRUD 不需要 LLM。** 这是确定性资料管理。可选的自动标签/摘要才使用 AI，而且不能改变片段本身。

## 操作
- `add`
- `list`
- `show <id>`
- `edit <id>`
- `tag <id>`
- `search <query>`
- `archive <id>`
- `delete <id>`
- `promote <id>`：本项目增强动作，将片段交给 setting/outline/next-outline 等专用 Skill 处理

## 数据结构
```yaml
---
id:
title:
type: inspiration|material|todo|dialogue|scene-idea
tags: []
status: reference
lifecycle: active|archived
related_entities: []
created_at:
updated_at:
---
```

## 存储
`07-materials/snippets/<id>.md`

## Canon 规则
片段本身固定为 `status: reference`；是否仍在使用由 `lifecycle: active|archived` 表示。不要用 `status: active` 这类生命周期值污染全局 story-status 语义。哪怕片段写着“主角父亲其实没死”，也不能被 context assembly 当正式事实。

## promote
`promote` 不是马良 README 明确的片段原生动作，是本项目为 Agent 调度增加的 handoff：
- 人物/世界设想 → `02-setting`
- 剧情走向 → `05-next-outline` 或 `03-outline`
- 对白/场景想法 → 作为 `03-outline` / `05-next-outline` 的参考约束，或在已有 confirmed planned summary 时作为 `08-expand` 的 reference；片段本身不能冒充 planned summary

必须经过目标 Skill 自己的确认规则。
