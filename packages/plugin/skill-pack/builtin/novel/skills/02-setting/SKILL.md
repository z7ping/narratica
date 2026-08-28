---
name: setting
description: 对齐马良“小说设定生成器”：创建结构化设定树、整体调整、按 scope 局部修改/扩展节点、直接编辑/删除节点，并通过显式保存与历史快照管理正式设定版本。
---
# setting

## 对齐来源
- UI：`AINoval/lib/screens/setting_generation/novel_settings_generator_screen.dart`
- BLoC：`AINoval/lib/blocs/setting_generation/setting_generation_bloc.dart`
- Event：`AINoval/lib/blocs/setting_generation/setting_generation_event.dart`
- API：`AINovalServer/src/main/java/com/ainovel/server/controller/SettingGenerationController.java`
- 核心服务：`AINovalServer/src/main/java/com/ainovel/server/service/setting/generation/SettingGenerationService.java`
- 通用 Prompt：`AINovalServer/src/main/java/com/ainovel/server/service/prompt/providers/SettingTreeGenerationPromptProvider.java`
- 策略工厂：`AINovalServer/src/main/java/com/ainovel/server/service/setting/generation/SettingGenerationStrategyFactory.java`
- 番茄策略：`AINovalServer/src/main/java/com/ainovel/server/service/setting/generation/strategy/TomatoWebNovelStrategy.java`
- 历史版本：`AINovalServer/src/main/java/com/ainovel/server/controller/NovelSettingHistoryController.java`

## 业务语义
马良的设定不是“一次生成一堆 Markdown”，而是一个**可编辑的设定树会话**：

`正式设定/空白 → 创建编辑会话 → 生成/整体调整/局部修改 → 检查 → 显式保存 → 形成历史快照`

因此本 Skill 必须区分：
- **working session**：正在编辑、尚未正式保存；
- **canonical settings**：用户明确保存后的正式设定；
- **snapshot/history**：可回退的历史版本。

## 触发与模式
### `generate`
从用户创意、brief 或当前项目上下文生成一棵新的结构化设定树。

### `adjust`
基于当前完整设定树做整体调整；目标是尽量保留现有层级和关联，只修改用户要求涉及的部分。

### `modify-node`
AI 修改指定节点，必须带 `scope`：
- `self`：只改当前节点本身；
- `children_only`：只创建/修改当前节点的子节点，不改当前节点；
- `self_and_children`：允许同时修改当前节点并调整其子节点。

### `update-content`
用户已经给出明确的新内容时，不再调用创造性生成；直接替换目标节点内容，但仍只改 working session。

### `delete-node`
删除指定节点时同时删除它的全部后代；执行前必须列出影响范围。

### `save`
将 working session 作为正式设定写入 Vault，并形成快照。

### `snapshot / copy / restore`
- `snapshot`：保存当前正式设定版本；
- `copy`：从某个快照创建新的可编辑工作副本；
- `restore`：把指定快照恢复为正式设定。

## 读取顺序
### generate
1. 用户当前创意/指令。
2. `01-brief/brief.md`（存在才读）。
3. 当前 Setting Preset / strategy。
4. 用户显式指定的参考材料。
5. 已存在正式设定（仅当用户要求“基于现有设定生成/补全”时）。

### adjust / modify-node
1. 目标节点。
2. 节点路径：所有祖先。
3. 直接子节点；scope 允许时再读取后代。
4. 与目标节点有关联的其他节点。
5. 当前完整设定树的“节点名 + 简述”索引，用于防止冲突。
6. 必要时读取已存在的大纲硬约束，但不得自动改大纲。

不默认读取整部正文。

## 通用生成上下文
对齐马良 `SettingTreeGenerationPromptProvider` / `buildPromptContext(...)`，生成时至少提供：
- `input`：用户创意/修改要求；
- `strategyName` / `strategyDescription`；
- `expectedRootNodes`；
- `maxDepth`；
- `nodeTemplatesInfo`：策略要求的根节点/类型/生成提示；
- `generationRulesInfo`：批量规模、长度、关联、动态结构规则；
- `context`：已有设定或用户指定参考上下文。

