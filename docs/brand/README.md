# Narratica 品牌规范

Narratica 的公开代码仓库只保留已经确认、会被产品或发行使用的品牌源资产。历史备份、候选方案和设计过程已归档到私有产品资料库，不作为公开代码仓库的工程输入。

## 品牌

- 产品名：Narratica
- Slogan：**心里的故事，陪你做成作品。**
- 主色：`#0D1B2A`
- 强调色：`#FFA623`
- 视觉气质：克制、温暖、创作感、专业

## 正式源资产

### App Icon

唯一正式主母版：

`logo/master/2026-08-26/narratica-app-icon-master.svg`

产品工作副本：

`logo/narratica-mark.svg`

正式 DSH Client 派生副本：

`packages/client/layout/src/client/assets/narratica-app-icon.svg`

三者的核心几何与颜色不得独立修改。正式客户端资产由架构测试校验与主母版一致。

### Narratica Wordmark

唯一正式主母版：

`logo/master/2026-08-26/narratica-wordmark-master.svg`

正式 DSH Client 派生副本：

`packages/client/layout/src/client/assets/narratica-wordmark.svg`

正式产品壳和故事库的可见品牌名使用 Wordmark SVG；普通系统字体 `Narratica` 只用于语义文本、无障碍标签和文档正文。

### Slogan

正式文案固定为：

> 心里的故事，陪你做成作品。

规则见：

`logo/master/2026-08-26/narratica-slogan-spec.md`

当前公开产品不把未确认的中文转曲字形或组合稿作为正式资产。

## 使用规则

1. 不修改 App Icon 的笔尖、星光与笔触核心几何。
2. 强调色固定为 `#FFA623`，不恢复历史旧色值。
3. 产品实现不得重新手写第二套 Logo path。
4. 顶部产品壳、故事库等品牌识别位置使用正式 Wordmark。
5. 当前作品名称与 Narratica 品牌身份分离。
6. 平台派生只允许调整安全区、尺寸和平台 mask，不改变母版核心几何。
7. 新品牌版本需要新的正式母版和明确确认，不直接覆盖当前母版。

## 许可证与商标

代码使用 MIT License；Narratica 名称、Logo、App Icon、Wordmark 等品牌标识的使用规则见仓库根目录 `TRADEMARKS.md`。
