---
name: chapter-commit
description: 章节完成且通过 Gate 后，从 canonical prose 提取可追溯事实增量与状态变化，生成 Chapter Commit 并触发 Story Bible 更新。
---
# chapter-commit

## 分类
派生外挂能力（derived-addon）。

## 定位
`canonical prose -> facts/deltas -> chapter commit -> story state projection`

正文是权威；Commit 是机器可维护的派生事实层。

## 输入
```yaml
chapter_id:
mode: commit | rebuild | inspect
```

## 正式 Commit 前置
1. 章节 scope 完整。
2. 所有纳入正文为 canonical。
3. 每个 source 有可验证 revision token。
4. actual summary fresh，或直接回读完整 canonical prose。
5. `22-quality-gate` 为 PASS / PASS_WITH_WARNINGS。
6. 无 unresolved P0/P1。

否则只能 preview commit。

## 写入
`11-runtime/commits/chapter-<id>.md`

元数据：
```yaml
kind: chapter-commit
authority: derived
runtime_status: current
chapter_id:
derived_from: []
source_revisions: {}
quality_gate:
previous_commit:
commit_revision: 1
```

## 事实增量
- events
- character_changes
- relationship_changes
- knowledge_changes：learned/discovered/inferred/believes/misunderstood/revealed_to
- item_changes
- timeline
- open_loops：added/advanced/resolved/abandoned
- foreshadowing
- secrets
- plot_threads
- next_constraints（只能由已发生事实自然产生）

## Evidence
重要 delta 必须尽量指向 canonical prose source + revision。不确定推断保留 `uncertain/confidence`，不得投影成硬事实。

## 不可变性 / 重建
canonical prose 后续修改：
1. 检测 revision mismatch；
2. 旧 commit `runtime_status: stale` 或 `superseded`；
3. 生成新 `commit_revision`；
4. `20-story-bible rebuild/update` 重算状态。

## 更新 Story Bible
Commit 成功后调用 `20-story-bible --update chapter=<id>`。

允许更新派生 Registry / Current State / Open Loops；禁止直接覆盖 `02-settings/**`、canonical prose、canonical planned outline。

若正文事实上要求修改硬设定，只产 `proposed canon patch`，交用户/`02-setting` 决定。

## 与 Summary
- summary：为了阅读/检索，描述“发生了什么”。
- commit：为了状态维护，描述“哪些事实/状态发生了变化”。

## 禁止
- planned outline → 已发生事件。
- Gate FAIL 仍正式 commit。
- Commit 覆盖正文。
- 推测写成角色已知事实。