## generate 执行协议
1. 确定策略。用户明确指定优先；否则使用当前 Preset。
2. 先规划根节点，再按优先级展开子节点，避免只把一个分支写得很深。
3. 每个节点至少包含：`id / name / type / parent / description / status`。
4. 节点描述必须包含对后续剧情有用的信息，而不是只有名词定义。
5. 需要跨节点关联时明确指出，不允许各写各的互相冲突。
6. 生成结果写入 working session，不直接覆盖正式 `02-settings/`。
7. 输出完整性/一致性检查结果。
8. 等用户明确保存后再执行 `save`。

## modify-node 执行协议
### 共同规则
1. 锁定 `currentNodeId`，读取节点路径和当前描述。
2. 保存 `modificationPrompt` 与本次 scope。
3. 当前节点和允许范围以外的节点都只读。
4. 修改后检查父子语义和关联设定是否仍一致。

### scope=self
- 必须保留同一节点 ID。
- 必须保留同一 parent。
- 只允许改变目标节点自身的名称/类型/描述中与用户要求有关的部分。
- 不创建新节点，不改子节点。

### scope=children_only
- 禁止修改当前节点自身。
- 可以新增/改写其直接或后代子节点，但所有新节点必须正确挂在目标节点/其后代下。
- “以这个设定为父节点继续完善”“给它补子设定”等请求默认使用本模式。

### scope=self_and_children
- 可以修改当前节点，并同时调整其子树。
- 不得修改目标子树以外的其他分支。

### 原地更新原则
如果用户要求“修改当前设定”，不要通过删除旧节点再新建一个同名节点实现；保持节点身份稳定。

## adjust 执行协议
用于“整体调整这套设定”：
1. 读取当前 working tree 的根节点索引和必要细节。
2. 识别用户要求影响的节点集合。
3. 保持未受影响的层级、ID、关系稳定。
4. 以最小变更实现调整。
5. 若调整会破坏核心约束，先输出冲突并给替代方案，不静默强改。
6. 调整结果仍停留在 working session，直到 `save`。

## update-content
当用户提供确定文本（例如“把年龄改成 28 岁”“描述直接改成下面这段”）：
- 不扩写额外设定；
- 只更新明确字段；
- 仍做最小一致性检查；
- 不自动保存为 canonical。

## delete-node
1. 找到目标节点全部后代。
2. 显示将被删除的节点列表。
3. 检查是否被关系、大纲、场景引用；若存在 canonical 关系边，列出必须同步删除/改向的 relation delta，不能留下悬空实体 ID。
4. 用户明确要求删除后，在 working session 删除整棵子树；相关 relation delta 同样留在 session/save preview 中，正式关系仍由 `13-relation-network` 执行。
5. 其他分支不动。
6. 正式 Vault 只有 `save` 后才同步删除。

## Working Session 文件
本项目用 Markdown 模拟马良的设定编辑会话：

`06-drafts/setting-session.md`

建议结构：
```yaml
---
type: setting-session
lifecycle: working
base_snapshot: settings-YYYYMMDD-HHMMSS
strategy: tomato-web-novel
updated_at: ...
---
```

正文保存当前工作树以及本次修改日志。MVP 只维护这一份 session 文件；不要再创建第二个 `setting-session/` 目录作为并行工作副本。

## 正式 Vault 映射
保存时按实体类型拆分，不把完整树塞进一个巨大文件：
- 世界规则/体系/主题类：`02-settings/world.md`
- 人物：`02-settings/characters/<stable-id-or-slug>.md`
- 地点：`02-settings/locations/<stable-id-or-slug>.md`
- 物品/金手指/资源：`02-settings/items/<stable-id-or-slug>.md`
- 势力：`02-settings/factions/<stable-id-or-slug>.md`
- 关系：交给 `13-relation-network` 写 `02-settings/relations.md`

文件名使用稳定 `id/slug`，展示名称放在 frontmatter `name`；角色/地点改名时不要因为改名而换文件身份。

