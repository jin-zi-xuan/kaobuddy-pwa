# 考搭子 KaoBuddy

> 一个给临时抱佛脚的人用的备考工作台。离考试还有两周？够用了。<img width="2640" height="1416" alt="image" src="https://github.com/user-attachments/assets/ed685b20-3300-4ad0-8a90-a69c10616e53" />


你把课件、教材、往年题、笔记、PDF、手写照片、视频字幕扔进来，剩下的交给 AI——拆知识点、讲重点、出题、批改、生成模拟考、临考速背卡片。自己带 API Key，数据全在浏览器里，目前不搞账号，以后再弄。

> 之前的 Railway 在线预览因为免费额度用完了，现在不保证能打开。
>
> Windows 用户建议直接下载免安装便携包：解压后双击启动，不用自己装 Python 或 Node。
>
> macOS 免安装包暂时不推荐发布，因为未做 Apple 签名/公证会被系统拦截。Mac 用户先按下面的源码运行或云部署方式使用。

---

## 它解决什么问题

大多数学习工具的假设是你有三个月时间、能每天打开电脑、愿意先花一天整理知识库。考搭子的假设刚好相反：**你离考试没几天了，只想把手上乱七八糟的资料快速变成能学的东西。**

具体点说：

- 课件 PDF、教材扫描件、课堂笔记（txt/md/docx）、手写拍照、B 站视频字幕——全都能吃进去。
- AI 从资料里抽"进程""线程""死锁""银行家算法"这种**知识点**，你可以选择自己安排学习计划或者切换日计划模式让ai带你无脑学习。
- 按知识点模块推进，学完就点完成，圆环形进度条帮助你可视化进度。
- 针对单个知识点讲解、生成学习卡片、出模拟题——不是泛泛的"本章复习"。
- 考前生成模拟考，可自定义题型和时长，导出 PDF 打印，也可ai答题。但考虑到ai阅卷不太成熟，所以还有个答案速览模式，可以自行选择。
- 最后的时间切到临考速背模式，背一个斩一个，帮你快速回顾知识点。

---

## 功能

### 连接 AI

内置四个预设，填 API Key 就能开始：

| 预设 | 模型 |
|---|---|
| DeepSeek（默认） | deepseek-v4 pro/flash |
| Kimi 国内 | kimi-k2.6 |
| Kimi 国际 | kimi-k2.6 |
| OpenAI | gpt-5.5/mini |
| 自定义 | 任意 OpenAI-compatible |

支持两种模式：
- **BYOK（自带 Key）**：填自己的 API Key，请求直接从浏览器发到你的 AI 服务商。Key 存 localStorage，服务端不落盘。
- **邀请码（beta）**：如果你有邀请码，可以先不填 Key，用服务端配置的 API 额度体验。用完再切换回你自己的API。

### 创建考试项目

填科目、考试日期、每天能学多久、目标分数、已知薄弱点。考搭子会根据这些信息来排优先级和估时——离考试越近、目标越高，知识点拆分得越细。

### 资料库

支持的格式：

| 格式 | 方式 |
|---|---|
| PDF | 读取文字层（扫描版也能提取，图表和公式效果取决于模型） |
| DOCX | 提取正文，mammoth 引擎 |
| RTF | 提取文本 |
| TXT / Markdown | 直接读取 |
| 旧 .doc | best-effort 解析（建议另存为 docx 或 PDF） |
| 手写笔记 | 上传图片或手写 PDF → AI 视觉识别 → 转文字入库 |
| B 站视频 | 粘贴链接 → 自动抓取公开信息和字幕 |

文件在浏览器端解析，不上传到服务器。超大 PDF 用分片策略，每次只取一层文字，秒级读完。

### 知识模块计划

这是考搭子的核心。AI 根据你导入的资料，拆出"进程同步""银行家算法""极限定义"这种**可考的知识点**，每个模块带：

