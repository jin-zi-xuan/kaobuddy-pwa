# KaoBuddy 项目规则

这些规则是给 Codex / 维护者看的，目的是让这个项目一直保持清楚、有痕迹、能直接打开用。

## 基本偏好

- 默认语言：Rust。
- 默认界面框架：Dioxus 0.7 Desktop。
- 文档和说明优先用中文，语气自然一点，不要太官方。
- 改代码前先读项目结构，优先跑现有测试。
- 不做大而空的重构，不顺手改无关文件。

## 工作流

- 每次和用户沟通完需求后，先在 GitHub 写对应 issue。
- 从 issue 开分支实现，不直接在 `main` 上改。
- 分支命名尽量清楚，比如 `feature/...`、`fix/...`、`chore/...`。
- 做完后提交 PR，写清楚：
  - 做了什么。
  - 怎么验证。
  - 有什么限制或风险。
- PR 合并后关闭对应 issue。

## 当前产品形态

- 产品定位是长期陪伴型的“考研搭子”应用。
- 唯一默认入口是 Windows 下的 `open-kaobuddy.bat`。
- 当前产品是独立 Windows 桌面 APP，不以 Web/PWA 交付，不要求 localhost。
- Rust 原生逻辑与 Dioxus Desktop 界面都在 `rust-app/`。
- Python/FastAPI 与 React/Vite 代码只保留为迁移兼容层，不是当前默认启动入口。

## 本地目录

长期项目目录：

```text
/Users/Zhuanz/Documents/kaoBuddy
```

不要再把 KaoBuddy 放在 Codex 的日期目录下面。

## 测试要求

常规验证：

```bash
cargo fmt --all -- --check
cargo test -p kaobuddy
cargo clippy -p kaobuddy -- -D warnings
cargo build -p kaobuddy --release --features bundle
```

涉及界面体验时，需要用 `dx serve --desktop` 启动真实 Windows 窗口，并用 Computer Use 做可见测试。
