# Lazycat 集成说明

## HTTP 入口

`lzc-manifest.yml` 将根路径转发到 FastAPI 服务：

```yaml
routes:
  - /=http://kaobuddy:8080
```

FastAPI 已有 `/health`，同时托管 `/`, `/assets/*`, `/icons/*`, `/manifest.webmanifest`, `/sw.js` 和 `/api/*`。

## 文件选择器注入

KaoBuddy 有 `<input type="file">` 上传入口和 PDF 导出流程。迁移层通过 `application.injects` 注入懒猫文件选择器脚本：

```yaml
src: file:///lzcapp/pkg/content/lazycat-injects/lzc-file-chooser-inject.js
hooks:
  fileSystemAccess: true
  fileInput: true
```

这保持非侵入：不改 `src/App.tsx` 的上传组件，浏览器端仍能选择本地文件；在懒猫环境中会额外提供微服文件选择入口。

## 持久化

服务端唯一需要持久化的默认路径是邀请码用量：

```text
/app/work/invites.json
```

Lazycat bind:

```yaml
/lzcapp/var/work:/app/work
```

用户学习资料、计划、错题、API Key 仍按现有实现保存在浏览器 IndexedDB/localStorage。
