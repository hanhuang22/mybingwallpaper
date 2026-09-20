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
4. 构建 ARM64 时额外安装“适用于 ARM64 的 MSVC C++ 生成工具”和 LLVM/Clang。当前依赖中的 `ring` 在 Windows ARM64 目标上需要 `clang.exe`。
5. 构建 MSI 时确保 Windows 可选功能 VBSCRIPT 已启用。

安装 Rust 编译目标：

```powershell
rustup target add x86_64-pc-windows-msvc
rustup target add i686-pc-windows-msvc
rustup target add aarch64-pc-windows-msvc
```

### 选择架构

| 安装包 | Rust 目标 | 适用场景 |
| --- | --- | --- |
| x64 | `x86_64-pc-windows-msvc` | Intel/AMD 64 位 Windows；ARM64 Windows 也可通过系统的 x64 模拟运行 |
| x86 | `i686-pc-windows-msvc` | 仍需兼容的 32 位 Windows |
| ARM64 | `aarch64-pc-windows-msvc` | ARM Windows 原生版本，ARM 设备优先使用 |

当前在 Windows ARM64 主机上已验证三种目标都能完成 EXE、MSI 和 NSIS 打包。x64/x86 构建使用 Windows 的跨架构工具链；这不代表产物是 ARM64，最终架构由 `--target` 决定。

```powershell
npm ci
npm test

# x64
npm run tauri build -- --target x86_64-pc-windows-msvc

# x86（32 位）
npm run tauri build -- --target i686-pc-windows-msvc

# ARM64
npm run tauri build -- --target aarch64-pc-windows-msvc
```

显式指定目标后，产物位于：

```text
src-tauri/target/<target>/release/my-bing-wallpaper.exe
src-tauri/target/<target>/release/bundle/msi/*.msi
src-tauri/target/<target>/release/bundle/nsis/*-setup.exe
```

`src-tauri/target/` 已被 Git 忽略。可执行文件和安装包只作为 GitHub Release 附件发布，不提交到 Git 历史。未签名的本地构建可能触发 Windows SmartScreen；正式分发建议配置代码签名。

## macOS 构建

```bash
npm run tauri build
```

macOS 会生成 `.app` 和 DMG；正式分发前需要 Apple 签名与公证。

GitHub Actions 会构建 Windows x64、x86、ARM64，以及 macOS Intel 和 Apple Silicon。推送 `v*` 标签时，发布工作流会将三个 Windows 架构的 MSI/NSIS 安装包附加到对应 GitHub Release。

## 数据源

- 月度元数据：`https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com/month/YYYYMM.json`
- 2010/01/01—2018/12/30 的历史图片数据来自 [bing.ee123.net](https://bing.ee123.net/)。
- 之后的数据来自必应图片源；有 4K 原图时优先使用 4K 地址。

## 旧版 Qt 功能说明

旧版基于 Qt 6 Widgets，仅支持 Windows，包含托盘、每日更新、锁屏壁纸和注册表开机启动。它使用同步事件循环等待网络请求，并且界面固定为 700×300；这些实现仅作为迁移期间的行为参考，不会进入新版架构。
