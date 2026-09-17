# KaoBuddy 项目规则

这些规则是给 Codex / 维护者看的，目的是让这个项目一直保持清楚、有痕迹、能直接打开用。

## 基本偏好

- 默认语言：Python。
- 默认后端框架：FastAPI。
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

- 第一版主打“直接打开能用”。
- 默认入口是 `open-kaobuddy.command`。
- FastAPI 直接托管当前可用页面：`backend/static/index.html`。
- React/Vite 是当前默认前端，构建产物输出到 `backend/static/`，由 FastAPI 托管。

## 本地目录

长期项目目录：

```text
/Users/Zhuanz/Documents/kaoBuddy
```

不要再把 KaoBuddy 放在 Codex 的日期目录下面。

## 测试要求

常规验证：

```bash
.venv/bin/pytest -q
python3 -m py_compile backend/app/*.py
```

涉及页面体验时，需要用浏览器实际打开：

```text
http://127.0.0.1:8000
```

如果用户要求“我也要看得到”，就用 Computer Use 操作 Finder/浏览器做可见测试，不只是在后台 curl。

