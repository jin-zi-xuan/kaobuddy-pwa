# v2.0.0 Windows 桌面版发布检查

## 产品形态

- [x] Dioxus Desktop 独立 Windows 窗口。
- [x] 启动不打开浏览器，不监听 localhost。
- [x] 窗口标题、应用图标、默认尺寸和最小尺寸正确。
- [x] NSIS `.exe` 当前用户安装包可生成。
- [x] 安装器使用 WebView2 Bootstrapper，避免把完整运行时塞进安装包。

## 功能

- [x] 可创建考研项目并进入工作台。
- [x] 数据写入 Windows 本地应用数据目录。
- [x] 关闭并重新打开后恢复项目。
- [x] 学习计划、资料库、模拟考试、错题和 AI 设置入口可用。
- [x] B 站 BV/AV 链接可在桌面 APP 内播放。
- [x] 视频可保存为资料并记录课程笔记。
- [x] AI 请求不依赖 KaoBuddy 后端服务。

## 验证

- [x] `cargo fmt --all -- --check`
- [x] `cargo test -p kaobuddy`
- [x] `cargo clippy -p kaobuddy -- -D warnings`
- [x] `cargo test -p kaobuddy --no-default-features --features server`
- [x] `dx bundle --desktop --release --features bundle --package-types nsis`
- [x] Computer Use 实测真实 Windows 窗口和 B 站播放器。

## 发布前限制

- [ ] 配置商业 Windows 代码签名证书；当前安装包会显示未知发布者。
- [ ] 在干净 Windows 10 / 11 设备执行安装、升级、卸载测试。
- [ ] 使用真实 API Key 分别验证计划与模拟卷生成。
