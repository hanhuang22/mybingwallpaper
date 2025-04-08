### QT实现简易必应壁纸

可选起始日期：2010/01/01

![example](img/example.png)

#### Usage:

点击关闭，最小化到托盘

右击托盘图标，点击退出

设为壁纸：桌面壁纸；通过修改注册表更改锁屏壁纸：HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\PersonalizationCSP

保存图片：保存至用户图片文件夹

开机启动：将程序添加到注册表：HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Run

自动更新：配合自动抓取，使用 Github Action (Workflow)，每日通过bing官方api定时抓取

#### 感谢：

部分图像数据加载自：https://bing.ee123.net/
