---
name: relation-network
description: 创建、查询和维护角色、地点、物品、势力等设定实体之间的结构化关系网络。
---
# relation-network

## 分类
马良原生设定能力（native）。README 明确支持角色/地点/物品/势力等结构化设定，并可定义父子、同盟、敌对、从属等复杂关系。

## 是否必须调用 LLM
不必须。CRUD 和查询应尽量确定性执行。AI 可以根据用户自然语言**建议**关系，但建议必须是 proposed，用户确认后才 canonical。

## 操作
- `add`
- `edit`
- `remove`
- `show <entity>`
- `path <A> <B>`
- `propose`：从用户描述/正文中提出待确认关系

## 关系结构
```yaml
- id: rel-001
  from: char-a
  to: char-b
  type: enemy_of
  direction: bidirectional
  description: 因旧案公开敌对
  status: canonical
  source: user
```

## 推荐类型
亲属、师徒、同盟、敌对、从属、成员、雇佣、竞争、控制、拥有、位于、隶属、知晓、信任、怀疑等。允许项目自定义，避免为了枚举完整性丢失语义。

## 写前校验
1. from/to 实体是否存在；任何 canonical 边都不得指向已删除/归档且不再有效的实体。
2. 是否已有重复边。
3. 新关系是否与 canonical 冲突。
4. 单向/双向是否明确。
5. 关系的公开状态与真实状态若不同，拆开记录，不用一个模糊标签覆盖。
6. 从正文/聊天自动推断出的新增、删除或改写只能先形成 `proposed`；不能因为模型“看起来确定”就直接改 canonical。

## 时间与知情范围
马良公开 README 能证明复杂关系网络，但“生效章节、失效章节、谁知道这段关系”等细化字段属于本项目增强，可按需要增加，不能称为马良原生字段。

## Canonical 变更安全
- 用户明确执行 `add/edit/remove` 时才允许改变 canonical 关系；`02-setting save/restore` 已向用户展示并确认的 relation delta 可作为同一次操作的有效审批 handoff，不要求重复询问。
- 修改/删除既有 canonical 边前，先保存 before/after；宿主支持文件历史时将旧版放入 `06-drafts/history/` 或等价版本历史。实体删除/restore 引发的批量关系变化也适用此规则。
- “剧情中关系发生变化”与“设定表写错了”不是一回事：前者必须保留已发生历史，只更新当前关系视图；后者才适合直接修正设定。MVP 不假装拥有完整关系时间轴。

## 存储
`02-settings/relations.md`。实体正文仍各自在角色/地点/物品/势力文件中。

## 与生成联动
- canonical 关系可进入 context packet。
- proposed 关系只可作为候选灵感。
- 正文出现疑似新关系时，先提取为 proposed，再由用户确认/一致性流程处理。
