# 必应壁纸 · My Bing Wallpaper

每天从必应壁纸档案中挑选、预览和应用桌面壁纸。新版使用 Tauri 2、React、TypeScript 与 Rust，支持 Windows 和 macOS。

> 当前现代化版本位于 `codex/tauri-migration` 分支。原 Qt 6 源码暂时保留在仓库根目录，用于功能对照和回退；完成双平台验证后再替换主分支。

## 新版功能

- 当日、历史日期和随机壁纸浏览
- 原始分辨率图片下载与本地缓存
- Windows 与 macOS 桌面壁纸设置
- 系统托盘/菜单栏常驻，关闭窗口不退出
- 每日自动更新与登录后自动启动
- Windows 锁屏壁纸实验功能
- 可缩放现代界面与高 DPI 适配

macOS 没有公开的锁屏壁纸设置接口，因此不会显示可用的锁屏开关。Windows 锁屏功能受系统版本、策略和权限影响，失败时不会影响桌面壁纸设置。

## 技术结构

```text
src/                    React + TypeScript 界面
src-tauri/src/          Rust 应用核心与 Tauri 桌面端
src-tauri/src/platform/ Windows / macOS 系统适配
src-tauri/capabilities/ 前端权限边界
```

网络下载、文件保存和系统调用都在 Rust 层完成；WebView 只负责界面和用户交互。

## 本地开发

需要 Node.js 24、Rust stable，以及对应平台的系统构建工具。

```bash
npm install
npm test
npm run tauri dev
```

仅调试界面时：

```bash
npm run dev
```

## 构建

```bash
npm run tauri build
```

- macOS 生成 `.app` 和 DMG（正式分发前需要 Apple 签名与公证）。
- Windows 生成 NSIS/MSI 安装包（正式分发建议配置代码签名）。
- GitHub Actions 会在 Windows、macOS Intel 和 macOS Apple Silicon 环境执行测试及构建。

## 数据源

- 月度元数据：`https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com/month/YYYYMM.json`
- 2010/01/01—2018/12/30 的历史图片数据来自 [bing.ee123.net](https://bing.ee123.net/)。
- 之后的数据来自必应图片源；有 4K 原图时优先使用 4K 地址。

## 旧版 Qt 功能说明

旧版基于 Qt 6 Widgets，仅支持 Windows，包含托盘、每日更新、锁屏壁纸和注册表开机启动。它使用同步事件循环等待网络请求，并且界面固定为 700×300；这些实现仅作为迁移期间的行为参考，不会进入新版架构。
