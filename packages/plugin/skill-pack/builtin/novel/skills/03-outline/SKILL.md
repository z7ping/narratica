---
name: outline
description: 创建、查看和局部修订总纲→卷纲→章节蓝图三级大纲，保证下层规划继承上层约束。
---
# outline

## 分类
马良原生核心能力（native）。公开产品文档明确采用“总纲 → 卷纲 → 章节蓝图”三级结构；保留源码中已确认存在创作大纲 Prompt 与章节正文反推大纲 Prompt 两类不同用途。

## 目标
把“故事方向”逐层拆成可执行写作计划，而不是一次把整本小说细化完。

## 模式
- `book`：创建/修订全书总纲。
- `volume`：从总纲推演指定卷纲。
- `chapter`：从当前卷纲推演指定章节蓝图。
- `overview`：只读汇总三级大纲，不写入。
- `revise`：按用户明确修改点局部修订，并报告下游影响。
- `extract`：从已有章节正文提炼“实际章节大纲”；此模式与创作规划严格区分。

## 输入
最少需要：作品 brief 或用户明确的故事目标。生成下层时必须读取直接上层：卷纲依赖总纲，章节蓝图依赖卷纲。

可选上下文：核心角色、世界硬规则、已完成正文的 fresh actual summary、用户指定 Preset。不要默认读取整本正文。

## 总纲契约
至少包含：
1. 核心矛盾与主角长期目标。
2. 主角主要成长弧线。
3. 主要阶段/卷及每阶段承担的故事任务。
4. 关键秘密、伏笔、重大反转的阶段级约束。
5. 结局方向；尚未决定的槽位写“待确认/unknown”，不要把某个具体候选方案以内联 `proposed` 形式混进 canonical outline。具体备选留在 `06-drafts/outline-history/` 或 Next Outline candidates。

总纲负责方向，不负责逐章事件细节。

## 卷纲契约
至少包含：
1. 本卷起始状态。
2. 阶段目标与核心阻力。
3. 2~5 个关键事件/里程碑。
4. 冲突如何升级。
5. 主角状态、关系或认知的主要变化。
6. 卷末状态、爆点/钩子及与下一卷接口。

## 章节蓝图契约
保持紧凑、可执行，至少包含：
- 章节目标。
- 开场状态：地点、时间、主要在场人物。
- 3~5 个主要情节节点。
- 核心冲突/阻力。
- 可选转折或信息揭示。
- 章节结果。
- 结尾钩子/下一章接口。

章节蓝图是正文生成指令，不写成长篇正文。

上述“2~5 个关键事件 / 3~5 个情节节点”是本项目为了保持蓝图紧凑设置的默认输出契约，不声称是马良源码固定数量。

## extract 模式
从已完成且已确认的 canonical 正文提炼章节实际结构时：
- 只总结 canonical 正文已经发生的事件；若来源仍是 `06-drafts/prose/` proposed draft，只能返回 extract preview，不得写 canonical extracted outline。
- 标记 `origin: extracted`、`derived_from: <prose-source>`；`status: canonical` 只表示这是当前有效的结构索引，不把它升级成“未来计划”。
- 不把“正文反推大纲”混同为未来规划。
- **目标章节没有既有章纲**（典型：导入旧作品）时，可在确认后写 `03-outline/chapters/chapter-XXX.md`，作为该已完成章节的结构索引。
- **目标章节已有 planned canonical 章纲**时，不直接覆盖；将差异写入 `10-analysis/outline-drift/chapter-XXX.md`。如果用户明确决定以后以实际结构替换计划，先把旧计划归档到 `06-drafts/outline-history/` 并标 `status: archived`、`resolution: superseded`，再提升 extracted 版本。
- 若与原计划不同，记录偏差，不自动改写总纲/卷纲。
- extracted outline 与正文冲突时正文优先，提炼结果需要重做。
- `origin: extracted` 默认只用于回顾、检索、drift/结构分析；只有 `origin: planned` 的 chapter outline 才能作为未来正文的直接蓝图。用户若要“按反推结构继续/重写”，必须显式转成新的 planned 候选/修订。

## 修订流程
1. 读取目标层级及必要上/下游。
2. 输出 `before → requested change → after`。
3. 检查已写正文和后续大纲是否受影响。
4. 已确认内容被覆盖前必须给出影响预览；被替换的旧版本进入 `06-drafts/outline-history/` 时改为 `status: archived` + `resolution: superseded`，不要让历史副本继续伪装 current canonical。
5. 新生成/修订结果默认先 preview；用户确认后才写 `03-outline/**` canonical。未确认版本如需持久化，写 `06-drafts/outline-history/` 并标 proposed，不在正式大纲目录制造“看起来像当前计划”的第二份文件。

## 写入
- `03-outline/main.md`
- `03-outline/volumes/volume-XX.md`
- `03-outline/chapters/chapter-XXX.md`
- 历史/候选：`06-drafts/outline-history/`

## 硬边界
- 下层必须服从上层硬约束。
- 不因生成“更精彩”而悄悄改世界硬规则。
- 已完成正文优先于旧计划；发现冲突要报告。
- `05-next-outline` 的候选必须经 `06-apply-outline` 才能进入 canonical。
- 不把 `ChapterOutlinePromptProvider` 一类“正文→大纲”能力误当成主创作大纲 Prompt。
