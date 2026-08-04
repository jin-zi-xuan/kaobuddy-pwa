# Rust + Dioxus 迁移说明

## 迁移目标

这次迁移把 KaoBuddy 从临时备考工具调整为长期陪伴型的考研搭子，同时保持已有的学习闭环：资料进入、拆计划、按模块学习、练习、模拟考试、错题复习和临考速背。

## 技术映射

| 旧实现 | 当前实现 |
|---|---|
| React 19 + Vite | Dioxus 0.7 Web |
| FastAPI + uvicorn | Dioxus Fullstack + Axum |
| Pydantic | Serde 数据模型 |
| httpx | reqwest |
| IndexedDB / localStorage | Dioxus 状态 + localStorage |
| Python 视频页面解析 | reqwest + scraper + Rust 链接解析 |
| FastAPI 静态托管 | Dioxus asset pipeline |

## API 兼容

Rust 服务端保留以下路径：

- `GET /health`
- `POST /api/invite/verify`
- `POST /api/ai/test`
- `POST /api/ai/chat`
- `POST /api/ai/plan`
- `POST /api/ai/daily-plan`
- `POST /api/ai/memorize`
- `POST /api/ai/teach`
- `POST /api/ai/cards`
- `POST /api/ai/cards/stream`
- `POST /api/ai/practice`
- `POST /api/ai/module-practice`
- `POST /api/ai/grade-practice`
- `POST /api/ai/mock-exam`
- `POST /api/ai/grade-mock`
- `POST /api/ocr/handwriting`
- `POST /api/video/import`

请求继续接受 `api_config` / `apiConfig` 和 `inviteCode`。AI 服务仍使用 OpenAI-compatible `chat/completions` 协议。

## 视觉重绘

设计方向从玻璃拟态和卡片堆叠调整为日常高频工作台：

- 深墨绿作为品牌和导航基底
- 柔和灰白承载长时间阅读
- 珊瑚橙只用于当前重点、错误和关键反馈
- 面板统一 8-16px 圆角，不使用大面积透明玻璃
- 动效只用于页面进入、按钮反馈和状态变化
- 支持系统明暗模式与 `prefers-reduced-motion`
- 移动端把侧栏折叠为可横向滚动的顶部导航

## B 站视频

前端从 BV/AV 链接生成官方播放器地址，服务端解析公开视频标题和描述。播放器通过 CSP 明确允许 `https://player.bilibili.com`，其他第三方 frame 默认禁止。

## 遗留代码

`backend/` 与根目录 `src/` 暂时保留，作用是：

1. 对照旧业务提示词和边界行为。
2. 运行迁移期回归测试。
3. 为旧数据导入提供类型参考。

等 Rust 版本完成真实用户数据迁移验证后，再单独开 issue 删除遗留实现。
