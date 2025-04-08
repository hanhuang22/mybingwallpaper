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
    , setLockScreenWallpaper_enabled(false)
{
    ui->setupUi(this);
    setWindowTitle(tr("必应壁纸"));

    // 设置日历最大日期为今天，限制不能选择未来日期
    ui->calendarWidget->setMaximumDate(QDate::currentDate());
    QTextCharFormat weekendFormat;
    weekendFormat.setForeground(QBrush(Qt::black));
    ui->calendarWidget->setWeekdayTextFormat(Qt::Saturday, weekendFormat);
    ui->calendarWidget->setWeekdayTextFormat(Qt::Sunday, weekendFormat);
    
    // Set window icon
    setWindowIcon(getApplicationIcon());

    // Setup system tray icon
    createTrayIcon();
    // 初始化自动更新定时器
    updateTimer = new QTimer(this);
    connect(updateTimer, &QTimer::timeout, this, &MainWindow::autoUpdateWallpaper);

    // 加载设置
    loadSettings();

    // 检查网络连接并加载壁纸，而不是直接调用
    initNetworkWallpaper();

    // 连接信号槽
    connect(ui->autoStartCheckBox, &QCheckBox::checkStateChanged, this, &MainWindow::on_autoStartCheckBox_stateChanged);

    // 连接自动更新复选框信号
    connect(ui->autoUpdateCheckBox, &QCheckBox::checkStateChanged, this, &MainWindow::on_autoUpdateCheckBox_stateChanged);

    // 连接锁屏壁纸复选框信号 
    connect(ui->checkBox, &QCheckBox::checkStateChanged, this, &MainWindow::on_checkBox_stateChanged);

    // 启动时不显示主窗口
    // show();

    // 加载设置
    // loadSettings();
}

MainWindow::~MainWindow()
{
    if (updateTimer->isActive()) {
        updateTimer->stop();
    }
    delete ui;
}

void MainWindow::createTrayIcon()
{
    // Create exit action
    exitAction = new QAction(tr("退出"), this);
    connect(exitAction, &QAction::triggered, this, &MainWindow::exitApplication);

    // Create tray icon menu
    trayIconMenu = new QMenu(this);
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

void MainWindow::on_calendarWidget_selectionChanged()
{
    QDate selectedDate = ui->calendarWidget->selectedDate();
    QString dateString = selectedDate.toString("yyyyMMdd");
    ui->label_2->setText(dateString);
    setNetworkPic_json(dateString);
}

bool MainWindow::setNetworkPic_json(const QString &date)
{
    // QString jsonurl = "https://hanhuang22.github.io/mybingwallpaper/date/"+date+".json";
    QString jsonurl = "https://gitee.com/Hyman25/mybingwallpaper/raw/wallpaperarchiv/date/"+date+".json";
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
        // qDebug() << "jsonData:" << jsonData.toStdString().c_str();
        QJsonDocument jsonDoc = QJsonDocument::fromJson(jsonData);
        
        if (!jsonDoc.isNull()) {
            if (jsonDoc.isArray()) {
                // Handle array format [{}]
                QJsonArray jsonArray = jsonDoc.array();
                if (!jsonArray.isEmpty() && jsonArray.at(0).isObject()) {
                    QJsonObject jsonObj = jsonArray.at(0).toObject();
                    QString imgtitle = jsonObj["imgtitle"].toString();
                    currentImgUrl = jsonObj["imgurl"].toString();
                    
                    if (!imgtitle.isEmpty() && !currentImgUrl.isEmpty()) {
                        ui->label_2->setText(imgtitle);
                        ui->label_2->adjustSize();
                        setNetworkPic(currentImgUrl);
                        success = true;
                    } else {
                        ui->label_2->setText(tr("获取图片信息失败"));
                    }
                } else {
                    ui->label_2->setText(tr("JSON数组为空或格式错误"));
                }
            } else if (jsonDoc.isObject()) {
                // Handle direct object format {}
                QJsonObject jsonObj = jsonDoc.object();
                QString imgtitle = jsonObj["imgtitle"].toString();
                currentImgUrl = jsonObj["imgurl"].toString();
                
                if (!imgtitle.isEmpty() && !currentImgUrl.isEmpty()) {
                    ui->label_2->setText(imgtitle);
                    ui->label_2->adjustSize();
                    setNetworkPic(currentImgUrl);
                    success = true;
                } else {
                    ui->label_2->setText(tr("获取图片信息失败"));
                }
            } else {
                ui->label_2->setText(tr("JSON格式不支持"));
            }
        } else {
            ui->label_2->setText(tr("JSON数据解析失败"));
        }
    } else {
        ui->label_2->setText(tr("网络请求失败: ") + reply->errorString());
    }
    
    reply->deleteLater();
    return success;
}

