#ifndef MAINWINDOW_H
#define MAINWINDOW_H

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
    void on_autoStartCheckBox_stateChanged(int state);
    void on_autoUpdateCheckBox_stateChanged(int state);
    void on_checkBox_stateChanged(int state);
    void autoUpdateWallpaper();
    void randomUpdateWallpaper();

private:
    Ui::MainWindow *ui;
    QNetworkAccessManager *networkManager;
    QString currentImgUrl;
    QString currentImgPath;
    QProgressDialog *loadingDialog;
    bool setLockScreenWallpaper_enabled;
    bool needAutoClickAfterSelection = false;
    bool setWindowsWallpaper(const QString &imagePath);
    bool setLockScreenWallpaper(const QString &imagePath);
    bool clearLockScreenWallpaper();
    bool setNetworkPic_json(const QString &date);
    void setNetworkPic(const QString &imgurl);
    
    // Image download and application methods
    void downloadAndSetWallpaper();
    void downloadAndSaveWallpaper();
    bool downloadImage();
    
    // System tray related members
    QSystemTrayIcon *trayIcon;
    QMenu *trayIconMenu;
    QAction *exitAction;
    
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
