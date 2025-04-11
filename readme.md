## <img src="mybingwallpaper.ico" width="32"> 必应壁纸 - My Bing Wallpaer

### 🏠软件界面

![主界面](img/main.png)

### 🔦使用

- 双击启动/开机启动时启动到托盘，点击托盘图标显示主界面；点击关闭，最小化到托盘

- 设为壁纸：设置桌面壁纸

- 保存图片：保存至用户图片文件夹

- 随机一张：手动随机一张壁纸；若设置了自动更新，会在一段时间后更新时被更新为今日壁纸

- 右击托盘图标，显示菜单选项

- ![托盘](img/trayicon.png)

- 每日更新：每15分钟尝试更新一次最新壁纸

- 锁屏壁纸：立即通过修改注册表更改锁屏壁纸：HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\PersonalizationCSP；取消勾选后立即清除注册表内容

- 开机自启：将程序添加到注册表：HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Run


### 🛠️实现方式

- 利用github action (workflow)，每日定时（16:10 UTC+0，即北京时间0:10）通过bing官方api获取图像标题和url并以json文件储存更新到github仓库，数据按月储存；但由于github Action的定时任务并不准时，会延迟几分钟；使用github page部署作为api访问；点击日历时获取该日期的github上的json文件，并解析得到图像标题和url，然后本地显示；

- 国内访问github可能有问题，因此将github仓库同步到gitee，然后从gitee仓库直接用raw文件获取json文件

- QT6.9 实现界面

### ⁉️问题

- 若出现长时间加载，可能为网络问题，可最小化等待，或尝试重启应用

- 若锁屏修改失败，以管理员权限启动一次应用并修改

- [x] 待解决：Gitee的🐶💨内容审查制度，导致部分月份json文件被认为有问题，无法获取 -> 用阿里云oss存储

### 🖼️数据源

- 2010/01/01-2018/12/30的图像数据将加载自[https://bing.ee123.net/](https://bing.ee123.net/)，感谢❤️；后续日期从bing官方源加载

- 2019/05/09及之前为1080P，之后如有4k源图像则加载4K图像
