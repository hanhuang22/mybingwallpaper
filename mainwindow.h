#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include "ui_mainwindow.h"
#include <QMainWindow>
#include <QString>
#include <QtNetwork/QNetworkAccessManager>
#include <QSystemTrayIcon>
#include <QMenu>
#include <QAction>
#include <QCloseEvent>
#include <QTimer>
#include <QEvent>
#include <QProgressDialog>
#include <QtNetwork/QNetworkReply>
#include <QDate>
#include <QDir>
#include <QVariant>
#include <QPixmap>
#include <QFileInfo>
#include <QMessageBox>
#include <Windows.h>
#include <QtNetwork/QNetworkReply>
#include <QObject>
#include <QJsonDocument>
#include <QJsonObject>
#include <QApplication>
#include <QIcon>
#include <QStyle>
#include <QSettings>
#include <QTextCharFormat>
#include <QDebug>
#include <QFile>
#include <QMoveEvent>
#include <QDateTime>
#include <QJsonArray>
#include <QRandomGenerator>

QT_BEGIN_NAMESPACE
namespace Ui {
class MainWindow;
}
QT_END_NAMESPACE

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

protected:
    void closeEvent(QCloseEvent *event) override;
    void moveEvent(QMoveEvent *event) override;

private slots:
    void on_pushButton_clicked();
    void on_pushButton_2_clicked();
    void on_pushButton_3_clicked();
    void on_calendarWidget_selectionChanged();
    void trayIconActivated(QSystemTrayIcon::ActivationReason reason);
    void exitApplication();
    void autoUpdateWallpaper();
    void randomUpdateWallpaper();

private:
    Ui::MainWindow *ui;
    QNetworkAccessManager *networkManager;
    QString const configPath = QApplication::applicationDirPath() + "/mybing.conf";
    QString currentImgUrl;
    QString currentImgPath;
    QProgressDialog *loadingDialog = nullptr;
    bool needAutoClickAfterSelection = false;
    bool needSelectDateAndAutoClick = false;
    QString lastSelectedDate;
    bool shouldAutoUpdate = false;
    bool lockscreenEnabled = false;
    void setSelectedDateWithAutoClick(const QString &date, bool autoClick);
    bool setWindowsWallpaper(const QString &imagePath);
    bool setLockScreenWallpaper(const QString &imagePath);
    bool clearLockScreenWallpaper();
    bool setNetworkPic_json(const QString &date);
    void setNetworkPic(const QString &imgurl);
    QIcon getApplicationIcon();
    void resetNetworkManager();
    
    // Image download and application methods
    void downloadAndSetWallpaper();
    void downloadAndSaveWallpaper();
    bool downloadImage();
    
    // System tray related members
    QSystemTrayIcon *trayIcon;
    QMenu *trayIconMenu;
    QAction *exitAction;
    QAction *dailyUpdateAction;
    QAction *lockscreenAction;
    QAction *autoStartAction;
    
    // Timer for auto update
    QTimer *updateTimer;
    void resetUpdateTimer();
    
    void createTrayIcon();
    bool setAutoStart(bool enable);
    bool isAutoStartEnabled();
    void showLoadingDialog();
    void hideLoadingDialog();
    void saveSettings(const QString &key, const QVariant &value);
    void loadSettings();
    void updateLoadingDialogPosition();
    void initNetworkWallpaper();
    void updateCalendarMaximumDate();
    
    // New methods for UI management
    void disableUI();
    void enableUI();
};
#endif // MAINWINDOW_H
