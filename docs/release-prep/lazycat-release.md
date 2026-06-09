# Lazycat Release Prep

## 本地验证

```bash
.venv/bin/pytest -q
python3 -m py_compile backend/app/*.py
make lint
```

## 构建 LPK

`lzc-build.yml` 使用 `images.app-runtime` 从项目根目录的 `Dockerfile` 构建内嵌运行镜像：

```bash
make build
```

产物默认输出到：

```text
release-lpk/cloud.lazycat.app.kaobuddy-v1.0.0.lpk
```

## 安装到懒猫微服

```bash
make install
```

等价于：

```bash
lzc-cli app install release-lpk/cloud.lazycat.app.kaobuddy-v1.0.0.lpk --apk n
```

## 镜像冒烟测试

如需先验证 Docker 镜像：

```bash
make smoke-image
```

该目标会构建 `linux/amd64` 镜像，启动容器，并请求 `http://127.0.0.1:8080/health`。

## 限制与风险

- 构建需要可用的 Lazycat image builder。本次验证使用 `lzc-cli` remote builder；如果切到本地 builder，则需要启动 Docker daemon。
- Android、iOS、tvOS 客户端未在懒猫环境中验证，因此 `package.yml` 声明为不支持。
- 邀请码模式需要管理员另外配置 `KAOBUDDY_AI_BASE_URL`, `KAOBUDDY_AI_MODEL`, `KAOBUDDY_AI_API_KEY`, `KAOBUDDY_AI_INPUT_CNY_PER_MILLION`, `KAOBUDDY_AI_OUTPUT_CNY_PER_MILLION`, `KAOBUDDY_INVITE_CODES`。
- 正式上架前需要用浏览器在懒猫微服域名下验证文件选择器、本地上传、懒猫文件选择和 PDF 导出。
