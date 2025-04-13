#include "mainwindow.h"

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
    , networkManager(new QNetworkAccessManager(this)) 
{
    ui->setupUi(this);
    setWindowTitle(tr("必应壁纸"));

    ui->label_2->setTextInteractionFlags(Qt::TextSelectableByMouse);

    // 设置日历最大日期为今天，限制不能选择未来日期
    updateCalendarMaximumDate();
    QTextCharFormat weekendFormat;
    weekendFormat.setForeground(QBrush(Qt::black));
    ui->calendarWidget->setWeekdayTextFormat(Qt::Saturday, weekendFormat);
    ui->calendarWidget->setWeekdayTextFormat(Qt::Sunday, weekendFormat);
    
    // Set window icon
    setWindowIcon(getApplicationIcon());

    // 初始化自动更新定时器
    updateTimer = new QTimer(this);
    connect(updateTimer, &QTimer::timeout, this, &MainWindow::autoUpdateWallpaper);

    // 先加载设置
    loadSettings();
    
    // 检查网络连接并加载主界面壁纸
    initNetworkWallpaper();

    // 再创建托盘图标（使用加载的设置）
    createTrayIcon();
}

MainWindow::~MainWindow()
{
    if (updateTimer->isActive()) {
        updateTimer->stop();
    }
    delete ui;
}

void MainWindow::loadSettings()
{
    QSettings settings(configPath, QSettings::IniFormat);
    
    // 检查是否为首次启动
    bool isFirstRun = settings.value("firstRun", true).toBool();
    if (isFirstRun) {
        // 如果是首次启动，显示窗口
        show();
        // 标记为非首次启动
        settings.setValue("firstRun", false);
    }
    
    // 检查开机启动配置与实际状态是否一致
    bool shouldAutoStart = settings.value("autoStart", false).toBool();
    bool currentlyAutoStart = isAutoStartEnabled();
    
    // 如果配置文件设置了不自动启动，但实际上注册表中存在启动项，则清除注册表项
    if (!shouldAutoStart && currentlyAutoStart) {
        setAutoStart(false);
    }
    // 反之，如果配置文件设置了自动启动，但实际上注册表中不存在启动项，则添加注册表项
    else if (shouldAutoStart && !currentlyAutoStart) {
        setAutoStart(true);
    }
    
    // 保存各种设置项，供createTrayIcon使用
    shouldAutoUpdate = settings.value("autoUpdate", false).toBool();
    lockscreenEnabled = settings.value("setLockScreenWallpaper_enabled", false).toBool();
    lastSelectedDate = settings.value("lastSelectedDate", "").toString();
}

void MainWindow::saveSettings(const QString &key, const QVariant &value)
{
    QSettings settings(configPath, QSettings::IniFormat);
    settings.setValue(key, value);
}

