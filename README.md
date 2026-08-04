# KaoBuddy 考研搭子

KaoBuddy 是一个本地优先的考研学习工作台。它把考试目标、每日计划、学习资料、B 站课程、练习、模拟考试、错题和速背内容放在一起，让你每次打开都知道下一步该做什么。

当前主版本已经迁移到 Rust + Dioxus。旧版 React + FastAPI 代码仍保留在仓库中，用于数据迁移和 API 兼容验证，但不再是默认入口。

## 现在能做什么

- 建立考研项目，记录考试日期、每日时间、目标分数和薄弱项
- 用今天视图查看倒计时、总进度和当前最该完成的学习块
- 管理待学习、进行中、已完成的知识模块
- 导入文字、PDF、文档、手写照片和视频资料
- 粘贴 B 站 BV/AV 链接，在应用内使用官方播放器观看课程
- 把视频同步保存为学习资料，边看边整理笔记
- 连接任意 OpenAI-compatible 模型，生成计划、讲解、练习、卡片和模拟卷
- 保存错题、薄弱项和临考速背内容
- 浏览器本地保存学习数据和 API 配置
- 作为 PWA 安装到桌面或手机主屏幕

## 直接启动

需要先安装 [Rust](https://rustup.rs)。第一次启动会自动安装 Dioxus CLI 和 WebAssembly target。

Windows：

```powershell
open-kaobuddy.bat
```

macOS：

```bash
chmod +x open-kaobuddy.command
./open-kaobuddy.command
```

启动后访问 `http://127.0.0.1:8000`。

## 开发

```bash
rustup target add wasm32-unknown-unknown
cargo install dioxus-cli --version 0.7.10 --locked
cd rust-app
dx serve --web --port 8000
```

## 验证

```bash
cargo fmt --all -- --check
cargo test -p kaobuddy --features server
cargo clippy -p kaobuddy --features server -- -D warnings
cargo check -p kaobuddy --target wasm32-unknown-unknown --features web
```

迁移期仍保留旧版兼容测试：

```bash
python -m pip install -e ".[test]"
python -m pytest -q
npm ci
npx tsc --noEmit
node --import tsx --test tests/frontend/*.test.ts
```

## 目录

```text
.
├── rust-app/                # 当前 Rust + Dioxus 主应用
│   ├── assets/              # 视觉、PWA 与静态资源
│   └── src/
│       ├── main.rs          # Dioxus / Axum 启动入口
│       ├── server.rs        # 旧 API 兼容层、AI 代理、视频解析
│       ├── ui.rs            # Dioxus 界面与主要交互
│       ├── models.rs        # 学习数据模型
│       ├── storage.rs       # 浏览器本地存储
│       └── bilibili.rs      # B 站链接与官方播放器地址解析
├── backend/                 # 旧 FastAPI 兼容参考
├── src/                     # 旧 React 兼容参考
├── tests/                   # 旧行为回归测试
├── Cargo.toml               # Rust workspace
└── open-kaobuddy.*          # 双击启动入口
```

## B 站播放说明

KaoBuddy 使用 `player.bilibili.com` 官方嵌入播放器，不下载或转存视频。公开视频能否播放、清晰度、登录状态和地区限制由 B 站决定。字幕抓取仍是 best-effort，视频没有公开字幕时可以手动粘贴课程笔记。

## 数据与隐私

- 学习项目、任务、资料索引和设置默认保存在浏览器本地
- 自带 API Key 模式下，Key 不写入 KaoBuddy 服务端数据库
- 服务端只负责同源 API、AI 代理兼容和公开视频信息读取
- 不提供账号、付费和云同步

## 迁移说明

旧版 API 路径继续保留，包括 `/api/ai/plan`、`/api/ai/daily-plan`、`/api/ai/teach`、`/api/ai/cards`、`/api/ai/practice`、`/api/ai/mock-exam`、`/api/ocr/handwriting` 和 `/api/video/import`。详细映射见 [docs/RUST_DIOXUS_MIGRATION.md](docs/RUST_DIOXUS_MIGRATION.md)。

## 许可

MIT