- 知识点名称
- 难度（低/中/高）
- 重要程度排名
- 考察内容（"会考什么"）
- 资料来源和证据（"资料里哪句话证明这个知识点存在"）

目标分数 ≥ 90 分时，AI 会按高覆盖率拆分：章节标题、二级标题、定义、机制、算法、典型题型、易错点，一个不落。

### 每日计划

拆分完知识点后，一键生成每日安排。AI 会根据剩余天数、每天可学时间、模块重要程度和难度，把模块均匀分配到每一天。逾期没学的模块自动滚到今天。

两种视图：
- **知识模块**：待学习 / 学习中 / 已学习，看板拖拽排序
- **每日计划**：日历视图，每天学什么一目了然

### 模块学习

点进一个知识点，你可以：

- **看讲解**：AI 用零基础语言讲这个知识点——先从生活直觉开始，再讲定义、原理、解题步骤，最后用资料里的例题演示
- **出模拟题**：围绕这个知识点生成 3 道题，做完后可换一批
- **学习卡片**：互动方式学习知识点。

学完标记完成，进度条自动更新。

### 模拟考

自定义考试时长（5-180 分钟）和题型要求（"选择题 + 简答题，偏计算"），AI 严格按你导入的资料出题，不编造资料里没有的内容。

两种模式：
- **考题模式**：直接出卷子，考完 AI 逐题批改——选择题对答案字母，简答题按得分要点给分，措辞不要求完全一致
- **AI 答题模式**：AI 先自己答一遍（展示它的解题思路），再对照你提交的答案批改

每道题批改结果带标记：✓（正确）、✗（错误）、△（部分得分）。错题自动收入错题本。整份试卷导出成 A4 PDF。

### 临考速背

把知识点压成速背卡片，结构是：核心概念 → 必背要点 → 记忆口诀 → 常见考法 → 易错提醒。适合考前最后一天翻。

### 学习卡片

围绕指定知识点生成 4-6 张卡片，四种类型：

| 类型 | 正面 | 背面 |
|---|---|---|
| concept（概念卡） | "什么是死锁？" | 一句话定义 + 考试要点 |
| mistake（易错卡） | "关于死锁，常见的错误是？" | 易错点解释 |
| exam（考试卡） | 一道简答题 | 参考答案 + 考试答法 |
| quick_memory（速背卡） | "记住死锁四条件" | 精简口诀 |

卡片流式生成——AI 出一张，你立刻就能翻一张。支持手势滑动，左滑不会、右滑会。第一轮筛下来的弱卡自动进入第二轮。

### 错题本

模拟考批改的错题自动入库，手动也能添加。薄弱点独立管理，带严重程度标记，可定期复习。也可以手动添加错题

### 数据管理

所有数据（项目、资料、计划、模块、错题、模拟考记录）存在浏览器 IndexedDB 里，不经过服务器。支持一键导出 JSON 备份，导入时自动合并。

---

## 怎么用

### Windows 用户：下载免安装包

1. 打开 GitHub Releases：