void MainWindow::setNetworkPic(const QString &imgurl)
{
    // showLoadingDialog();
    QUrl url;
    if (imgurl.contains("bing.com")) {
        url = QUrl(imgurl+"&w=480");
    } else {
        url = QUrl(imgurl);
    }
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

    // hideLoadingDialog();
}

void MainWindow::on_pushButton_clicked()
{
    if (isVisible()) {
        showLoadingDialog();
    }
    QUrl url(currentImgUrl);
    QEventLoop loop;

    // qDebug() << "Reading picture form " << url;
    QNetworkReply *reply = networkManager->get(QNetworkRequest(url));
    //请求结束并下载完成后，退出子事件循环
    QObject::connect(reply, SIGNAL(finished()), &loop, SLOT(quit()));
    //开启子事件循环
    loop.exec();

    QByteArray jpegData = reply->readAll();
    QPixmap currentPixmap;
    currentPixmap.loadFromData(jpegData);

    // 保存到临时文件
    QString tempPath = QDir::tempPath() + "/wallpaper.jpg";
    currentPixmap.save(tempPath, "JPG");
    currentImgPath = tempPath;

    // 设置为壁纸
    bool desktopResult = setWindowsWallpaper(currentImgPath);
    if (!desktopResult) {
        QMessageBox::warning(this, "错误", "无法设置桌面壁纸,请检查网络连接!");
    }
    
    // If lock screen wallpaper is enabled, set it directly too (in case setWindowsWallpaper didn't set it)
    if (setLockScreenWallpaper_enabled && desktopResult) {
        setLockScreenWallpaper(currentImgPath);
    }
    
    if (isVisible()) {
        hideLoadingDialog();
    }
}

void MainWindow::on_pushButton_2_clicked()
{
    if (isVisible()) {
        showLoadingDialog();
    }

    QUrl url(currentImgUrl);
    QEventLoop loop;

    QNetworkReply *reply = networkManager->get(QNetworkRequest(url));
    connect(reply, SIGNAL(finished()), &loop, SLOT(quit()));
    loop.exec();

    QByteArray jpegData = reply->readAll();
    QPixmap currentPixmap;
    currentPixmap.loadFromData(jpegData);

    // Get current date for filename
    QString dateStr = ui->calendarWidget->selectedDate().toString("yyyy-MM-dd");

    // Get user's Pictures directory path
    QString savePath = QDir::home().filePath("Pictures");
    QDir dir(savePath);

    // Create directory if it doesn't exist
    if (!dir.exists()) {
        dir.mkpath(".");
    }

    // Set file path with formatted name
    QString filePath = dir.filePath(QString("mybingwallpaper-%1.jpg").arg(dateStr));

    // Save the image
    if (currentPixmap.save(filePath, "JPG")) {
        QMessageBox::information(this, tr("成功"), tr("图片已保存至:\n%1").arg(filePath));
    } else {
        QMessageBox::warning(this, tr("错误"), tr("保存图片失败!"));
    }

    reply->deleteLater();
    if (isVisible()) {
        hideLoadingDialog();
    }
}

