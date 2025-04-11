#include "mainwindow.h"
#include "ui_mainwindow.h"
#include <QPixmap>
#include <QFileInfo>
#include <QMessageBox>
#include <Windows.h>
#include <QtNetwork/QNetworkAccessManager>
#include <QtNetwork/QNetworkReply>
#include <QObject>
#include <QDir>
#include <QJsonDocument>
#include <QJsonObject>
#include <QApplication>
#include <QIcon>
#include <QStyle>
#include <QSettings>
#include <QTimer>
#include <QProgressDialog>
#include <QTextCharFormat>
#include <QDebug>
#include <QFile>
#include <QMoveEvent>
#include <QDateTime>
#include <QJsonArray>
#include <QRandomGenerator>

// Helper function to get application icon
QIcon getApplicationIcon()
{
    QIcon appIcon;

    // Add our icon from resources
    QString iconPath = ":/mybingwallpaper.ico";
    if (QFile::exists(iconPath)) {
        appIcon.addFile(iconPath);

        // Load the icon once to get its pixmap
        QPixmap originalPixmap(iconPath);

        // Add various sizes for different contexts
        if (!originalPixmap.isNull()) {
            for (int size : {16, 24, 32, 48, 64, 128}) {
                QPixmap scaledPixmap = originalPixmap.scaled(
                    QSize(size, size),
                    Qt::KeepAspectRatio,
                    Qt::SmoothTransformation);
                appIcon.addPixmap(scaledPixmap);
            }
        }
    }

    // Fall back to a system icon if our icon is not found
    if (appIcon.isNull()) {
        appIcon = QApplication::style()->standardIcon(QStyle::SP_ComputerIcon);
    }

    return appIcon;
}

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
    , networkManager(new QNetworkAccessManager(this))
    , loadingDialog(nullptr)
    , needAutoClickAfterSelection(false)
{
    ui->setupUi(this);
    setWindowTitle(tr("必应壁纸"));

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
    
    // 再创建托盘图标（使用加载的设置）
    createTrayIcon();

    // 检查网络连接并加载壁纸
    initNetworkWallpaper();

    // 启动时不显示主窗口
    // show();
}

MainWindow::~MainWindow()
{
    if (updateTimer->isActive()) {
        updateTimer->stop();
    }
    delete ui;
}

void MainWindow::resetUpdateTimer()
{
    if (dailyUpdateAction->isChecked()) {
        updateTimer->start(15*60*1000);
    }
}

