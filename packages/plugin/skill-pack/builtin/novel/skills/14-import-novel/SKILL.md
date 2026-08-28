---
name: import-novel
description: 导入 TXT/纯文本小说，识别卷章目录，保留原文，并分章调用 AI 从既有正文生成章节大纲以迁移旧作品。
---
# import-novel

## 分类
马良原生功能（native）。README 明确：支持 TXT 导入、智能解析目录结构，并在导入过程中后台大模型快速生成每章大纲。

## 输入
- TXT 或纯文本。
- 其他格式必须先由宿主可靠转换为文本；不能假装支持未验证的专有格式。

## 阶段 1：原文保全
1. 把原始文件原样复制到 `09-imports/source/`。
2. 记录编码、文件名、导入时间、hash（宿主能计算时）。
3. 导入期间禁止润色或改写原文。

## 阶段 2：目录解析
识别常见标题：卷、章、“第一章”、数字章节、Chapter N 等。

输出解析清单：
- 卷数/章数。
- 标题与原文范围。
- 低置信度标题。
- 重复/缺号/异常长章节。

不确定时保留原分段并标风险，不强行猜章节边界。

## 阶段 3：正文落盘
- `09-imports/source/`：只保存**原始整本文件**，作为不可改的导入证据。
- `09-imports/chapters/`：保存按目录切分后的**章节级 imported canonical prose**，初始 `source_diverged: false`，并令 `updated_at = imported_at` 作为人类可读初始编辑时间；实际 summary revision 默认仍按项目 `sha256` 规则从文件内容计算；供摘要、反推大纲和后续续写检索。
- 导入完成后更新 `08-config/project.md#prose_source`：项目没有既有 canonical scenes 时为 `imported-chapters`；若项目已经同时存在不重叠的正式 scenes，则为 `mixed`。

不要为了适配 `04-scenes/` 而假装已经完成场景切分；导入小说如果只有章节边界，就保持章节级正文。导入旧章后继续写新 scene 时，`prose_source` 应为 `mixed`，两类文件共同组成不同时间段的 canonical prose。

若以后把某个 imported chapter **真正迁移**成 scenes：先确认该章全部正文已被新 scene 表示，再把原 `09-imports/chapters/<chapter>` 标为 `status: archived`、`resolution: migrated`、`migrated_to: [...]`。只有仍为 `status: canonical` 的 imported chapters 参与默认正文上下文/统计；全部迁移完成后才可把 `prose_source` 切回 `scenes`。原始 `09-imports/source/` 始终不动。不要把导入正文放在仅供参考的 knowledge 区。

## 阶段 4：AI 章节大纲提炼
逐章或小批次处理，禁止一次把整本小说放进模型。

Prompt 契约：**根据该章已经发生的正文，提炼章节结构/关键事件，生成章节大纲索引。**

输出必须标：
```yaml
origin: extracted
derived_from: 09-imports/chapters/<chapter-file>
source: imported-prose
```
它描述“已发生的章节”，不是未来计划。若目标 `03-outline/chapters/` 已有 planned canonical 章纲，遵循 `03-outline extract` 的 drift 规则，不能静默覆盖。

## 阶段 5：结构汇总
根据章节层级建立卷/章索引。可以提出总纲/卷纲候选，但不能把 AI 反推结果冒充作者原始意图。

## 可选实体提取
人物/地点/物品/势力抽取不是 README 明确的导入核心，若用户需要，作为后续 `02-setting`/`13-relation-network` proposed 工作流，不强制夹在 import 中。

## 输出
- 成功导入章节数。
- 失败/低置信度章节。
- 已生成 extracted outline 数。
- 需要人工检查的目录问题。
