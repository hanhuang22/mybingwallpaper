#include "mainwindow.h"

// Helper function to get application icon
QIcon MainWindow::getApplicationIcon()
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

void MainWindow::updateCalendarMaximumDate()
{
    ui->calendarWidget->setMaximumDate(QDate::currentDate());
}


void MainWindow::resetUpdateTimer()
{
    if (dailyUpdateAction->isChecked()) {
        updateTimer->start(15*60*1000);
    }
}

void MainWindow::closeEvent(QCloseEvent *event)
{
    // 最小化到托盘而不是关闭
    hide();
    event->ignore();
}

void MainWindow::exitApplication()
{
    trayIcon->hide();
    QApplication::quit();
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

    // 检测是否设置成功
    if (settings.value("LockScreenImageStatus", 0).toInt() == 0) {
        success = true;
    } else {
        success = false;
    }
    
    return success;
}


bool MainWindow::setAutoStart(bool enable)
{
    QSettings settings("HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                       QSettings::NativeFormat);
    
    // another place to set for run as admin
    QSettings settings2("HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run",
                       QSettings::NativeFormat);

    if (enable) {
        // 获取应用程序的完整路径
        QString appPath = QApplication::applicationFilePath();
        // 将路径中的正斜杠替换为反斜杠
        appPath.replace("/", "\\");
        // 在注册表中添加自启动项
        settings.setValue("MyBingWallpaper", appPath);
        settings2.setValue("MyBingWallpaper", appPath);
    } else {
        // 从注册表中移除自启动项
        settings.remove("MyBingWallpaper");
        settings2.remove("MyBingWallpaper");
    }

    return true;
}

bool MainWindow::isAutoStartEnabled()
{
    QSettings settings("HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                       QSettings::NativeFormat);
    QSettings settings2("HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run",
                       QSettings::NativeFormat);

    // Check if the key exists
    if (!settings.contains("MyBingWallpaper") || !settings2.contains("MyBingWallpaper")) {
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
