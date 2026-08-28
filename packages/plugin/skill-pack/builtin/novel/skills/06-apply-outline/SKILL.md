---
name: apply-outline
description: 将用户明确选中的 Next Outline 候选安全提升为正式章节蓝图或 planned summary；这是本项目从马良“一键应用”动作中拆出的确定性状态转换。
---
# apply-outline

## 分类
派生内部能力（derived）。马良原生产品存在 Next Outline“一键应用”，但本项目把“生成候选”和“写入正式状态”拆成两个 Skill，减少误写 canon 的风险。

## 是否需要 LLM
默认**不需要**。这是验证、转换、写文件为主的确定性操作；只有候选文本必须适配目标模板时才允许做最小结构化整理，且不得改变语义。

## 前置条件
必须同时满足：
- candidate 文件存在。
- candidate 状态仍为 `candidate`。
- 用户明确指定 `candidate_id` 或明确序号。
- candidate 已持久化 `target` + `target_kind`；planned summary 还包含 `target_scope`，因此应用路径无需猜测。

任何一个不满足都不得猜测应用。

## 允许目标
根据马良“一键应用到当前章节或场景摘要”的公开语义，本项目限制为：
1. **本次 Next Outline 明确针对的当前章节/目标章节蓝图**。
2. **本次推演明确针对的场景/章节 planned summary**；写入时必须记录 `scope: scene|chapter` 以及相应 `scene_id/chapter_id`。

不能因为用户选了一张卡，就自行把目标扩展成“任意下一章”或任意范围重写；目标必须继承生成候选时的 target。

## 执行流程
1. 读取候选的 `target / target_kind / target_scope`、对应 canonical 文件和直接上层大纲；缺任何必要字段都停止，不从聊天历史猜。
2. 校验候选没有与当前 canon 新出现的冲突。若 target chapter/scene 已存在 canonical prose，已发生正文是不可改的历史前缀：candidate 只能规划尚未发生的剩余范围；与已发生事实冲突时停止应用，不能靠替换 outline 抹掉正文。
3. 生成应用预览：`candidate_id / target / create-or-replace / impact`。
4. 若目标已有内容，先复制旧版到 `06-drafts/history/`；历史副本标 `status: archived`、`resolution: superseded`，并记录后继 target/version，避免旧 canonical 副本在历史区继续看起来像当前事实。
5. 只提升被选候选。
6. 按 target type 写入完整 authority/provenance：
   - `target_kind: chapter-outline` → `type: chapter-outline`、`status: canonical`、`origin: planned`、正确 `chapter_id`、`source: next-outline:<candidate_id>`；
   - `target_kind: planned-summary` → `type: summary`、`kind: planned`、`status: canonical`、`scope: <target_scope>`、对应 `chapter_id/scene_id`、`source: next-outline:<candidate_id>`。
   不能只复制候选正文而漏掉这些字段，否则 Context 无法判断其 authority/用途。
7. 被应用的候选不再使用不存在的 `status: applied`：改为 `status: archived` + `resolution: applied` + `applied_to` + `applied_at`。
8. 其他候选保持 `status: candidate`；若用户淘汰，可改 `status: archived` + `resolution: rejected`。

## 新设定处理
候选里出现的重大新世界规则、身份真相、不可逆设定，不因 apply 自动进入 `02-settings/`。如确需固化，转 `02-setting` 并保持 proposed→confirm 流程。

## 输出
- Applied candidate
- Target file
- Backup file（如有）
- Canon impact
- 下一步建议：若目标是 planned summary，进入 `08-expand`；若目标是章节蓝图，先确定本次单一 scene 边界/计划再进入 `08-expand`。actual summary 只有正文已确认 canonical 且目标 scope 完整后才由 `07-scene-summary` 生成。

## 禁止
- 无用户选择自动应用。
- 一次应用多个候选。
- 应用时悄悄“优化剧情”。
- 修改未被目标覆盖的 canonical 文件。