void MainWindow::createTrayIcon()
{
    // Create exit action
    exitAction = new QAction(tr("退出"), this);
    connect(exitAction, &QAction::triggered, this, &MainWindow::exitApplication);

    dailyUpdateAction = new QAction(tr("每日更新"), this);
    dailyUpdateAction->setCheckable(true);
    dailyUpdateAction->setChecked(shouldAutoUpdate);
    connect(dailyUpdateAction, &QAction::triggered, this, [this]() {
        bool checked = dailyUpdateAction->isChecked();
        shouldAutoUpdate = checked;
        
        if (checked) {
            resetUpdateTimer();
            
            // 如果是当天首次启用，立即尝试更新
            QSettings settings(QApplication::applicationDirPath() + "/mybing.conf", QSettings::IniFormat);
            QString lastUpdateDate = settings.value("lastUpdateDate", "").toString();
            QDate currentDate = QDate::currentDate();
            
            if (lastUpdateDate.isEmpty() || lastUpdateDate != currentDate.toString("yyyyMMdd") || 
                lastSelectedDate != currentDate.toString("yyyyMMdd") || ui->calendarWidget->selectedDate() != currentDate) {
                // 延迟1秒后执行更新，避免界面卡顿
                QTimer::singleShot(1000, this, &MainWindow::autoUpdateWallpaper);
            }
        } else {
            updateTimer->stop();
        }
        saveSettings("autoUpdate", checked);
    });

    lockscreenAction = new QAction(tr("锁屏壁纸"), this);
    lockscreenAction->setCheckable(true);
    lockscreenAction->setChecked(lockscreenEnabled);
    connect(lockscreenAction, &QAction::triggered, this, [this]() {
        bool checked = lockscreenAction->isChecked();
        lockscreenEnabled = checked;
        
        if (!checked) {
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
        
        saveSettings("setLockScreenWallpaper_enabled", checked);
    });

    autoStartAction = new QAction(tr("开机自启"), this);
    autoStartAction->setCheckable(true);
    // 检查主程序是否已经更新了auto start状态，如果已更新，我们应使用当前实际状态
    autoStartAction->setChecked(isAutoStartEnabled());
    connect(autoStartAction, &QAction::triggered, this, [this]() {
        bool checked = autoStartAction->isChecked();
        setAutoStart(checked);
        saveSettings("autoStart", checked);
    });

    // Create tray icon menu
    trayIconMenu = new QMenu(this);
    trayIconMenu->addAction(dailyUpdateAction);
    trayIconMenu->addAction(lockscreenAction);
    trayIconMenu->addAction(autoStartAction);
    trayIconMenu->addSeparator();
    // Add exit action to the menu
    trayIconMenu->addAction(exitAction);

    // Setup system tray icon
    trayIcon = new QSystemTrayIcon(this);
    trayIcon->setContextMenu(trayIconMenu);

    // Set tray icon using the application icon
    trayIcon->setIcon(getApplicationIcon());
    trayIcon->setToolTip(tr("必应壁纸设置器"));
    trayIcon->show();

    // Connect tray icon signals
    connect(trayIcon, &QSystemTrayIcon::activated, this, &MainWindow::trayIconActivated);
    
    // 如果自动更新被启用，启动定时器
    if (shouldAutoUpdate) {
        resetUpdateTimer();
    }
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    // 最小化到托盘而不是关闭
    hide();
    event->ignore();
}

void MainWindow::moveEvent(QMoveEvent *event)
{
    QMainWindow::moveEvent(event);
    
    // If the loading dialog is visible, update its position
    if (loadingDialog && loadingDialog->isVisible()) {
        updateLoadingDialogPosition();
    }
}

void MainWindow::updateLoadingDialogPosition()
{
    if (loadingDialog) {
        // Calculate the center position relative to the main window
        QRect geometry = this->geometry();
        int x = geometry.x() + (geometry.width() - loadingDialog->width()) / 2;
        int y = geometry.y() + (geometry.height() - loadingDialog->height()) / 2;
        loadingDialog->move(x, y);
    }
}

void MainWindow::trayIconActivated(QSystemTrayIcon::ActivationReason reason)
{
    switch (reason) {
    case QSystemTrayIcon::Trigger:
        // 单击托盘图标时显示
        show();
        break;
    default:
        break;
    }
}

void MainWindow::exitApplication()
{
    trayIcon->hide();
    QApplication::quit();
}

void MainWindow::showLoadingDialog()
{
    if (!loadingDialog) {
        loadingDialog = new QProgressDialog(tr("加载中..."), QString(), 0, 0, this);
        loadingDialog->setWindowFlags(Qt::Dialog | Qt::CustomizeWindowHint | Qt::FramelessWindowHint);
        loadingDialog->setCancelButton(nullptr); // 不显示取消按钮
        loadingDialog->setMinimumDuration(0); // 立即显示
        loadingDialog->setAutoClose(false); // 不自动关闭
        loadingDialog->setAutoReset(false); // 不自动重置
        
        // 设置样式表美化对话框
        loadingDialog->setStyleSheet(
            "QProgressDialog {"
            "  background-color: rgba(240, 240, 240, 220);"
            // "  border-radius: 10px;"
            "  border: 2px solid #cccccc;"
            "  padding: 10px;"
            "}"
            "QLabel {"
            "  color: #333333;"
            "  font-size: 12px;"
            "  font-weight: bold;"
            "}"
            "QProgressBar {"
            "  border: none;"
            "  background-color: #f0f0f0;"
            "  border-radius: 5px;"
            "  text-align: center;"
            "  height: 8px;"
            "}"
            "QProgressBar::chunk {"
            "  background-color: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #4d90fe, stop:1 #66b5ff);"
            "  border-radius: 5px;"
            "}"
        );
        
        // 调整大小
        loadingDialog->setFixedSize(200, 80);
        
        // 设置窗口透明度
        loadingDialog->setWindowOpacity(0.9);
    }
    
    // Update position to center it on the parent window
    updateLoadingDialogPosition();
    
    loadingDialog->show();
    QApplication::processEvents(); // 确保对话框立即显示
}

void MainWindow::hideLoadingDialog()
{
    if (loadingDialog) {
        loadingDialog->hide();
    }
}

void MainWindow::disableUI()
{
    // Disable buttons and controls
    ui->pushButton->setEnabled(false);
    ui->pushButton_2->setEnabled(false);
    ui->pushButton_3->setEnabled(false);
    ui->calendarWidget->setEnabled(false);
    
    // Show loading dialog if main window is visible
    if (isVisible()) {
        showLoadingDialog();
    }
}

void MainWindow::enableUI()
{
    // Re-enable buttons and controls
    ui->pushButton->setEnabled(true);
    ui->pushButton_2->setEnabled(true);
    ui->pushButton_3->setEnabled(true);
    ui->calendarWidget->setEnabled(true);
    
    // Hide loading dialog if main window is visible
    if (isVisible()) {
        hideLoadingDialog();
    }
}

void MainWindow::on_calendarWidget_selectionChanged()
{
    // Disable UI components
    disableUI();
    
    QDate selectedDate = ui->calendarWidget->selectedDate();
    QString dateString = selectedDate.toString("yyyyMMdd");
    ui->label_2->setText(dateString);
    
    // 保存是否需要自动点击的标志
    bool shouldAutoClick = needAutoClickAfterSelection;
    // 重置标志
    needAutoClickAfterSelection = false;
    
    // Set the wallpaper and wait for it to complete
    bool success = setNetworkPic_json(dateString);
    
    // Re-enable UI components
    enableUI();
    
    // 如果需要自动点击并且网络操作成功，则点击"设为壁纸"按钮
    if (shouldAutoClick && success) {
        on_pushButton_clicked();
    }
}

bool MainWindow::setNetworkPic_json(const QString &date)
{
    updateTimer->stop();

    // 从日期字符串提取年月信息，用于构建月度文件路径
    QString yearMonth = date.left(6); // 从yyyyMMdd格式的日期中获取yyyyMM部分
    
    // 构建月度JSON文件URL
    QString jsonurl = "https://gitee.com/Hyman25/mybingwallpaper/raw/wallpaperarchiv/month/"+yearMonth+".json";
    QUrl url(jsonurl);
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    
    QEventLoop loop;
    QNetworkReply *reply = networkManager->get(request);
    
    // Connect to handle errors
    connect(reply, &QNetworkReply::errorOccurred, [&](QNetworkReply::NetworkError error) {
        qDebug() << "Network error:" << error << reply->errorString();
    });
    
    // Connect to exit the event loop when finished
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    
    // Start the event loop
    loop.exec();
    
    bool success = false;
    
    if (reply->error() == QNetworkReply::NoError) {
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
                }
            } else {
                ui->label_2->setText(tr("JSON格式不支持"));
            }
        } else {
            ui->label_2->setText(tr("JSON数据解析失败"));
        }
    }  else {
        ui->label_2->setText(tr("网络请求失败: ") + reply->errorString());
    }

    reply->deleteLater();
    resetUpdateTimer();
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
    // qDebug() << "url:" << url;
    QEventLoop loop;

    // qDebug() << "Reading picture form " << url;
    QNetworkReply *reply = networkManager->get(QNetworkRequest(url));
    //请求结束并下载完成后，退出子事件循环
    QObject::connect(reply, SIGNAL(finished()), &loop, SLOT(quit()));
    //开启子事件循环
    loop.exec();

    QByteArray jpegData = reply->readAll();
    QPixmap pixmap;
    pixmap.loadFromData(jpegData);
    QPixmap dest=pixmap.scaled(ui->label->size(),Qt::KeepAspectRatio,Qt::SmoothTransformation);
    ui->label->setPixmap(dest);
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