实体文件至少有：
```yaml
---
id: setting-xxx
type: character|location|item|faction|world|...
name: ...
status: canonical
parent: ...
---
```

## 保存与快照
### save
1. 保存前创建正式设定快照；快照必须能恢复当时的实体集合，并记录/包含对应 `relations.md` 版本引用，不能只备份节点却丢掉关系状态。
2. 在写正式文件前计算完整 change set：实体新增/修改/删除 + 因实体删除/改向产生的 relation delta，并向用户一次性预览。
3. 将 working session 的确认版本同步到 `02-settings/`，删除已确认废弃的正式节点文件。
4. relation delta handoff 给 `13-relation-network` 执行对应 add/edit/remove，并继承同一次 save 的明确审批语义。不得留下引用已删除实体的 canonical 边；若实体或关系任一侧写入失败，必须报告 partial/failed 并保留可恢复快照，不能宣称整次 save 成功。未包含在确认范围的纯新增关系保持 proposed，不丢失也不静默 canonical。
5. 更新 `01-brief/brief.md` 中需要同步的导航性摘要；不要把全部设定复制进去。
6. 将 working session 的 `lifecycle` 标记为 `saved`，保留修改记录。

### snapshot
目录：
`02-settings/snapshots/<timestamp>/`

至少保存：
- 当时的正式设定副本或清单；
- snapshot metadata：创建时间、原因、来源 session。

### copy
从某个 snapshot 复制出新的 `06-drafts/setting-session.md`，不改变当前正式设定。若当前单一 session 已是 `lifecycle: working`，不得静默覆盖；先让用户继续/save，或明确放弃当前 working session。`idle/saved` session 才可被 copy 初始化替换。

### restore
1. 明确目标 snapshot，并读取该 snapshot 对应的实体集合与关系版本/引用。
2. 先给当前正式设定 + 当前 `relations.md` 再做一个 safety snapshot。
3. 在真正写入前计算 `current → target snapshot` 的完整 change set：实体新增/修改/删除 + relation add/edit/remove，向用户展示 restore impact。
4. 用户确认后恢复正式实体文件；关系变化 handoff 给 `13-relation-network`，沿用同一次 restore 审批，确保任何 canonical relation 都不会指向恢复后不存在的实体。
5. 实体或关系任一侧失败时报告 partial/failed，并使用第 2 步 safety snapshot 提供回退依据；不能宣称 restore 成功。
6. 报告新增/删除/变化的设定与关系。
7. 不自动改大纲或正文；只报告可能受影响的引用。

## 影响分析
每次 adjust / modify / delete / restore 后至少检查：
- 父子树是否断裂；
- 类型和描述是否自相矛盾；
- 人物/世界/力量/金手指规则是否冲突；
- `relations.md` 是否存在失效引用；
- `03-outline/` 是否引用了被改动的硬设定。

发现影响只输出 `impact`，不要自动重写大纲/正文。

## 输出
```markdown
# Setting Session Result
- mode: modify-node
- scope: self
- lifecycle: working

## Changed
- node-id: ...
  before: ...
  after: ...

## Created
- ...

## Deleted
- ...

## Impact
- ...

## Validation
- tree: pass|warning
- consistency: pass|warning

## Save State
尚未写入正式设定；等待用户 save/apply。
```

## 禁止行为
- 不把 working session 当成正式设定。
- 不在 `scope=self` 时顺手修改子节点。
- 不在 `scope=children_only` 时修改父节点本身。
- 不通过“删旧建新”破坏被修改节点的稳定 ID。
- 不删除一个节点却保留悬空后代。
- 不因设定变化自动重写大纲、场景、正文。
- 不忽略历史快照直接覆盖正式设定。
- 不把所有设定都展开成百科全书；遵循当前策略的结构和优先级。

## 完成条件
- 操作模式与 scope 明确；
- 变更只发生在允许范围；
- working/canonical/snapshot 三种状态清楚；
- 保存/恢复操作都有版本安全措施；
- 变更影响已报告；
- 未经明确 save，不污染正式 Vault。
