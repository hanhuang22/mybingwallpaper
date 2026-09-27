import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);
  const appWindow = useMemo(getCurrentWindow, []);

  useEffect(() => {
    let active = true;
    const syncMaximized = () => {
      void appWindow.isMaximized()
        .then((value) => { if (active) setMaximized(value); })
        .catch((error) => console.warn("无法读取窗口状态", error));
    };

    syncMaximized();
    const listener = appWindow.onResized(syncMaximized);
    return () => {
      active = false;
      void listener.then((unlisten) => unlisten()).catch((error) => console.warn("无法停止监听窗口大小", error));
    };
  }, [appWindow]);

  const runWindowAction = (action: Promise<void>) => {
    void action.catch((error) => console.warn("窗口操作失败", error));
  };

  return (
    <>
      <div className="window-drag-region windows" data-tauri-drag-region aria-hidden="true" />
      <div className="windows-window-controls" role="group" aria-label="窗口控制">
        <button type="button" aria-label="最小化" title="最小化" onClick={() => runWindowAction(appWindow.minimize())}>
          <Minus size={15} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label={maximized ? "还原窗口" : "最大化"}
          title={maximized ? "还原窗口" : "最大化"}
          onClick={() => runWindowAction(appWindow.toggleMaximize())}
        >
          {maximized ? <Copy size={13} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
        </button>
        <button className="close" type="button" aria-label="关闭窗口" title="关闭窗口" onClick={() => runWindowAction(appWindow.close())}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
    </>
  );
}
