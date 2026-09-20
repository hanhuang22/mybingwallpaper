import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateKey } from "../lib/wallpaper";

interface DatePickerProps {
  value: string;
  minimum: string;
  maximum: string;
  onChange: (value: string) => void;
}

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

function parseDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function sameMonth(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function monthKey(date: Date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function displayDate(value: string) {
  const date = parseDate(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function buildCalendar(viewDate: Date) {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1, 12);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function DatePicker({ value, minimum, maximum, onChange }: DatePickerProps) {
  const selectedDate = useMemo(() => parseDate(value), [value]);
  const minimumDate = useMemo(() => parseDate(minimum), [minimum]);
  const maximumDate = useMemo(() => parseDate(maximum), [maximum]);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(selectedDate);
  const rootRef = useRef<HTMLDivElement>(null);
  const calendarDays = useMemo(() => buildCalendar(viewDate), [viewDate]);
  const years = useMemo(
    () => Array.from(
      { length: maximumDate.getFullYear() - minimumDate.getFullYear() + 1 },
      (_, index) => maximumDate.getFullYear() - index,
    ),
    [maximumDate, minimumDate],
  );

  useEffect(() => {
    if (!open) setViewDate(selectedDate);
  }, [open, selectedDate]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const moveMonth = (amount: number) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1, 12));
  };

  const changeYear = (year: number) => {
    const earliestMonth = year === minimumDate.getFullYear() ? minimumDate.getMonth() : 0;
    const latestMonth = year === maximumDate.getFullYear() ? maximumDate.getMonth() : 11;
    const nextMonth = Math.min(Math.max(viewDate.getMonth(), earliestMonth), latestMonth);
    setViewDate(new Date(year, nextMonth, 1, 12));
  };

  const changeMonth = (month: number) => {
    setViewDate(new Date(viewDate.getFullYear(), month, 1, 12));
  };

  const selectDate = (date: Date) => {
    const next = formatDateKey(date);
    if (next < minimum || next > maximum) return;
    onChange(next);
    setOpen(false);
  };

  const previousDisabled = monthKey(viewDate) <= monthKey(minimumDate);
  const nextDisabled = monthKey(viewDate) >= monthKey(maximumDate);

  return (
    <div className="date-picker" ref={rootRef}>
      <button
        className="date-picker-trigger"
        type="button"
        aria-label={`选择日期，当前为${displayDate(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays size={17} />
        <span>{displayDate(value)}</span>
      </button>

      {open && (
        <div className="calendar-popover" role="dialog" aria-label="选择壁纸日期">
          <div className="calendar-heading">
            <button
              className="calendar-nav"
              type="button"
              aria-label="上个月"
              disabled={previousDisabled}
              onClick={() => moveMonth(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <div className="calendar-period">
              <select
                aria-label="选择年份"
                value={viewDate.getFullYear()}
                onChange={(event) => changeYear(Number(event.target.value))}
              >
                {years.map((year) => <option key={year} value={year}>{year}年</option>)}
              </select>
              <select
                aria-label="选择月份"
                value={viewDate.getMonth()}
                onChange={(event) => changeMonth(Number(event.target.value))}
              >
                {Array.from({ length: 12 }, (_, month) => {
                  const key = viewDate.getFullYear() * 12 + month;
                  const disabled = key < monthKey(minimumDate) || key > monthKey(maximumDate);
                  return <option key={month} value={month} disabled={disabled}>{month + 1}月</option>;
                })}
              </select>
            </div>
            <button
              className="calendar-nav"
              type="button"
              aria-label="下个月"
              disabled={nextDisabled}
              onClick={() => moveMonth(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="calendar-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="calendar-grid">
            {calendarDays.map((date) => {
              const key = formatDateKey(date);
              const disabled = key < minimum || key > maximum;
              const selected = key === value;
              const outside = !sameMonth(date, viewDate);
              const isToday = key === maximum;

              return (
                <button
                  className={`calendar-day${outside ? " outside" : ""}${selected ? " selected" : ""}${isToday ? " today" : ""}`}
                  type="button"
                  key={key}
                  disabled={disabled}
                  aria-label={displayDate(key)}
                  aria-pressed={selected}
                  onClick={() => selectDate(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="calendar-footer">
            <span>可浏览 2010 年至今</span>
            {value !== maximum && (
              <button type="button" onClick={() => selectDate(maximumDate)}>回到今天</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
