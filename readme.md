# 必应壁纸 · My Bing Wallpaper

[![Desktop build](https://github.com/hanhuang22/mybingwallpaper/actions/workflows/desktop-build.yml/badge.svg?branch=main)](https://github.com/hanhuang22/mybingwallpaper/actions/workflows/desktop-build.yml)
[![Release](https://github.com/hanhuang22/mybingwallpaper/actions/workflows/release.yml/badge.svg)](https://github.com/hanhuang22/mybingwallpaper/actions/workflows/release.yml)

每天从必应壁纸档案中挑选、预览和应用桌面壁纸。应用使用 Tauri 2、React、TypeScript 与 Rust，支持 Windows 和 macOS。

[项目网站](https://hanhuang22.github.io/mybingwallpaper/) · [GitHub 下载](https://github.com/hanhuang22/mybingwallpaper/releases) · [Gitee 国内下载](https://gitee.com/Hyman25/mybingwallpaper/releases)

当前稳定版为 **v1.0.2**。桌面端支持跟随系统外观、历史年月快速选择、每日自动换壁纸，以及在应用内检查并下载签名校验的更新。以下截图来自 macOS 版 v1.0.0；Windows 版功能相同，系统控件外观可能略有差异。

## 界面预览

![主界面](docs/screenshots/main.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/calendar.png" alt="年份网格选择器"></td>
    <td width="50%"><img src="docs/screenshots/settings.png" alt="外观、自动更新与保存位置设置"></td>
  </tr>
  <tr>
    <td align="center">按年份、月份和日期浏览历史壁纸</td>
    <td align="center">外观、保存位置与自动更新设置</td>
  </tr>
</table>

## 功能

- 当日、历史日期和随机壁纸浏览
- 保存原图默认直接写入图片目录，也可在设置中更换文件夹或开启每次询问位置
- Windows 与 macOS 桌面壁纸设置
- 系统托盘/菜单栏常驻，关闭窗口不退出
- 每日自动更新与登录后自动启动
- Windows 锁屏壁纸实验功能
- 壁纸说明按需展开，默认保留简洁预览
- 跟随系统浅色/深色外观，也可在设置中手动覆盖
- 签名校验的软件更新，可自动下载并由用户决定何时重启安装
- 一键打开壁纸缓存目录
- 可缩放现代界面与高 DPI 适配

macOS 没有公开的锁屏壁纸设置接口，因此不会显示可用的锁屏开关。Windows 锁屏功能使用当前用户接口，无需管理员权限。要让设置的图片显示出来，请先在 Windows「设置 → 个性化 → 锁屏界面」中将锁屏背景从「Windows 聚焦」改为「图片」；「Windows 聚焦」会继续显示系统提供的图片。系统策略仍可能阻止修改。锁屏设置失败时不会影响桌面壁纸自动更新。

点击“保存原图”默认直接保存到系统“图片/MyBingWallpaper”文件夹，文件名为壁纸日期（如 `2026-09-24.jpg`）。可以在设置中查看、打开或更改“原图保存位置”；关闭“直接保存到此位置”后，每次保存都会打开系统保存窗口，可自行选择位置和文件名。更改位置不会搬动此前保存的图片。设置中的“壁纸缓存”仅用于自动更新和设为桌面壁纸，与保存原图的文件夹分开。

## 下载

安装包同时发布到 [GitHub Releases](https://github.com/hanhuang22/mybingwallpaper/releases) 和 [Gitee Releases](https://gitee.com/Hyman25/mybingwallpaper/releases)。GitHub 访问不稳定时可使用 Gitee 国内下载入口。请在发布页选择与你的系统和处理器对应的 `.exe` 或 `.dmg`；`.sig`、`.app.tar.gz` 和 `latest.json` 是应用内自动更新所需文件，不是普通安装包。从 v1.0.2 起，仅构建 Windows x64 NSIS `.exe` 和 macOS Apple Silicon `.dmg`，不再构建 MSI、Windows x86/ARM64 或 macOS Intel；历史 Release 不受影响。

若此前使用 MSI 安装，切换到 NSIS `.exe` 时建议先卸载旧版 MSI，再安装新版，以免 Windows 的“已安装的应用”中留下重复记录。

| 文件名格式 | 适用系统 |
| --- | --- |
| `mybingwallpaper-v<版本>-windows-x64-setup.exe` | Windows 10/11，Intel 或 AMD 64 位（推荐安装程序） |
| `mybingwallpaper-v<版本>-macos-apple-silicon.dmg` | Apple Silicon Mac（M1、M2、M3、M4 等） |

Windows 11 ARM 设备可以通过系统模拟运行 x64 安装包。若此前安装了 Windows ARM64 原生版，切换到 x64 版请手动安装；不自动向 ARM64 原生版推送未经验证的跨架构更新。32 位 Windows 和 Intel Mac 无法运行对应的新版本，仍可使用历史版本。

向 `main` 推送代码时，GitHub Actions 会验证上述两种目标能否构建。全部通过后，如果源码版本号一致且对应的 `v*` 标签尚不存在，工作流会自动创建标签、发布 GitHub Release，并将同一批安装包同步到 Gitee Release；已有标签不会重复发布。`updater` 分支只存放签名更新清单，由发布工作流维护，无需手动合并。也可以手动推送 `v*` 标签触发发布。v0.3.6 是支持应用内自动更新的起始版本，旧版本需要先手动安装一次 v0.3.6 或更高版本。更新包会经过独立签名校验，但这不等同于商业代码签名：Windows 仍可能显示 SmartScreen 提示，macOS 安装包也尚未经过 Apple 公证；首次启动如出现开发者验证提示，请在 Finder 中右键应用并选择“打开”，或前往“系统设置 → 隐私与安全性”选择“仍要打开”。

## 技术结构

```text
src/                    React + TypeScript 界面
src-tauri/src/          Rust 应用核心与 Tauri 桌面端
src-tauri/src/platform/ Windows / macOS 系统适配
src-tauri/capabilities/ 前端权限边界
```

网络下载、文件保存和系统调用都在 Rust 层完成；WebView 只负责界面和用户交互。

## 本地开发

需要 Node.js 24、Rust stable，以及对应平台的系统构建工具。安装依赖时使用锁文件，避免本地与 CI 得到不同版本：

```bash
npm ci
npm test
npm run tauri dev
```

仅调试界面时：

```bash
npm run dev
```

## Windows 构建

### 准备环境

1. 安装 Node.js 24。
2. 通过 rustup 安装 stable MSVC 工具链。
3. 安装 Visual Studio Build Tools 的“使用 C++ 的桌面开发”、Windows 10/11 SDK 和 WebView2 Runtime。

安装 Rust 编译目标：

```powershell
rustup target add x86_64-pc-windows-msvc
```

Windows 发布目标为 `x86_64-pc-windows-msvc`。在 Windows ARM64 主机上构建时，也需安装对应的 x64 MSVC 跨架构工具链。

```powershell
npm ci
npm test

npm run tauri build -- --target x86_64-pc-windows-msvc
```

显式指定目标后，产物位于：

```text
src-tauri/target/<target>/release/my-bing-wallpaper.exe
src-tauri/target/<target>/release/bundle/nsis/*-setup.exe
```

`src-tauri/target/` 已被 Git 忽略。可执行文件和安装包只作为 GitHub Release 附件发布，不提交到 Git 历史。未签名的本地构建可能触发 Windows SmartScreen；正式分发建议配置代码签名。

## macOS 构建

```bash
npm run tauri build
```

macOS 会生成 `.app`、带有拖动安装界面的 DMG，以及供应用内更新使用的 `.app.tar.gz` 和签名文件。本项目默认执行完整的 ad-hoc 应用签名，避免下载后的应用包因签名结构不完整而被判断为损坏；若要让安装包无需用户手动放行，仍需 Apple Developer ID 签名与公证。

生成安装包前需在环境变量中提供 Tauri 更新签名私钥与密码；只验证代码能否编译时可使用 `npm run tauri build -- --no-bundle`。更新公钥已经随客户端发布后不要随意更换，否则旧版本将无法验证后续更新。

GitHub Actions 只构建 Windows x64 和 macOS Apple Silicon。推送 `v*` 标签时，发布工作流会同时生成更新包签名和 `latest.json`，发布到 GitHub 后再通过加密的 Gitee API Token 同步到 Gitee，并维护国内可访问的更新清单。发布所需的 `GITEE_API_TOKEN`、`TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 只存在于 GitHub Actions Secrets，不会进入源码或安装包；客户端仅包含用于验证签名的公钥。

## 数据源

- 月度元数据：`https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com/month/YYYYMM.json`
- 2010/01/01—2018/12/30 的历史图片数据来自 [bing.ee123.net](https://bing.ee123.net/)。
- 之后的数据来自必应图片源；有 4K 原图时优先使用 4K 地址。

## 数据维护与 OSS

`.github/workflows/main.yml` 中的定时任务每天检出 `wallpaperarchiv` 分支，运行数据采集脚本，生成月度 JSON 并上传到阿里云 OSS。上传凭据只通过 GitHub Actions Secrets 注入，不进入桌面客户端、源码或安装包。
