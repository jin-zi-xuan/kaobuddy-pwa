# KaoBuddy 考研搭子

KaoBuddy 是一个真正的 Windows 桌面端考研学习工作台。它用 Rust + Dioxus Desktop 构建，打开后是独立原生窗口，不需要浏览器、localhost 或常驻后端服务。

## 现在能做什么

- 建立考研目标，记录考试日期、每日时间、目标分数和薄弱项
- 管理今天、待学习、进行中和已完成的学习块
- 导入文字、PDF、文档、手写照片和课程资料
- 粘贴 B 站 BV/AV 链接，在桌面 APP 内使用官方播放器看课
- 保存课程笔记，联动资料库
- 连接 OpenAI-compatible 模型，生成计划和模拟卷
- 保存错题、速背内容、学习数据和 AI 配置

## 直接启动桌面版

开发环境第一次运行需要安装 [Rust](https://rustup.rs)。之后双击：

```text
open-kaobuddy.bat
```

脚本会直接打开 KaoBuddy 桌面窗口，不会启动浏览器。

## 生成 Windows 安装包

双击：

```text
build-windows-installer.bat
```

生成的 NSIS `.exe` 安装包位于：

```text
rust-app/desktop-dist/Kaobuddy_2.0.0_x64-setup.exe
```

安装包当前未做商业代码签名，Windows 可能显示“未知发布者”。正式对外发布前需要配置代码签名证书。

安装包按当前用户安装，并在需要时静默安装 Microsoft WebView2 Bootstrapper。

## 开发

```powershell
cargo install dioxus-cli --version 0.7.10 --locked
cd rust-app
dx serve --desktop
```

## 验证

```powershell
cargo fmt --all -- --check
cargo test -p kaobuddy
cargo clippy -p kaobuddy -- -D warnings
cargo build -p kaobuddy --release --features bundle
```

构建完整安装包：

```powershell
cd rust-app
dx bundle --desktop --release --features bundle --package-types nsis
```

迁移期兼容测试：

```powershell
cargo test -p kaobuddy --no-default-features --features server
python -m pytest -q
npx tsc --noEmit
node --import tsx --test tests/frontend/*.test.ts
```

## 数据与隐私

- 学习数据保存在 `%LOCALAPPDATA%\KaoBuddy\KaoBuddy\data\kaobuddy-data.json`
- API Key 只写入本机数据文件；调用模型时直接发送给用户配置的 AI 服务商
- 不需要 KaoBuddy 账号，也不提供云同步
- B 站视频使用官方嵌入播放器，不下载或转存视频

## 项目结构

```text
rust-app/
├── assets/                 # 桌面视觉、图片和 Windows 图标
└── src/
    ├── main.rs             # Dioxus Desktop 原生窗口入口
    ├── ui.rs               # 考研搭子界面与交互
    ├── client.rs           # 原生 AI 请求
    ├── storage.rs          # Windows 本地文件存储
    ├── models.rs           # 学习数据模型
    ├── bilibili.rs         # B 站官方播放器地址
    └── server.rs           # 迁移期旧 API 兼容层
```

## 许可

MIT