> **[KaoBuddy Releases](https://github.com/jin-zi-xuan/kaobuddy-pwa/releases)**

2. 下载 `KaoBuddy-Windows.zip`。
3. 解压 zip。
4. 双击 `start-kaobuddy.bat`。
5. 浏览器会自动打开 `http://127.0.0.1:8000`。填自己的 AI API Key，就能开始用。

便携包是本机运行。关闭启动窗口，KaoBuddy 也会停止。

### Mac 用户：源码运行

macOS 现在先不提供免安装一键启动包。原因是没有 Apple Developer ID 签名和公证时，下载包会被 Gatekeeper 拦截。

适合只是自己在电脑上用。第一次会慢一点，因为要装依赖和构建页面。

源码启动需要本机已经装好 Python 3 和 Node.js LTS。脚本会自动装依赖、构建页面、启动服务，并打开 `http://127.0.0.1:8000`。

**Mac**：双击 `open-kaobuddy.command`

如果 macOS 提示不让打开，可以在终端里执行一次：

```bash
chmod +x open-kaobuddy.command
./open-kaobuddy.command
```

### 源码运行（Windows）

如果你是开发者，或者想自己从源码启动，也可以不用 Release 便携包：

**Windows**：双击 `open-kaobuddy.bat`

源码启动需要本机已经装好 Python 3 和 Node.js LTS。脚本会自动装依赖、构建页面、启动服务，并打开 `http://127.0.0.1:8000`。

如果双击后窗口一闪而过，通常是 Python 或 Node.js 没装好。可以在项目文件夹空白处右键，选择“在终端中打开”，然后跑：

```powershell
py -3 --version
node --version
npm --version
open-kaobuddy.bat
```

前三条都能显示版本号，脚本一般就能正常跑。

### 开发者启动

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 FastAPI 后端和 Vite 前端：
- 后端：`http://127.0.0.1:8000`
- 前端开发页：`http://localhost:5173`

如果只想开前端：

```bash
npm run dev:frontend
```

注意：只开前端时，`8000` 后端必须另外启动，不然测试 API Key 会失败。

### 自己部署到云平台

如果想让手机、平板或者别人也能访问，就需要部署到自己的云平台账号里。项目已经带了 Dockerfile、Fly.io 配置和 Railway 启动配置。

```bash
# Docker
docker build -t kaobuddy .
docker run -p 8080:8080 kaobuddy
```

Railway 也能部署，但需要用你自己的 Railway 账号和额度。更完整的 Fly.io、Cloudflare Tunnel、Railway 步骤见 [DEPLOY.md](DEPLOY.md)。

---

## 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端框架 | React 19 + TypeScript | 严格模式，全类型覆盖 |
| 构建 | Vite 6 | 输出到 `backend/static/` |
| UI | Motion (framer-motion) + Phosphor Icons | 手势动画 + 图标 |
| PDF | pdfjs-dist（懒加载）+ jspdf + html2canvas | 读取 PDF 文字层，导出 A4 |
| 文档解析 | mammoth + 自研旧 .doc 解析 | DOCX / RTF / .doc |
| 后端框架 | FastAPI + uvicorn | 异步，流式 SSE |
| AI 调用 | httpx + OpenAI-compatible 协议 | 支持所有兼容服务商 |
| 存储 | IndexedDB + localStorage | 浏览器端，零服务端存储 |
| 日志 | 结构化 JSON → stdout | 每行一条，含 request_id + 耗时 + 脱敏 |
| 安全 | CSP 头 + SW 版本控制 + 邀请码验证 | 防 XSS，缓存自动刷新 |
| PWA | Service Worker + Web Manifest | 可添加到主屏幕，离线兜底 |
| 部署 | Docker 多阶段构建 | node:22 构建 → python:3.11 运行 |
| CI/CD | GitHub Actions | push/PR 自动跑全量检查 |

---

## 项目结构

```
.
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI 应用 + 所有路由
│   │   ├── ai_client.py     # AI 调用（chat + stream）
│   │   ├── prompts.py       # System prompt 模板
│   │   ├── schemas.py       # Pydantic 数据模型
│   │   ├── invites.py       # 邀请码系统
│   │   ├── video.py         # B 站视频信息抓取
│   │   └── logging.py       # 结构化 JSON 日志
│   └── static/              # 前端构建产物（Vite 输出）
├── src/
│   ├── App.tsx              # 主应用
│   ├── api.ts               # 前端 API 层
│   ├── storage.ts           # IndexedDB 封装 + 迁移
│   ├── utils.ts             # 工具函数（解析、格式化、计划）
│   ├── fileReaders.ts       # 文件读取（PDF/DOCX/RTF/图片）
│   ├── aiAuth.ts            # AI 认证模式解析
│   ├── inviteState.ts       # 邀请码状态管理
│   ├── generationGuards.ts  # 生成前置守卫
│   ├── pdfExport.ts         # PDF 导出
│   ├── useCardLearning.ts   # 卡片学习 Hook
│   └── components/
│       ├── Common.tsx        # 通用组件（BrandMark / StatusToast / RenderText）
│       └── ErrorBoundary.tsx # 错误边界
├── tests/
│   ├── test_api.py          # 后端测试（21 个）
│   └── frontend/            # 前端测试（36 个）
├── public/                  # PWA 资源（sw.js / manifest / 图标）
├── Dockerfile               # 多阶段 Docker 构建
├── fly.toml                 # Fly.io 配置
├── Procfile                 # Railway 配置
├── pyproject.toml           # Python 项目定义
├── requirements.txt         # Python 依赖
├── vite.config.ts           # Vite 配置
├── .github/workflows/ci.yml # CI/CD
└── index.html               # Vite 入口
```

---

## 测试

```bash
# Python
.venv/bin/pytest -q                      # 21 个测试
python3 -m py_compile backend/app/*.py   # 语法检查

# TypeScript
npx tsc --noEmit                         # 类型检查

# 前端单元测试
node --import tsx --test tests/frontend/*.test.ts # 36 个测试

# 构建检查
npx vite build                           # 确保能正常打包
```

GitHub Actions 在每次 push 和 PR 时自动跑上面全部。CI 文件见 `.github/workflows/ci.yml`。

---

## 配置

### 环境变量（全部可选）

| 变量 | 用途 | 默认值 |
|---|---|---|
| `PORT` | 服务端口 | 8080（Docker）/ 8000（本地） |
| `ALLOWED_ORIGINS` | CORS 跨域来源（逗号分隔） | `localhost:5173`（本地开发） |
| `KAOBUDDY_AI_BASE_URL` | 邀请码模式 AI 地址 | 无 |
| `KAOBUDDY_AI_API_KEY` | 邀请码模式 AI Key | 无 |
| `KAOBUDDY_AI_MODEL` | 邀请码模式模型名 | 无 |
| `KAOBUDDY_AI_INPUT_CNY_PER_MILLION` | 邀请码计费：输入单价 | 无 |
| `KAOBUDDY_AI_OUTPUT_CNY_PER_MILLION` | 邀请码计费：输出单价 | 无 |
| `KAOBUDDY_INVITE_CODES` | 初始化新邀请码数据文件时使用的码列表（逗号分隔） | 无 |
| `KAOBUDDY_INVITE_STORE_PATH` | 邀请码数据文件路径 | `work/invites.json` |
| `KAOBUDDY_INVITE_MAX_INPUT_CHARS` | 邀请码请求上限（字符数） | 80000 |
| `KAOBUDDY_INVITE_MAX_TOKENS` | 邀请码请求上限（token） | 6000 |

同源部署 + 用户自带 Key 模式下，以上全部留空即可。

如果 `KAOBUDDY_INVITE_STORE_PATH` 指向的文件已经存在，系统会继续读取里面原有的邀请码；`KAOBUDDY_INVITE_CODES` 只在第一次初始化新文件时使用，真实邀请码不要写进仓库。

---

## 一些边界

- 不做账号系统、不做云同步、不搞付费。你的资料是你自己的，全在浏览器里。
- API Key 存 localStorage，请求时从浏览器直接发到 AI 服务商。服务端代码开源，你可以自己审查 `backend/app/ai_client.py`——它就是个转发。
- B 站视频只抓公开页面信息和字幕（best-effort），不下载视频、不需要登录。
- 扫描版 PDF 的文字识别效果取决于文字层质量和你接的模型（多模态模型可以直接读图）。
- 旧版 `.doc` 没有可靠的浏览器端解析器。建议用 Word/WPS 另存为 `.docx` 或 PDF，省心很多。
- 这是一个**备考工具**，不是通用笔记软件。不要期望它做思维导图、间隔重复（Anki 那种）或者协同编辑——这些事情有其他更好的工具做。

---

## 许可

MIT
