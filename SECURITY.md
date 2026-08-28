# 安全策略

Narratica 当前处于 Alpha / Developer Preview 阶段，但仍把故事资产、模型配置、Provider 配置和本地运行环境的安全问题视为发布阻断项。

## 支持范围

安全修复优先覆盖当前默认分支和最新预发布版本。早期实验版本不承诺持续维护。

## 报告安全问题

请不要在公开 Issue 中直接披露可利用的漏洞、令牌、私钥、用户作品内容或其他敏感信息。

优先使用 GitHub 仓库的私密漏洞报告 / Security Advisory 能力提交安全问题。若该能力暂未开启，请通过仓库维护者的 GitHub 主页建立私密联系，并只提供定位问题所需的最少信息。

报告中建议包含：

- 受影响版本或 commit；
- 复现条件；
- 实际影响；
- 最小复现步骤；
- 是否涉及凭据、作品数据或宿主 DSH Profile。

## 敏感信息原则

Narratica 不应把 API Token、密码、私钥等敏感配置提交到 Story Repository 或 Git 仓库。与模型、Provider、Runtime 相关的敏感值应由宿主环境或相应配置系统管理。
