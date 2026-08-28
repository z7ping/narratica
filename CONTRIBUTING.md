# 参与 Narratica 开发

Narratica 当前处于 Alpha / Developer Preview 阶段。现阶段优先保证架构边界、真实数据链、作者确认边界和 DSH Bundle 兼容性，不以快速扩功能为目标。

## 开发环境

- Node.js：推荐 24，最低 `22.19.0`
- pnpm：`11.7.0`
- DSH：`0.1.1-rc.2`
- Cordis：`4.0.1`

安装依赖并运行完整检查：

```bash
pnpm install --frozen-lockfile
pnpm run check
```

## 重要架构边界

- Narratica 是标准树外 DSH Bundle，不修改 DSH 源码、不维护 DSH Fork。
- Story Repository / Markdown 是作品事实源。
- Agent 可以生成候选、分析和解释，但作者采用、正式确认和最终交付等确定性边界必须由用户触发。
- 不使用假业务状态、假 AI 执行或假文件系统结果冒充真实能力。
- Director 语言模型配置与图片 / 视频 / 音频 Production Provider 保持分离。
- 不为了 UI 表现绕过正式业务链或建立第二事实源。

公开仓库以源码、Schema、配置和 `tests/` 为工程事实源。产品原型、内部设计过程和项目知识不作为公开构建输入。

## Pull Request

建议一个 PR 只解决一类问题，并说明：

- 为什么需要修改；
- 修改了什么；
- 是否影响 Story Repository、DSH Profile、模型策略或 Production Runtime；
- 做过哪些验证；
- 是否存在兼容性风险。

涉及长期架构边界变化时，应同步更新公开代码中的契约、架构测试或必要的用户文档；内部产品决策由项目私有知识库维护。

## 品牌

代码遵循 MIT License；Narratica 名称、Logo、App Icon、英文字标和其他品牌标识的使用规则见 `TRADEMARKS.md`。
