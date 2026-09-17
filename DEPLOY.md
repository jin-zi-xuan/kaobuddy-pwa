# KaoBuddy 云端预览版部署指南

## ⚠️ 重要说明

**当前部署目标：preview / staging（预览版），不是正式公开版。**

- ❌ 不做账号系统
- ❌ 不做数据库
- ❌ 不做云同步
- ❌ 不做付费系统
- ✅ 保留 BYOK：用户自己填写 AI API Key
- ✅ API Key 不落盘

---

## 方案一：Fly.io（推荐）

**费用**：新用户 $10/月免费额度，3 台 256MB VM + 3GB 存储。不超出免费额度不扣费。

### 前置条件

- 项目代码已推到 GitHub
- 注册 Fly.io 账号：https://fly.io

### 第一步：安装 flyctl

macOS：
```bash
brew install flyctl
```

Windows：
```bash
powershell -c "iwr https://fly.io/install.ps1 -useb | iex"
```

### 第二步：登录

```bash
fly auth login
```

浏览器会打开 Fly.io 页面，用 GitHub 登录并授权。

### 第三步：启动部署

```bash
cd /Users/Zhuanz/Documents/kaoBuddy
fly launch
```

flyctl 会检测到已有的 `fly.toml`，问你是否使用现有配置：
- 回答 `y`（使用现有配置）
- 是否部署？回答 `y`

### 第四步：等待部署

```bash
fly deploy
```

如果 `fly launch` 已经触发了部署，等待即可。部署完成后会显示：
```
Visit your app at: https://kaobuddy-preview.fly.dev
```

### 第五步：排查

```bash
fly logs        # 查看日志
fly status      # 查看状态
```

### 如果不想安装 CLI

直接将 GitHub 仓库导入 Fly.io：
1. 打开 https://fly.io/dashboard
2. 点击 **Import an Existing App**
3. 连接 GitHub，选择 `jin-zi-xuan/kaobuddy-pwa`
4. 分支选择 `chore/cloud-preview-deploy`
5. Fly.io 自动检测 Dockerfile 并部署

---

## 方案二：Cloudflare Tunnel（零成本即刻预览）

不需要注册任何云平台，不需要绑卡。从本机直接暴露一个公网临时 URL。

### 第一步：安装 cloudflared

macOS：
```bash
brew install cloudflare/cloudflare/cloudflared
```

Windows：从 https://github.com/cloudflare/cloudflared/releases 下载。

### 第二步：本地启动 KaoBuddy

```bash
cd /Users/Zhuanz/Documents/kaoBuddy
source .venv/bin/activate
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

### 第三步：暴露公网

另开一个终端：
```bash
cloudflared tunnel --url http://127.0.0.1:8000
```

会显示：
```
Your quick tunnel has been created!
https://xxx-xxx-xxx.trycloudflare.com
```

把 `https://xxx-xxx-xxx.trycloudflare.com` 发给别人就能打开。

**代价**：你的电脑必须保持开机，KaoBuddy 才能被访问。

---

## 方案三：Railway（备选，$5 免费额度，需绑卡）

见 `.railway.json`，Build Command:
```
pip install -r requirements.txt
```
Start Command:
```
uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
```

---

## 部署后测试清单

- [ ] 首页能打开
- [ ] 手机能打开
- [ ] 刷新不白屏
- [ ] `/health` 返回 `{"ok":true}`
- [ ] `/manifest.webmanifest` 能访问
- [ ] `/sw.js` 能访问
- [ ] `/assets/` 文件不 404
- [ ] Network 无 `localhost` / `127.0.0.1`
- [ ] Console 无严重红色错误
- [ ] 能创建考试项目
- [ ] 能填写 AI API Key
- [ ] 能上传 TXT/PDF/DOCX
- [ ] 能生成计划
- [ ] 能生成模拟考
- [ ] 日志无 `sk-`

---

## 环境变量参考（全部可选）

| 变量 | 用途 |
|------|------|
| `ALLOWED_ORIGINS` | CORS 跨域来源（逗号分隔），同源部署无需设置 |
| `KAOBUDDY_AI_BASE_URL` | 邀请码模式 AI 地址 |
| `KAOBUDDY_AI_API_KEY` | 邀请码模式 AI Key |
| `KAOBUDDY_AI_MODEL` | 邀请码模式模型名 |

**同源部署 + 用户自带 Key 模式下，以上全部留空即可。**

---

## 常见报错

| 报错 | 原因 | 处理 |
|------|------|------|
| 首页 404 | 静态文件未构建 | 本地 `npm run build`，确认 `backend/static/` 有内容 |
| assets 404 | hash 文件名不匹配 | 同上，确保 build 产物和 index.html 一致 |
| 刷新白屏 | SPA fallback 缺失 | 检查 `main.py` 最后的 catch-all 路由 |
| `backend` 导入失败 | 包路径问题 | Docker 内检查 `/app/backend/__init__.py` 存在 |


## 请求安全与本地模型

默认只允许后端访问公网 HTTP/HTTPS 地址。AI、视频及字幕请求都会校验 DNS 结果，固定连接到已验证的 IP，重定向也要重新校验。环境代理不参与这些请求。

自己在本机运行 Ollama 等服务时，可以显式设置 `KAOBUDDY_ALLOW_PRIVATE_AI=1`。它只放行 AI 的本机/私网地址，视频和字幕仍限制在公网。不要在公开部署中开启这个选项，否则访问者可能借 AI 接口访问部署机器所在的内网。

BYOK 的 Key 和用于生成的资料会经过 KaoBuddy 后端，再转发给模型服务商，并非浏览器直连。请使用可信的部署环境。
