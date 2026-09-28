import { ChevronLeft, ChevronRight, ImageOff, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { thumbnailUrl } from "../lib/thumbnail";
import { parseTitle, type Wallpaper } from "../lib/wallpaper";

interface MonthGalleryProps {
  month: string;
  minimumMonth: string;
  maximumMonth: string;
  today: string;
  selectedDate: string;
  records: Wallpaper[];
  loading: boolean;
  error: string;
  selectionError: string;
  pendingDate: string | null;
  onMoveMonth: (amount: number) => void;
  onRetry: () => void;
  onSelect: (wallpaper: Wallpaper, card: HTMLButtonElement) => void;
}

export function MonthGallery({
  month, minimumMonth, maximumMonth, today, selectedDate, records,
  loading, error, selectionError, pendingDate, onMoveMonth, onRetry, onSelect,
}: MonthGalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleDates, setVisibleDates] = useState<Set<string>>(() => new Set());
  const [brokenDates, setBrokenDates] = useState<Set<string>>(() => new Set());
  const [year, number] = month.split("-").map(Number);
  const daysInMonth = new Date(year, number, 0, 12).getDate();
  const recordsByDate = useMemo(
    () => new Map(records.map((record) => [record.date, record])),
    [records],
  );
  const days = useMemo(
    () => Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)
      .filter((date) => date <= today),
    [daysInMonth, month, today],
  );

  useEffect(() => {
    setVisibleDates(new Set());
    setBrokenDates(new Set());
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [month]);

  useEffect(() => {
    if (loading || error) return;
    const root = scrollRef.current;
    if (!root) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisibleDates(new Set(days));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const newlyVisible = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => (entry.target as HTMLElement).dataset.galleryDate)
        .filter((date): date is string => Boolean(date));
      if (newlyVisible.length) {
        setVisibleDates((current) => new Set([...current, ...newlyVisible]));
        entries.forEach((entry) => { if (entry.isIntersecting) observer.unobserve(entry.target); });
      }
    }, { root, rootMargin: "120px" });
    root.querySelectorAll("[data-gallery-date]").forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [days, error, loading, records]);

  return (
    <section className={`month-gallery${pendingDate ? " pending" : ""}`} aria-label={`${year}年${number}月壁纸月览`}>
      <header className="month-gallery-heading">
        <div>
          <span className="month-gallery-kicker">壁纸月览</span>
          <h2>{year}年{number}月</h2>
        </div>
        <div className="month-gallery-navigation">
          <span>选择一张图片查看大图</span>
          <button type="button" className="month-gallery-nav" aria-label="上个月" disabled={month <= minimumMonth || Boolean(pendingDate)} onClick={() => onMoveMonth(-1)}><ChevronLeft size={19} /></button>
          <button type="button" className="month-gallery-nav" aria-label="下个月" disabled={month >= maximumMonth || Boolean(pendingDate)} onClick={() => onMoveMonth(1)}><ChevronRight size={19} /></button>
        </div>
      </header>

      {selectionError && <p className="month-gallery-selection-error" role="alert">{selectionError}</p>}

      <div className="month-gallery-scroll" ref={scrollRef}>
        {loading ? (
          <div className="month-gallery-grid" aria-busy="true" aria-label="正在加载当月壁纸">
            {Array.from({ length: 18 }, (_, index) => <div className="month-gallery-skeleton" key={index} />)}
          </div>
        ) : error ? (
          <div className="month-gallery-empty" role="alert">
            <ImageOff size={30} />
            <p>{error}</p>
            <button type="button" className="text-button" onClick={onRetry}><RefreshCw size={16} />重试</button>
          </div>
        ) : (
          <div className="month-gallery-grid">
            {days.map((date) => {
              const record = recordsByDate.get(date);
              const headline = record ? parseTitle(record.title).headline : "暂无壁纸";
              const loadImage = Boolean(record && visibleDates.has(date) && !brokenDates.has(date));
              return (
                <button
                  className={`month-gallery-card${date === selectedDate ? " selected" : ""}${!record ? " unavailable" : ""}`}
                  type="button"
                  key={date}
                  data-gallery-date={date}
                  disabled={!record || Boolean(pendingDate)}
                  aria-label={`${date}：${headline}`}
                  aria-current={date === today ? "date" : undefined}
                  aria-pressed={Boolean(record && date === selectedDate)}
                  title={headline}
                  onClick={(event) => { if (record) onSelect(record, event.currentTarget); }}
                >
                  <span className="month-gallery-image">
                    {loadImage && <img src={thumbnailUrl(record!.imageUrl)} alt="" decoding="async" loading="lazy" onError={() => setBrokenDates((current) => new Set([...current, date]))} />}
                    {brokenDates.has(date) || !record ? <ImageOff size={23} /> : null}
                    <span className="month-gallery-day" aria-hidden="true">{Number(date.slice(-2))}</span>
                    {pendingDate === date && <span className="month-gallery-card-loading"><LoaderCircle className="spin" size={19} /></span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