void MainWindow::randomUpdateWallpaper()
{
    // 生成随机日期, 不早于2010-01-01
    QDate startDate = QDate(2010, 1, 1);
    QDate endDate = QDate::currentDate();
    QDate randomDate = startDate.addDays(QRandomGenerator::global()->bounded(startDate.daysTo(endDate)));
    
    // 设置一个标志，告诉选择变更处理器在网络操作完成后自动点击按钮
    needAutoClickAfterSelection = true;
    // 设置日历控件的日期
    ui->calendarWidget->setSelectedDate(randomDate);

    // Save the currently selected date
    QDate selectedDate = ui->calendarWidget->selectedDate();
    saveSettings("lastSelectedDate", selectedDate.toString("yyyyMMdd"));
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
    QDate selectedDate = ui->calendarWidget->selectedDate();
    saveSettings("lastSelectedDate", selectedDate.toString("yyyyMMdd"));
    
    // 如果设置的是今天的壁纸，保存最后更新日期
    if (selectedDate == QDate::currentDate()) {
        saveSettings("lastUpdateDate", selectedDate.toString("yyyyMMdd"));
    }
}

void MainWindow::downloadAndSaveWallpaper()
{
    if (!downloadImage()) {
        return;
    }

    // Get current date for filename
    QString dateStr = ui->calendarWidget->selectedDate().toString("yyyy-MM-dd");

    // Get user's Pictures directory path
    QString savePath = QDir::home().filePath("Pictures");
    QDir dir(savePath);

    // Create directory if it doesn't exist
    if (!dir.exists()) {
        dir.mkpath(".");
    }

    // 最终文件名
    QString finalFilePath = dir.filePath(QString("mybingwallpaper-%1.jpg").arg(dateStr));
    
    // Copy the temporary file to the Pictures directory
    QFile::copy(currentImgPath, finalFilePath);

    QMessageBox::information(this, tr("成功"), tr("图片已保存至:\n%1").arg(finalFilePath));
}

