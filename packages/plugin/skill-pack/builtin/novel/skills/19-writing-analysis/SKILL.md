---
name: writing-analysis
description: 统计作品字数、写作进度和可获得的 AI 使用数据；只报告有可靠数据源的指标，不伪造写作天数、Token 或模型偏好。
---
# writing-analysis

## 分类
马良原生作者仪表盘能力（native），但本 Skill 只复刻小说创作侧可由本地 Vault/宿主日志可靠得到的部分。

## 原生指标映射
README 明确包括：
- 总字数。
- 总写作天数。
- 连续写作天数。
- 月新增字数。
- Token 消耗。
- Token 趋势。
- AI 功能使用分布。
- 模型偏好占比。
- 最近 AI 调用活动。

## 数据源原则
每个指标必须注明来源：
- 当前 canonical prose → 字数、章节/场景数量。原生创作通常来自 `04-scenes/`；尚未 scene 化的导入作品可以来自 `09-imports/chapters/`。scene 的故事顺序按 `chapter_id + scene_order`；同章 current scenes 缺失/重复 `scene_order` 时相关顺序/进度指标标 `ambiguous`，不拿文件名或修改时间代替剧情顺序。
- Git/file history → 日新增字数、写作日（只有历史可靠时）。
- Agent/LLM logs → Token、模型、Skill 使用次数、近期 AI 活动。
- 大纲/正文文件 → 计划 vs 完成进度。
- consistency reports → 未解决 ERROR/RISK。


## 正文字数口径
1. `06-drafts/`、大纲、摘要、知识卡永不计入正式总字数。
2. 读取 `08-config/project.md#prose_source`：`scenes` 统计 canonical `04-scenes/`；`imported-chapters` 统计 canonical `09-imports/chapters/`；`mixed` 统计两边**互不重叠**的 canonical 正文。
3. `status: archived` / `resolution: migrated` 的 imported chapter 不再计入；其内容应由 `migrated_to` 指向的 scenes 接管。
4. `mixed` 模式若发现同一章节/文本范围同时存在 canonical imported chapter 与 canonical scenes、却没有迁移/替代元数据，标 `ambiguous`，不得直接相加。
5. 如果配置缺失或与实际文件状态矛盾，同样显示 `ambiguous` 并要求修正配置。
6. 中文“字数”读取 `08-config/project.md#word_count_method`。默认 `cjk-char-latin-token`：每个 CJK 汉字计 1；连续拉丁字母/数字串计 1 token；空白和标点不计。若项目改用其他算法，历史快照必须注明算法，不能在同一趋势图里无提示混算。

## 本地可扩展指标
这些不是 README 明确的原生仪表盘字段，但对本项目有用，可标 `derived`：
- 已有章纲但未写正文。
- 已完成正文但缺 actual summary，或 actual summary 的 `source_revisions` 与任一当前 source 按项目规则重新计算的 revision token 不一致，或 chapter scope 已新增未纳入 source（stale）。
- 待处理 Next Outline candidates。
- 未解决 consistency issues。

## 执行
1. 确认哪些数据源存在。
2. 只计算可证明的指标。
3. 无数据的指标显示 `unavailable`，不要用 0 冒充。
4. 先输出核心数字，再输出最值得行动的 3~5 个缺口。
5. 可选保存快照。

## 写入
`10-analysis/progress/progress-YYYY-MM-DD.md`

## 是否需要 Prompt
核心统计不需要 LLM；LLM 只可用于解释趋势/建议，不负责计算原始数字。

## 禁止
- 没有可靠时间历史却计算“连续写作 N 天”。
- 没有日志却生成 Token/模型占比。
- 把文件修改时间直接当真实写作时间，除非项目明确采用该口径。
