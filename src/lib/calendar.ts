export function buildCalendar(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthStart = new Date(year, month, 1, 12);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - mondayOffset);

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}