bool MainWindow::downloadImage()
{
    updateTimer->stop();
    
    QUrl url(currentImgUrl);
    QEventLoop loop;
    QTimer timer;

    // qDebug() << "currentImgUrl:" << currentImgUrl;
    
    // 设置超时时间为5秒
    timer.setSingleShot(true);
    timer.start(5000);

    QNetworkRequest request(url);
    QNetworkReply *reply = networkManager->get(request);
    
    // 连接超时信号和完成信号
    connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
    connect(reply, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    
    // 开启事件循环
    loop.exec();
    
    // 判断是否超时
    if (timer.isActive()) {
        // 未超时，停止计时器
        timer.stop();
    } else {
        // 超时处理
        reply->abort();
        // QMessageBox::warning(this, tr("错误"), tr("下载壁纸超时"));
        ui->label_2->setText(tr("下载壁纸超时: ") + url.toString());
        reply->deleteLater();
        resetUpdateTimer();
        return false;
    }

    // 检查网络请求是否成功
    if (reply->error() != QNetworkReply::NoError) {
        // QMessageBox::warning(this, tr("错误"), tr("下载壁纸失败: ") + reply->errorString());
        ui->label_2->setText(tr("下载壁纸失败: ") + reply->errorString());
        reply->deleteLater();
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
        // QMessageBox::warning(this, tr("错误"), tr("无法保存壁纸到临时文件!"));
        ui->label_2->setText(tr("无法保存壁纸到临时文件!"));
        reply->deleteLater();
        resetUpdateTimer();
        return false;
    }

    reply->deleteLater();

    resetUpdateTimer();
    return true;
}

bool MainWindow::setAutoStart(bool enable)
{
    QSettings settings("HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                       QSettings::NativeFormat);

    if (enable) {
        // 获取应用程序的完整路径
        QString appPath = QApplication::applicationFilePath();
        // 将路径中的正斜杠替换为反斜杠
        appPath.replace("/", "\\");
        // 在注册表中添加自启动项
        settings.setValue("MyBingWallpaper", appPath);
    } else {
        // 从注册表中移除自启动项
        settings.remove("MyBingWallpaper");
    }

    return true;
}

bool MainWindow::isAutoStartEnabled()
{
    QSettings settings("HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                       QSettings::NativeFormat);

    // Check if the key exists
    if (!settings.contains("MyBingWallpaper")) {
        return false;
    }
    
    // Get the current value from registry
    QString registryPath = settings.value("MyBingWallpaper").toString();
    
    // Get application's full path and normalize it (replace forward slashes with backslashes)
    QString appPath = QApplication::applicationFilePath();
    appPath.replace("/", "\\");
    
    // Return true only if the paths match
    return registryPath == appPath;
}

void MainWindow::autoUpdateWallpaper()
{
    // 获取当前日期
    QDate currentDate = QDate::currentDate();
    QString currentDateStr = currentDate.toString("yyyyMMdd");
    
    // 更新日历最大日期
    updateCalendarMaximumDate();
    
    // 获取上次更新日期
    QSettings settings(QApplication::applicationDirPath() + "/mybing.conf", QSettings::IniFormat);
    QString lastUpdateDate = settings.value("lastUpdateDate", "").toString();
    
    // 检查是否已经是新的一天，且今天尚未更新
    if (lastUpdateDate != currentDateStr || ui->calendarWidget->selectedDate() != currentDate) {
        // 尝试获取今日最新的壁纸
        bool success = setNetworkPic_json(currentDateStr);
        
        // 只有在成功获取到今日壁纸的情况下才更新壁纸
        if (success) {
            // 设置日历控件的日期为今天
            ui->calendarWidget->setSelectedDate(currentDate);
            
            // 自动设置壁纸
            ui->pushButton->click();
        } else {
            // 如果获取失败，不做任何操作，等待下一次计时器触发
            qDebug() << "Failed to get today's wallpaper, will retry later";
        }
    }
}

void MainWindow::saveSettings(const QString &key, const QVariant &value)
{
    QString configPath = QApplication::applicationDirPath() + "/mybing.conf";
    QSettings settings(configPath, QSettings::IniFormat);
    settings.setValue(key, value);
}

void MainWindow::loadSettings()
{
    QString configPath = QApplication::applicationDirPath() + "/mybing.conf";
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
    
    // 如果自动更新被启用，设置标志
    if (shouldAutoUpdate) {
        needInitialUpdate = true;
    }
}

bool MainWindow::setWindowsWallpaper(const QString &imagePath)
{
    if (!QFileInfo::exists(imagePath)) {
        return false;
    }

    // Convert QString to wide string for Windows API
    const wchar_t* wPath = reinterpret_cast<const wchar_t*>(imagePath.utf16());

    // Use Windows API to set desktop wallpaper
    // SPIF_UPDATEINIFILE | SPIF_SENDCHANGE: Update registry and notify all windows
    BOOL result = SystemParametersInfoW(
        SPI_SETDESKWALLPAPER,
        0,
        (void*)wPath,
        SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
    );

    // Only set lock screen wallpaper if enabled
    if (lockscreenEnabled) {
        setLockScreenWallpaper(imagePath);
    }
    
    // Return true if at least the desktop wallpaper was set successfully
    return result != 0;
}


bool MainWindow::setLockScreenWallpaper(const QString &imagePath)
{
    // Convert the relative path to absolute path if needed
    QFileInfo fileInfo(imagePath);
    QString absolutePath = fileInfo.absoluteFilePath();
    
    // Create registry key: HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\PersonalizationCSP
    QSettings settings("HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PersonalizationCSP", 
                       QSettings::NativeFormat);
    
    // Set the registry values
    bool success = true;
    
    // Replace forward slashes with backslashes for Windows path
    absolutePath.replace("/", "\\");
    
    try {
        // Set the lock screen image path
        settings.setValue("LockScreenImagePath", absolutePath);
        
        // Set the lock screen image URL (same as path for local files)
        settings.setValue("LockScreenImageUrl", absolutePath);
        
        // Set the status to enabled (1)
        settings.setValue("LockScreenImageStatus", 1);
    }
    catch (...) {
        // If any error occurs, return false
        success = false;

    }

    // 检测是否设置成功
    if (settings.value("LockScreenImageStatus", 0).toInt() == 1) {
        success = true;
    } else {
        success = false;
    }
    
    return success;
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
            QDate currentDate = QDate::currentDate();
            QString currentDateStr = currentDate.toString("yyyyMMdd");
            bool wallpaperLoaded = false;
            
            // 始终优先显示今日壁纸
            wallpaperLoaded = setNetworkPic_json(currentDateStr);
            
            if (wallpaperLoaded && needInitialUpdate) {
                // 设置日历控件的日期为今天
                ui->calendarWidget->setSelectedDate(currentDate);

                // 如果需要自动更新，检查是否需要设置壁纸
                QSettings settings(QApplication::applicationDirPath() + "/mybing.conf", QSettings::IniFormat);
                QString lastUpdateDate = settings.value("lastUpdateDate", "").toString();

                // 如果没有上次更新日期，或者上次更新不是今天，则自动设置壁纸
                if (lastUpdateDate.isEmpty() || lastUpdateDate != currentDateStr || lastSelectedDate != currentDateStr) {
                    QTimer::singleShot(1000, this, [this]() {
                                           ui->pushButton->click(); // 自动点击"设为壁纸"按钮
                                       });
                }

                // 重置标志
                needInitialUpdate = false;

                // 壁纸加载成功，停止定时器
                networkCheckTimer->stop();
                networkCheckTimer->deleteLater();
                
                qDebug() << "Network connection established, wallpaper loaded successfully";
            } else if (!needInitialUpdate) {
                // 尝试恢复上次选择的壁纸
                if (!lastSelectedDate.isEmpty()) {
                    QDate date = QDate::fromString(lastSelectedDate, "yyyyMMdd");
                    if (date.isValid()) {
                        bool oldWallpaperLoaded = setNetworkPic_json(lastSelectedDate);
                        if (oldWallpaperLoaded) {
                            ui->calendarWidget->setSelectedDate(date);
                            networkCheckTimer->stop();
                            networkCheckTimer->deleteLater();
                            qDebug() << "Network connected, today's wallpaper failed, loaded saved wallpaper";
                            return true;
                        }
                    }
                }
                
                // 壁纸加载失败，但网络连接正常，可能是服务器问题
                qDebug() << "Network connected but wallpaper loading failed, will retry...";
            }
        } else {
            // 网络连接失败，继续等待
            qDebug() << "Waiting for network connection...";
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

void MainWindow::updateCalendarMaximumDate()
{
    ui->calendarWidget->setMaximumDate(QDate::currentDate());
}

bool MainWindow::clearLockScreenWallpaper()
{
    qDebug() << "clearLockScreenWallpaper";
    // Create registry key: HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\PersonalizationCSP
    QSettings settings("HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PersonalizationCSP", 
                       QSettings::NativeFormat);
    
    bool success = true;
    
    try {
        // Remove the lock screen image path
        settings.remove("LockScreenImagePath");
        
        // Remove the lock screen image URL
        settings.remove("LockScreenImageUrl");
        
        // Set the status to disabled (0)
        settings.setValue("LockScreenImageStatus", 0);
    }
    catch (...) {
        // If any error occurs, return false
        success = false;
    }
    
    return success;
}
