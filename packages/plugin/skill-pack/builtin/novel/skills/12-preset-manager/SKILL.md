---
name: preset-manager
description: 管理 Prompt 与 Preset：Prompt 保存系统/用户指令，Preset 将 Prompt、附加指令、上下文策略和模型参数组合成可切换生成策略。
---
# preset-manager

## 分类
马良原生配置能力（native）。README 明确区分“提示词管理”和“预设管理”：Prompt 可配置系统提示词和用户提示词；Preset 把提示词与其他指令、上下文、模型参数关联起来。

## 关键修正
**Prompt ≠ Preset。**
- Prompt：实际发送给模型的 system/user instruction 模板。
- Preset：一次创作动作的完整配置包，可引用 Prompt，并附带上下文和模型参数。

## Prompt 操作
Prompt 管理仍由本 Skill 的唯一顶层命令 `/preset` 进入，避免出现 manifest 未注册的第二个命令：
- `/preset prompt list`
- `/preset prompt show <name>`
- `/preset prompt create`
- `/preset prompt edit <name>`
- `/preset prompt favorite <name>`

Prompt 字段建议：
```yaml
name:
role: system|user
applicable_skills: []
enabled: true
```
正文保存模板文本；可使用明确变量，但不保存某一本小说的事实。

## Preset 操作
Preset 的稳定身份是 **`<skill>/<name>`**，因为多个 Skill 都可以合法拥有 `default`。
- `/preset list [skill]`
- `/preset show <skill>/<name>`
- `/preset create`：必须明确目标 `skill` 和新 `name`。
- `/preset edit <skill>/<name>`
- `/preset clone <skill>/<name> [new-name]`
- `/preset use <skill>/<name>`

为了兼容自然语言，宿主可以接受只给 `<name>` 的写法，但**仅当该 name 在所有可见 Preset 中唯一**；若存在多个 `default` 等同名项，必须返回歧义列表并要求指定 skill，禁止按当前聊天上下文猜。

## Preset 字段
```yaml
name:
skill:
system_prompt_ref:
user_prompt_ref:
context_policy:
model:
temperature:
max_output_tokens:
```
另可包含：附加写作说明、输出契约、知识库开关、模型参数。

## 优先级
不要把事实权威和执行权限混成一条链：
- **执行规则**：当前 Skill 硬规则 > 当前激活 Preset > Preset 引用 Prompt > Skill 默认风格。
- **故事事实**：按 Story Repository 契约与对应 Skill 的事实类型规则判断，Preset/Prompt 永远不能覆盖 canonical/actual 来源。
- 用户明确要求改变事实时，转对应 Skill 的修改/确认流程；不能借 Prompt/Preset 静默绕过候选隔离。

## 存储
- `08-config/prompts/`
- `08-config/presets/`
- 可复用公共 Preset：本仓库 `presets/`
- 当前绑定：`08-config/project.md` 的 `active_presets`（唯一绑定 Source of Truth）

## 边界
- Prompt/Presets 是配置，不是小说内容。
- 修改配置不追溯重写已有正文。
- 宿主不支持某模型参数时，记录但不得假装已经生效。
