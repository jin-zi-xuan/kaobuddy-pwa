# 更新记录

## v1.2.2 - 2026-06-18

这是一个 Windows 免安装包补丁版，专门修复用户打开本地端口时首页 500 的问题。

### 修复

- 修复 PyInstaller 便携包在部分环境下找不到 `backend/static/index.html`，导致 `/health` 正常但首页显示 `Internal Server Error` 的问题。
- 启动器现在会兼容 PyInstaller 的 `_internal` 运行目录布局，能从正确位置找到前端静态文件。
- 打包脚本在生成 exe 前会检查首页、manifest、service worker 和图标是否存在，避免再发布缺静态文件的包。

## v1.2.1 - 2026-06-15

这是一个补丁版，主要修复多项目并行备考时的计划草稿串用问题。

### 修复

- 多个项目之间的“补充要求”现在按项目单独保存草稿。切换项目后，不会再把 A 项目的计划补充词带到 B 项目里。
- 给项目草稿隔离补了前端测试，避免后面再把这个状态改回全局共用。

## v1.1.0 - 2026-06-07

云端预览版。把本地 PWA 搬到了 Railway 上，顺便补了一轮工程基础——CI/CD、日志、安全、错误处理、测试——让项目从”自己电脑上能跑”变成”别人打开链接就能用”。

### 部署

- Docker 多阶段构建：`node:22` 构建前端 → `python:3.11` 运行后端，最终镜像 ~200MB
- Railway / Fly.io 部署配置（Dockerfile + Procfile + fly.toml）
- 根入口 `main.py` 让 Railpack 自动检测 FastAPI
- SPA fallback 路由：刷新不 404
- 服务端环境变量配置（ALLOWED_ORIGINS / KAOBUDDY_AI_* / KAOBUDDY_INVITE_*）
- Docker HEALTHCHECK：每 30 秒检查 /health

### CI/CD

- GitHub Actions：push/PR 自动跑 py_compile + pytest + tsc + vite build
- Python 语法检查 + 21 个后端测试
- TypeScript 类型检查 + 36 个前端测试 + Vite 构建

### 日志 & 可观测性

- 结构化 JSON 日志，每行一条，输出 stdout（Railway/Fly.io 自动采集）
- 每条日志含：timestamp、level、message、request_id、duration_ms
- 请求计时中间件：每个 HTTP 请求记录 method/path/status/duration_ms
- 全局异常处理器：未捕获异常自动记录完整 traceback
- 关键路径打点：AI 调用（auth 模式/provider/model/耗时）、邀请码用量、视频导入、流式卡片
- API Key 和邀请码自动脱敏

### 安全

- Content-Security-Policy 头：限制 script/style/connect/font 来源
- 流式卡片端点 `/api/ai/cards/stream` 走统一 auth 流程，不再绕过邀请码验证
- 邀请码用量实时校验 + 预算封顶
- CORS 来源通过环境变量控制，同源部署无需设置

### 健壮性

- Error Boundary：React 异常不再白屏，显示错误信息 + 刷新按钮
- Service Worker 版本每次构建自动递增（Date.now() 注入）
- SW 注册超时保护：unregister/cache-delete 2 秒超时，不阻塞新 SW 注册
- `crypto.randomUUID()` polyfill：旧版微信 WebView 兼容
- 非阻塞 Google Fonts：被墙也不白屏，立即用系统字体渲染
- IndexedDB 版本迁移机制：数据结构变更时老用户自动升级
- 流式解析异常改为 `except (JSONDecodeError, KeyError, ...)`，打 warning 日志，不吞异常
- 每日计划把实际考试天数和剩余模块分钟数传给 AI
- 模拟考批改细化逐题评分逻辑

### 性能

- PDF worker（2.2MB）懒加载：仅用户导入 PDF 时才下载，初始包 4.1MB → 1.5MB
- `useCardLearning` hook 拆分，减少 App.tsx 体积

### 代码质量

- 构建产物 `backend/static/assets/` 从 git 移除（--57,000 行）
- `python-multipart` 依赖清理（未使用）
- `noscript` 兜底提示
- `.dockerignore` 瘦身构建上下文

### 测试

- 后端 15 → 21 个测试（CSP 头、超大请求 413、空邀请码 422、空模块列表等）
- 前端 27 → 36 个测试（plan 解析边缘用例、createId 唯一性等）


## v1.0.0 - 2026-06-01

这是 KaoBuddy 的第一版。它先把”临时抱佛脚也能有章法”这条主线跑通：本地启动、自己填 API Key、导入资料、拆知识点、按模块学习、生成模拟考和临考速背。

### 新增

- Mac `open-kaobuddy.command` 和 Windows `open-kaobuddy.bat` 双击启动。
- React/Vite PWA 前端，由 FastAPI 托管构建后的页面。
- 初始化流程：介绍用途、连接 AI、创建第一个项目。
- 项目侧边栏：支持多个科目项目切换、编辑基本信息和删除项目。
- 项目内分页：总览、资料、计划、模拟考、临考速背。
- 资料导入：PDF、DOCX、RTF、TXT、Markdown、手写图片/PDF、B站等视频链接。
- DOCX/RTF 正文解析，PDF 文字层读取，资料库列表保留资料名和删除按钮。
- AI 知识模块计划：只拆具体知识点，不按日期生成任务。
- 模块看板：待学习、学习中、已学习；支持拖拽、点击学习、完成学习。
- 模块详情：会考什么、模块讲解、模块模拟题、换一批模拟题。
- 模拟考：可填考试时长和题型要求，历史记录可重命名、点击查看。
- 模拟考 PDF 导出。
- 临考速背：按知识点生成速背卡片，支持斩、撤销和重置。
- API 设置：默认 DeepSeek，Base URL 和 Model 收进高级设置。

### 修复和打磨

- 去掉旧页面里”今天怎么学，今天再调”之类的单页仪表盘表达，保留主标题”考搭子”。
- AI 输出尽量清理 Markdown、HTML、短横线分隔和 JSON 直出。
- 表格内容能渲染成表格，模拟考 PDF 里也会处理表格。
- 模块标题过滤”每日任务、全真模拟、错题回顾”等非知识点内容。
- 模拟考记录列表只显示名称和生成时间，不再在卡片里塞大段正文。
- 资料上传队列显示读取状态，失败时能看到原因。

### 已知限制

- 旧版 `.doc` 不能稳定解析，需要另存为 `.docx` 或 PDF。
- 扫描版 PDF、复杂公式和图片图表依赖模型能力，效果会随资料质量波动。
- 这是本地单人版，暂时不做账号、云同步和多人协作。
