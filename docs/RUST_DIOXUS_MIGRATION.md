# Rust + Dioxus Desktop 迁移说明

## 最终交付目标

KaoBuddy 的当前产品是 Windows 桌面端考研搭子，不是网站或 PWA。程序通过 Dioxus Desktop 创建原生窗口，Rust 代码直接运行在 Windows 上，界面由系统 WebView2 渲染。

## 技术映射

| 旧实现 | 当前实现 |
|---|---|
| React 19 + Vite | Dioxus 0.7 Desktop |
| FastAPI 常驻服务 | Rust 原生应用逻辑 |
| 浏览器 localStorage | `%LOCALAPPDATA%` JSON 数据文件 |
| 浏览器请求 localhost | 原生 reqwest 直接请求 AI 服务商 |
| Web/PWA 安装 | NSIS `.exe` Windows 安装包 |
| 浏览器页面 | 独立 Windows 原生窗口 |

## 桌面窗口

- 默认尺寸：1280 × 820
- 最小尺寸：920 × 640
- 发布构建隐藏控制台窗口
- 安装包使用当前用户安装模式
- 安装器在缺少 WebView2 时下载官方 Bootstrapper

## B 站视频

应用从 BV/AV 链接生成 `player.bilibili.com` 官方嵌入地址，并直接显示在桌面 WebView 中。KaoBuddy 不下载视频；登录、清晰度和地区限制仍由 B 站决定。

## 本地数据

项目、任务、资料、课程、错题和 API 配置保存在 Windows 本地应用数据目录。桌面版不依赖浏览器存储，关闭窗口后可在下次启动恢复。

## 兼容层

`server.rs`、`backend/` 和根目录 `src/` 暂时保留，仅用于旧 API 与数据行为回归，不参与 Windows 桌面版的正常启动。
