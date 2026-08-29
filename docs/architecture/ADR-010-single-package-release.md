# ADR-010：内部多包、对外单 npm 包发行

- 状态：Accepted
- 生效版本：0.1.0-alpha.3
- 日期：2026-08-29

## 背景

Narratica 当前采用 pnpm workspace 组织多个内部模块，包含 Bundle、Client、Plugin、Core、Runtime、Shared 与 Story Tools。alpha.1 / alpha.2 的发行链会从 `@narratica/narratica` 递归计算内部依赖闭包，并将闭包内所有 `@narratica/*` workspace 包发布到 npm。

这种方式能工作，但把源码组织边界等同于公共发行边界：内部实现包会成为可被第三方直接安装和依赖的公共 npm 包，从而形成额外的兼容性与版本维护承诺。

## 决策

从 `0.1.0-alpha.3` 起：

1. Narratica 继续保留现有多 workspace 模块结构，不合并源码目录，不取消 Cordis / DSH 插件与 Client Fiber 边界。
2. npm 正式发行只包含一个公共包：`@narratica/narratica`。
3. 其他 `@narratica/*` workspace 包继续保持 `private: true`，只作为仓库内部编译、测试和依赖边界，不再独立发布新版本。
4. Host Plugin、Story Tools、Client 等运行时代码在构建/发行阶段进入 `@narratica/narratica` 的 tarball；发行态入口包不得依赖任何其他 `@narratica/*` npm 包。
5. DSH Profile 与 Bundle 对外仍只解析 `@narratica/narratica` 及其子路径，不改变现有产品安装入口和运行模型。
6. alpha.1 / alpha.2 已发布的内部包保留，不删除、不 unpublish；从 alpha.3 起停止继续发布这些内部实现包。

## 非目标

本次不重构 Story Repository、Director、三种创作模式、DSH/Cordis 装配模型或 workspace 源码模块边界；不把所有内部模块打成一个巨型源码文件。

## 发行契约

alpha.3 及以后必须满足：

- `release-plan` / `release-manifest` 中正式 npm 发布包数量为 1。
- 唯一发行包为 `@narratica/narratica`。
- 发行态 `@narratica/narratica/package.json` 的 dependencies / optionalDependencies / peerDependencies 中不存在 `@narratica/*` 内部依赖。
- `npm pack` 后的入口 tarball 包含 DSH Bundle 所需 Host Runtime、Story Tools 与 Client 产物。
- 本地烟测在干净临时目录中只安装入口 tarball即可创建 Narratica Profile 并启动 DSH Web。
- Registry 烟测只安装 `@narratica/narratica@<version>` 即可运行；不得依赖同版本内部 `@narratica/*` 包已发布。

## 结果

源码继续保持模块化；npm 只暴露一个稳定产品边界。未来只有当某个内部模块具有明确、独立、长期受支持的第三方复用价值时，才通过新的 ADR 将其提升为公共 npm 包。