void MainWindow::initNetworkWallpaper()
{
    // 创建网络连接检查定时器
    QTimer *networkCheckTimer = new QTimer(this);
    
    // 定义网络检查函数对象
    auto checkNetworkConnection = [this, networkCheckTimer]() {
        // 创建测试网络请求
        QNetworkRequest request(QUrl("https://www.bing.com"));
        QNetworkReply *testReply = networkManager->head(request);
        
        // 创建一个事件循环等待网络请求完成
        QEventLoop loop;
        connect(testReply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
        loop.exec();
        
        bool isConnected = (testReply->error() == QNetworkReply::NoError);
        testReply->deleteLater();
        
        if (isConnected) {
            if (shouldAutoUpdate || lastSelectedDate.isEmpty()) {
                QDate currentDate = QDate::currentDate();
                setSelectedDateWithAutoClick(currentDate.toString("yyyyMMdd"), true);
            } else {
                setSelectedDateWithAutoClick(lastSelectedDate, false);
            }

            networkCheckTimer->stop();
            networkCheckTimer->deleteLater();

            // qDebug() << "Network connection established";
        } else {
            // 网络连接失败，继续等待
            ui->label_2->setText(tr("等待网络连接..."));
            // qDebug() << "Waiting for network connection...";
        }
        
        return isConnected;
    };
    
    // 连接槽函数，每次定时器触发时检查网络
    connect(networkCheckTimer, &QTimer::timeout, this, checkNetworkConnection);
    
    // 启动定时器，每5秒检查一次网络连接
    networkCheckTimer->start(5000);
    
    // 立即进行一次检查
    QTimer::singleShot(0, this, checkNetworkConnection);
}

void MainWindow::createTrayIcon()
{
    // Create exit action
    exitAction = new QAction(tr("退出"), this);
    connect(exitAction, &QAction::triggered, this, &MainWindow::exitApplication);

    // Create daily update action
    dailyUpdateAction = new QAction(tr("每日更新"), this);
    dailyUpdateAction->setCheckable(true);
    dailyUpdateAction->setChecked(shouldAutoUpdate);
    connect(dailyUpdateAction, &QAction::triggered, this, [this]() {
        shouldAutoUpdate = dailyUpdateAction->isChecked();
        if (shouldAutoUpdate) {
            resetUpdateTimer();
            QDate currentDate = QDate::currentDate();
            if (lastSelectedDate.isEmpty() || lastSelectedDate != currentDate.toString("yyyyMMdd")) {
                setSelectedDateWithAutoClick(currentDate.toString("yyyyMMdd"), true);
            }
        } else {
            updateTimer->stop();
        }
        saveSettings("autoUpdate", shouldAutoUpdate);
    });
    if (shouldAutoUpdate) {
        resetUpdateTimer();
    }

    // Create lockscreen action
    lockscreenAction = new QAction(tr("锁屏壁纸"), this);
    lockscreenAction->setCheckable(true);
    lockscreenAction->setChecked(lockscreenEnabled);
    connect(lockscreenAction, &QAction::triggered, this, [this]() {
        lockscreenEnabled = lockscreenAction->isChecked();
        
        if (!lockscreenEnabled) {
            bool clearResult = clearLockScreenWallpaper();
            if (!clearResult) {
                QMessageBox::warning(this, tr("警告"), tr("清除锁屏壁纸失败，可能需要管理员权限。"));
            }
        } else if (!currentImgPath.isEmpty()) {
            bool setResult = setLockScreenWallpaper(currentImgPath);
            if (!setResult) {
                QMessageBox::warning(this, tr("警告"), tr("设置锁屏壁纸失败，可能需要管理员权限。"));
                lockscreenAction->setChecked(false);
                lockscreenEnabled = false;
            }
        }
        
        saveSettings("setLockScreenWallpaper_enabled", lockscreenEnabled);
    });

    // Create auto start action
    autoStartAction = new QAction(tr("开机自启"), this);
    autoStartAction->setCheckable(true);
    connect(autoStartAction, &QAction::triggered, this, [this]() {
        bool checked = autoStartAction->isChecked();
        setAutoStart(checked);
        saveSettings("autoStart", checked);
    });
    autoStartAction->setChecked(isAutoStartEnabled());

    // Create tray icon menu
    trayIconMenu = new QMenu(this);
    trayIconMenu->addAction(dailyUpdateAction);
    trayIconMenu->addAction(lockscreenAction);
    trayIconMenu->addAction(autoStartAction);
    trayIconMenu->addSeparator();
    trayIconMenu->addAction(exitAction);

    // Setup system tray icon
    trayIcon = new QSystemTrayIcon(this);
    trayIcon->setContextMenu(trayIconMenu);

    // Set tray icon using the application icon
    trayIcon->setIcon(getApplicationIcon());
    trayIcon->setToolTip(tr("MyBingWallpaper"));
    trayIcon->show();

    // Connect tray icon signals
    connect(trayIcon, &QSystemTrayIcon::activated, this, &MainWindow::trayIconActivated);
}

void MainWindow::autoUpdateWallpaper()
{
    // 更新日历最大日期
    updateCalendarMaximumDate();
    
    // 获取当前日期
    QDate currentDate = QDate::currentDate();
    QString currentDateStr = currentDate.toString("yyyyMMdd");
    
    // 如果当前日期与上次选择的日期不一致，则设置日历控件的日期为当前日期
    if (lastSelectedDate != currentDateStr) {
        setSelectedDateWithAutoClick(currentDateStr, true);
    }
}

void MainWindow::on_calendarWidget_selectionChanged()
{   
    QDate selectedDate = ui->calendarWidget->selectedDate();
    QString dateStr = selectedDate.toString("yyyyMMdd");
    ui->label_2->setText(dateStr);
    setSelectedDateWithAutoClick(dateStr, false);
}

void MainWindow::setSelectedDateWithAutoClick(const QString &date, bool autoClick)
{
    if (ui->calendarWidget->selectedDate().toString("yyyyMMdd") != date) {
        ui->calendarWidget->setSelectedDate(QDate::fromString(date, "yyyyMMdd"));
    }
    bool success = setNetworkPic_json(date);
    if (success && autoClick) {
        on_pushButton_clicked();
    }
}

bool MainWindow::setNetworkPic_json(const QString &date)
{
    // Disable UI components
    disableUI();
    // 从日期字符串提取年月信息，用于构建月度文件路径
    QString yearMonth = date.left(6); // 从yyyyMMdd格式的日期中获取yyyyMM部分
    
    // 读取月度JSON文件URL
    QString jsonurl = "https://my-bing-wallpaper.oss-cn-beijing.aliyuncs.com/month/"+yearMonth+".json";
    QUrl url(jsonurl);
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    
    QEventLoop loop;
    QTimer timer;
    
    // 设置超时时间为3秒
    timer.setSingleShot(true);
    timer.start(3000);
    
    QNetworkReply *reply = networkManager->get(request);
    
    // 连接超时信号和完成信号
    connect(&timer, &QTimer::timeout, [&loop, reply]() {
        reply->abort();
        loop.quit();
    });
    
    // Connect to exit the event loop when finished
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    
    // Start the event loop
    loop.exec();
    
    // 判断是否超时
    bool isTimeout = !timer.isActive();
    if (!isTimeout) {
        // 未超时，停止计时器
        timer.stop();
    }
    
    bool success = false;
    
    if (isTimeout) {
        ui->label_2->setText(tr("获取壁纸信息超时"));
        ui->label_2->adjustSize();
        resetNetworkManager(); // 重置网络管理器
    } else if (reply->error() != QNetworkReply::NoError) {
        ui->label_2->setText(tr("网络请求失败: ") + reply->errorString());
        ui->label_2->adjustSize();
        resetNetworkManager(); // 重置网络管理器
    } else {
        QByteArray jsonData = reply->readAll();
        QJsonDocument jsonDoc = QJsonDocument::fromJson(jsonData);
        
        if (!jsonDoc.isNull()) {
            if (jsonDoc.isObject()) {
                // 处理月度JSON文件，这是一个包含多个日期的对象
                QJsonObject monthObj = jsonDoc.object();
                
                // 查找特定日期的数据
                if (monthObj.contains(date)) {
                    // 获取特定日期的数据
                    QJsonObject dayObj = monthObj[date].toObject();
                    
                    QString imgtitle = dayObj["imgtitle"].toString();
                    currentImgUrl = dayObj["imgurl"].toString();
                    
                    if (!imgtitle.isEmpty() && !currentImgUrl.isEmpty()) {
                        ui->label_2->setText(imgtitle);
                        ui->label_2->adjustSize();
                        setNetworkPic(currentImgUrl);
                        success = true;
                    } else {
                        ui->label_2->setText(tr("获取图片信息失败"));
                    }
                } else {
                    ui->label_2->setText(tr("未找到该日期壁纸数据"));
                }
            } else {
                ui->label_2->setText(tr("JSON格式不支持"));
            }
        } else {
            ui->label_2->setText(tr("JSON数据解析失败"));
        }
    }

    // 确保彻底释放网络资源
    reply->disconnect();
    reply->deleteLater();
    
    // Re-enable UI components
    enableUI();
    return success;
}

void MainWindow::setNetworkPic(const QString &imgurl)
{
    QUrl url;
    if (imgurl.contains("bing.com")) {
        url = QUrl(imgurl+"&w=480");
    } else {
        url = QUrl(imgurl);
    }
    QEventLoop loop;
    QTimer timer;
    
    // 设置超时时间为5秒
    timer.setSingleShot(true);
    timer.start(5000);

    QNetworkRequest request(url);
    QNetworkReply *reply = networkManager->get(request);
    
    // 连接超时信号和完成信号
    connect(&timer, &QTimer::timeout, [&loop, reply]() {
        reply->abort();
        loop.quit();
    });
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    
    // 开启事件循环
    loop.exec();
    
    // 判断是否超时
    bool isTimeout = !timer.isActive();
    if (!isTimeout) {
        // 未超时，停止计时器
        timer.stop();
    }

    // 在超时情况下处理
    if (isTimeout || reply->error() != QNetworkReply::NoError) {
        QString errorMsg = isTimeout ? 
            tr("预览图片下载超时") : 
            tr("预览图片下载失败: ") + reply->errorString();
        
        ui->label_2->setText(errorMsg);
        ui->label_2->adjustSize();
        
        // 确保彻底释放网络资源
        reply->disconnect();
        reply->deleteLater();
        
        // 重置网络管理器
        resetNetworkManager();
        return;
    }

    QByteArray jpegData = reply->readAll();
    QPixmap pixmap;
    pixmap.loadFromData(jpegData);
    QPixmap dest=pixmap.scaled(ui->label->size(),Qt::KeepAspectRatio,Qt::SmoothTransformation);
    ui->label->setPixmap(dest);
    
    // 确保彻底释放网络资源
    reply->disconnect();
    reply->deleteLater();
}

void MainWindow::on_pushButton_clicked()
{
    disableUI();
    downloadAndSetWallpaper();
    enableUI();
}

void MainWindow::on_pushButton_2_clicked()
{
    disableUI();
    downloadAndSaveWallpaper();
    enableUI();
}

void MainWindow::on_pushButton_3_clicked()
{
    randomUpdateWallpaper();
}

void MainWindow::downloadAndSetWallpaper()
{
    if (!downloadImage()) {
        return;
    }

    // 设置为壁纸
    bool desktopResult = setWindowsWallpaper(currentImgPath);
    
    // If lock screen wallpaper is enabled, set it directly too
    if (lockscreenEnabled && desktopResult) {
        setLockScreenWallpaper(currentImgPath);
    }
    
    // Save the currently selected date
    lastSelectedDate = ui->calendarWidget->selectedDate().toString("yyyyMMdd");
    saveSettings("lastSelectedDate", lastSelectedDate);
}

void MainWindow::downloadAndSaveWallpaper()
{
    if (!downloadImage()) {
        return;
    }

    // Get current date for filename
    QString dateStr = ui->calendarWidget->selectedDate().toString("yyyy-MM-dd");

    // Get user's Pictures directory path
    QString savePath = QDir::home().filePath("Pictures/MyBingWallpaper");
    QDir dir(savePath);

    // Create directory if it doesn't exist
    if (!dir.exists()) {
        dir.mkpath(".");
    }

    // 最终文件名
    QString finalFilePath = dir.filePath(QString("%1.jpg").arg(dateStr));
    
    // Copy the temporary file to the Pictures directory
    QFile::copy(currentImgPath, finalFilePath);

    QMessageBox msgBox;
    msgBox.setWindowTitle(tr("成功"));
    msgBox.setText(tr("图片已保存至:\n%1").arg(finalFilePath));
    msgBox.setTextInteractionFlags(Qt::TextSelectableByMouse);
    msgBox.setIcon(QMessageBox::Information);
    msgBox.exec();
}

void MainWindow::randomUpdateWallpaper()
{
    // 生成随机日期, 不早于2010-01-01
    QDate startDate = QDate(2010, 1, 1);
    QDate endDate = QDate::currentDate();
    QDate randomDate = startDate.addDays(QRandomGenerator::global()->bounded(startDate.daysTo(endDate)));
    
    // 设置日历控件的日期
    setSelectedDateWithAutoClick(randomDate.toString("yyyyMMdd"), true);

    // Save the currently selected date
    lastSelectedDate = ui->calendarWidget->selectedDate().toString("yyyyMMdd");
    saveSettings("lastSelectedDate", lastSelectedDate);
}

bool MainWindow::downloadImage()
{
    updateTimer->stop();
    
    QUrl url(currentImgUrl);
    QEventLoop loop;
    QTimer timer;
    
    // 设置超时时间
    timer.setSingleShot(true);
    timer.start(8000);

    QNetworkRequest request(url);
    QNetworkReply *reply = networkManager->get(request);
    
    // 连接超时信号和完成信号
    connect(&timer, &QTimer::timeout, [&loop, reply]() {
        reply->abort();
        loop.quit();
    });
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    
    // 开启事件循环
    loop.exec();
    
    // 判断是否超时
    bool isTimeout = !timer.isActive();
    if (!isTimeout) {
        // 未超时，停止计时器
        timer.stop();
    }

    // 在超时或错误情况下处理
    if (isTimeout || reply->error() != QNetworkReply::NoError) {
        QString errorMsg = isTimeout ? 
            tr("下载壁纸超时: ") + url.toString() : 
            tr("下载壁纸失败: ") + reply->errorString();
        
        ui->label_2->setText(errorMsg);
        ui->label_2->adjustSize();
        
        // 确保彻底释放网络资源
        reply->disconnect();
        reply->deleteLater();
        
        // 重置网络管理器
        resetNetworkManager();
        resetUpdateTimer();
        return false;
    }

    QByteArray jpegData = reply->readAll();
    QString finalPath = QDir::tempPath() + "/mybingwallpaper.jpg";
    QFile file(finalPath);
    if (file.open(QIODevice::WriteOnly)) {
        file.write(jpegData);
        file.close();
        currentImgPath = finalPath;
    } else {
        ui->label_2->setText(tr("无法保存壁纸到临时文件!"));
        // 确保彻底释放网络资源
        reply->disconnect();
        reply->deleteLater();
        resetNetworkManager();
        resetUpdateTimer();
        return false;
    }

    // 确保彻底释放网络资源
    reply->disconnect();
    reply->deleteLater();

    resetUpdateTimer();
    return true;
}

void MainWindow::resetNetworkManager()
{
    if (networkManager) {
        networkManager->deleteLater();
    }
    
    networkManager = new QNetworkAccessManager(this);
}
