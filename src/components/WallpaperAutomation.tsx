import { CalendarDays, Check, ChevronDown, Clock3, Play, Power, Repeat2, Shuffle } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isFavoriteMode } from "../lib/favorites";
import { alignedPopover } from "../lib/popover";
import type { Settings } from "../lib/wallpaper";

type Mode = Settings["wallpaperMode"];
const modes = [
  { value: "off", label: "关闭", description: "不自动更换", icon: Power },
  { value: "daily", label: "每日必应", description: "每天换一张必应壁纸", icon: CalendarDays },
  { value: "favoritesSequential", label: "收藏循环", description: "按收藏顺序播放", icon: Repeat2 },
  { value: "favoritesRandom", label: "随机收藏", description: "随机播放收藏", icon: Shuffle },
] as const;
const intervals = [
  { value: 15, label: "15 分钟" },
  { value: 60, label: "1 小时" },
  { value: 360, label: "6 小时" },
  { value: 1440, label: "每天" },
];

interface Props {
  settings: Settings;
  favoriteCount: number;
  busy: boolean;
  variant?: "settings" | "header";
  onAdvance?: () => void;
  onChange: (patch: Partial<Settings>) => void;
}

function ModePicker({ value, favoriteCount, busy, header, footer, onChange }: { value: Mode; favoriteCount: number; busy: boolean; header: boolean; footer?: ReactNode; onChange: (mode: Mode) => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = modes.find((mode) => mode.value === value) ?? modes[0];
  const Icon = current.icon;
  const hasFooter = Boolean(footer);

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const popup = { width: menu.current.getBoundingClientRect().width, height: menu.current.scrollHeight + 2 };
    const panel = trigger.current.closest(header ? ".favorites-gallery" : ".settings-panel")?.getBoundingClientRect();
    const leftEdge = Math.max(12, (panel?.left ?? 0) + 12);
    const rightEdge = Math.min(window.innerWidth - 12, (panel?.right ?? window.innerWidth) - 12);
    setPosition(alignedPopover(anchor, popup, {
      left: leftEdge,
      right: rightEdge,
      top: Math.max(12, (panel?.top ?? 0) + 12),
      bottom: Math.min(window.innerHeight - 12, (panel?.bottom ?? window.innerHeight) - 12),
    }));
    (menu.current.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')
      ?? menu.current.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
  }, [open, header, hasFooter]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    const dismissOnScroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnResize = () => setOpen(false);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("scroll", dismissOnScroll, true);
    window.addEventListener("resize", dismissOnResize);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("scroll", dismissOnScroll, true);
      window.removeEventListener("resize", dismissOnResize);
    };
  }, [open]);

  useEffect(() => { if (busy) setOpen(false); }, [busy]);

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <>
      <button ref={trigger} type="button" className={`automation-mode-trigger${open ? " expanded" : ""}${value !== "off" ? " enabled" : ""}`} aria-label="自动换壁纸模式" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined} disabled={busy} onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
      }}>
        <Icon size={15} /><span>{header && value === "off" ? "自动换壁纸" : current.label}</span><ChevronDown size={14} className="automation-chevron" />
      </button>
      {open && createPortal(
        <div ref={menu} id={menuId} className="automation-mode-menu" role="dialog" aria-label="自动换壁纸" style={position} onKeyDown={handleMenuKey}>
          <p className="automation-menu-heading">自动换壁纸</p>
          <div role="menu" aria-label="自动换壁纸模式">
          {modes.map((mode) => {
            const selected = mode.value === value;
            const disabled = isFavoriteMode(mode.value) && !favoriteCount;
            const ModeIcon = mode.icon;
            return (
              <button key={mode.value} type="button" className={`automation-mode-option${selected ? " selected" : ""}`} role="menuitemradio" aria-checked={selected} disabled={disabled || busy} onClick={() => {
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
                if (!selected) onChange(mode.value);
              }}>
                <span className="automation-option-icon"><ModeIcon size={17} /></span>
                <span className="automation-option-copy"><strong>{mode.label}</strong>{disabled && <small>暂无收藏</small>}</span>
                {selected && <Check size={15} className="automation-option-check" />}
              </button>
            );
          })}
          </div>
          {footer}
        </div>, document.body,
      )}
    </>
  );
}

export function WallpaperAutomation({ settings, favoriteCount, busy, variant = "settings", onChange, onAdvance }: Props) {
  const playing = isFavoriteMode(settings.wallpaperMode);
  const mode = modes.find((item) => item.value === settings.wallpaperMode) ?? modes[0];
  const intervalControls = playing && (
        <div className="automation-interval-row">
          <span className="automation-interval-label"><Clock3 size={13} />更换间隔</span>
          <div className="automation-intervals" role="group" aria-label="收藏壁纸更换间隔">
            {intervals.map((interval) => <button key={interval.value} type="button" className={settings.favoritesIntervalMinutes === interval.value ? "selected" : ""} aria-pressed={settings.favoritesIntervalMinutes === interval.value} disabled={busy} onClick={() => {
              if (settings.favoritesIntervalMinutes !== interval.value) onChange({ favoritesIntervalMinutes: interval.value });
            }}>{interval.label}</button>)}
          </div>
        </div>
  );
  return (
    <div className={`wallpaper-automation ${variant}`}>
      <div className="automation-mode-row">
        {variant === "settings" && <span className="automation-setting-copy"><strong>自动换壁纸</strong><small>{mode.description}</small></span>}
        <ModePicker value={settings.wallpaperMode} favoriteCount={favoriteCount} busy={busy} header={variant === "header"} onChange={(wallpaperMode) => onChange({ wallpaperMode })} footer={variant === "header" && playing ? <div className="automation-menu-footer">
          {intervalControls}
          {onAdvance && <button type="button" className="automation-advance" disabled={busy || !favoriteCount} onClick={onAdvance}><Play size={14} />换一张</button>}
        </div> : undefined} />
      </div>
      {variant === "settings" && intervalControls}
    </div>
  );
}