void MainWindow::on_autoStartCheckBox_stateChanged(int state)
{
    bool enable = (state == Qt::Checked);
    setAutoStart(enable);
    // 保存设置
    saveSettings("autoStart", ui->autoStartCheckBox->isChecked());
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

    return settings.contains("MyBingWallpaper");
}

void MainWindow::on_autoUpdateCheckBox_stateChanged(int state)
{
    if (state == Qt::Checked) {
        // 启动定时器，设置间隔为15分钟（900000毫秒）
        updateTimer->start(15*60*1000);
        // 立即执行一次更新
        autoUpdateWallpaper();
    } else {
        // 停止定时器
        updateTimer->stop();
    }
    // 保存设置
    saveSettings("autoUpdate", ui->autoUpdateCheckBox->isChecked());
}

void MainWindow::autoUpdateWallpaper()
{
    // 模拟点击"设为壁纸"按钮
    ui->calendarWidget->setSelectedDate(QDate::currentDate());
    on_pushButton_clicked();
}

void MainWindow::saveSettings(const QString &key, const bool &value)
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
    
    // 根据配置更新UI
    ui->autoStartCheckBox->setChecked(shouldAutoStart);
    
    if (settings.value("autoUpdate", false).toBool()) {
        ui->autoUpdateCheckBox->setChecked(true);
    }
    
    if (settings.value("setLockScreenWallpaper_enabled", false).toBool()) {
        setLockScreenWallpaper_enabled = true;
        ui->checkBox->setChecked(true);
    }

    // 如果自动更新被启用，启动定时器
    if (ui->autoUpdateCheckBox->isChecked()) {
        updateTimer->start(15*60*1000);
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
    bool lockScreenSet = false;
    if (setLockScreenWallpaper_enabled) {
        lockScreenSet = setLockScreenWallpaper(imagePath);
        // qDebug() << "lockScreenSet:" << lockScreenSet;
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
            // 网络连接成功，尝试加载壁纸
            bool wallpaperLoaded = setNetworkPic_json(ui->calendarWidget->selectedDate().toString("yyyyMMdd"));
            
            if (wallpaperLoaded) {
                // 壁纸加载成功，停止定时器
                networkCheckTimer->stop();
                
                // 如果启用了自动更新，则执行一次更新
                if (ui->autoUpdateCheckBox->isChecked()) {
                    autoUpdateWallpaper();
                }
                
                // 删除定时器
                networkCheckTimer->deleteLater();
                
                qDebug() << "Network connection established, wallpaper loaded successfully";
            } else {
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

void MainWindow::on_checkBox_stateChanged(int state)
{
    setLockScreenWallpaper_enabled = (state == Qt::Checked);
    
    if (!setLockScreenWallpaper_enabled) {
        // If checkbox is unchecked, clear the lock screen wallpaper
        bool clearResult = clearLockScreenWallpaper();
        if (!clearResult) {
            // Show a warning message if clearing fails, but don't change checkbox state
            QMessageBox::warning(this, tr("警告"), tr("清除锁屏壁纸失败，可能需要管理员权限。"));
        } else {
            // Optional: Show success message
            // QMessageBox::information(this, tr("成功"), tr("已清除锁屏壁纸设置。"));
        }
    } else if (!currentImgPath.isEmpty()) {
        // If checkbox is checked and we have a current image, set it as lock screen
        bool setResult = setLockScreenWallpaper(currentImgPath);
        if (!setResult) {
            // Show a warning message if setting fails
            QMessageBox::warning(this, tr("警告"), tr("设置锁屏壁纸失败，可能需要管理员权限。"));
            // Uncheck the box since we couldn't set it
            ui->checkBox->blockSignals(true);
            ui->checkBox->setChecked(false);
            ui->checkBox->blockSignals(false);
            setLockScreenWallpaper_enabled = false;
        }
    }
    
    // 保存设置
    saveSettings("setLockScreenWallpaper_enabled", setLockScreenWallpaper_enabled);
}

bool MainWindow::clearLockScreenWallpaper()
{
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

