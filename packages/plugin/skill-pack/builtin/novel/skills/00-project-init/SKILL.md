---
name: project-init
description: 初始化一部小说的工作区、目录、Runtime 和最小配置；不生成正文。
---
# project-init

## 何时使用

用户说“新建小说 / 初始化项目 / 给这本书建工程 / 升级 Vault 结构”时使用。正常作者模式可由 `24-novel-director` 根据自然语言自动路由到本 Skill。

## 输入

- 作品名；没有时允许临时名。
- 可选：题材、目标字数、创作平台/风格偏好、已有简介。

## 执行

1. 检查当前目录是否已经是小说 Vault。
2. 若已有项目，只补缺失目录和模板，禁止覆盖已有内容。
3. 创建标准目录：
   - `01-brief/`
   - `02-settings/{characters,locations,items,factions,snapshots}/` + `world.md` + `relations.md`
   - `03-outline/{volumes,chapters,scenes}/`
   - `04-scenes/`
   - `05-summaries/{planned,scenes,chapters}/`
   - `06-drafts/{next-outline,prose,history,outline-history,golden-three,scene-plans}/`
   - `07-materials/{snippets,knowledge}/`
   - `08-config/{prompts,presets}/`
   - `09-imports/{source,chapters}/`
   - `10-analysis/{consistency,progress,outline-drift,quality-gates}/`
   - `11-runtime/{bible,state,commits}/`
4. 创建 `01-brief/brief.md`，只写用户已经给出的事实；未知字段写“待确认”。
5. 创建/补齐 `08-config/project.md`；默认 `prose_revision_method: sha256`。
6. 创建 `02-settings/relations.md` 空关系表。
7. 创建 Runtime 空模板：
   - `11-runtime/bible/canon-registry.md`
   - `11-runtime/bible/open-loops.md`
   - `11-runtime/state/current.md`
   - `11-runtime/state/author-status.md`
   - `11-runtime/commits/_template.md`
8. 初始化 Runtime 文件时只写空索引/说明，不扫描正文、不推断状态；真正 story state 由 `20-story-bible` / `23-chapter-commit` 生成，作者导航状态由 `24-novel-director` 生成。

## 输出契约

在高级模式可返回项目路径、创建/保留的文件和建议下一步。

在默认作者模式不要要求用户记命令，直接告诉他类似：
“项目已经建好。下一步建议先把核心创意和人物关系梳理清楚。”

## 禁止

- 初始化时直接生成完整世界观、大纲、正文或虚假的 current state。
- 覆盖已有 canonical / Runtime current 文件。
- 把用户没说过的题材/人物写成事实。
