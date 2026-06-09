# KaoBuddy 懒猫微服迁移需求

Issue: https://github.com/jin-zi-xuan/kaobuddy-pwa/issues/25

## 目标

把当前 KaoBuddy PWA 打包成懒猫微服可安装的 LPK 应用，保持现有产品形态不变：FastAPI 托管构建后的 React 静态页面，浏览器端保存学习数据，用户自带 OpenAI-compatible API Key。

## 写入范围

Allowed write scope
- Lazycat packaging/runtime: `package.yml`, `lzc-build.yml`, `lzc-manifest.yml`
- Build/install wrapper: `Makefile`, `build.sh`
- Runtime wrapper content: `lzc-content/`
- Port documentation/assets: `docs/`, `lzc-icon.png`

Forbidden write scope
- Upstream frontend pages/components/routes/state
- Upstream backend handlers/services/domain logic/auth logic
- Upstream database schema/migrations/models
- Upstream tests or fixtures used to justify changed behavior
- Any existing upstream application source file unless the user explicitly approves product-development scope

## 用户使用要求

- 默认使用 BYOK：用户在页面里填写自己的 API Key。
- 邀请码模式仍按现有后端逻辑工作；只有管理员额外配置 `KAOBUDDY_AI_*` 和 `KAOBUDDY_INVITE_CODES` 后才可用。
- 文件上传入口需要提供懒猫文件选择器，同时保留本地文件选择原流程。
- 不引入账号系统、云同步或新的服务端数据库。

## 非目标

- 不重写前端体验。
- 不接入 OIDC，因为应用本身没有内部账号登录。
- 不做上架查重或激励申报判断；这是当前项目的自有迁移，不是开源应用选型。
