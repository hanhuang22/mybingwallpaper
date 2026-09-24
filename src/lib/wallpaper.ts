export interface Wallpaper {
  date: string;
  title: string;
  description: string;
  imageUrl: string;
}

interface RemoteWallpaper {
  date?: string;
  imgtitle: string;
  imgdesc?: string;
  imgurl: string;
}

export interface Settings {
  autoUpdate: boolean;
  autoStart: boolean;
  lockScreen: boolean;
  autoDownloadUpdates: boolean;
  theme: "system" | "light" | "dark";
  saveWithoutPrompt: boolean;
}

export interface DateNavigationState {
  today: string;
  selectedDate: string;
}

export const defaultSettings: Settings = {
  autoUpdate: false,
  autoStart: false,
  lockScreen: false,
  autoDownloadUpdates: true,
  theme: "system",
  saveWithoutPrompt: true,
};

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateToApiKey(date: string): string {
  return date.replaceAll("-", "");
}

export function parseTitle(title: string): { headline: string; attribution: string } {
  const withoutDate = title
    .replace(/\s*[-–—]\s*\d{4}\/\d{2}\/\d{2}\s*$/, "")
    .trim();
  const separator = withoutDate.indexOf("|");
  if (separator >= 0) {
    return {
      headline: withoutDate.slice(0, separator).trim() || "必应每日壁纸",
      attribution: withoutDate.slice(separator + 1).trim(),
    };
  }

  const copyright = withoutDate.lastIndexOf("©");
  const asciiParenthesis = copyright >= 0 ? withoutDate.lastIndexOf("(", copyright) : -1;
  const fullWidthParenthesis = copyright >= 0 ? withoutDate.lastIndexOf("（", copyright) : -1;
  const attributionStart = Math.max(asciiParenthesis, fullWidthParenthesis);
  const hasTrailingAttribution =
    attributionStart > 0 && (withoutDate.endsWith(")") || withoutDate.endsWith("）"));

  return {
    headline: (hasTrailingAttribution
      ? withoutDate.slice(0, attributionStart)
      : withoutDate).trim() || "必应每日壁纸",
    attribution: hasTrailingAttribution
      ? withoutDate.slice(attributionStart).trim()
      : "",
  };
}

export function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return formatDateKey(date);
}

export function syncDateNavigation(
  state: DateNavigationState,
  nextToday: string,
): DateNavigationState {
  if (state.today === nextToday) return state;
  return {
    today: nextToday,
    selectedDate:
      state.selectedDate === state.today || state.selectedDate > nextToday
        ? nextToday
        : state.selectedDate,
  };
}

export function randomDate(minimum = "2010-01-01", maximum = formatDateKey(new Date())): string {
  const start = new Date(`${minimum}T12:00:00`).getTime();
  const end = new Date(`${maximum}T12:00:00`).getTime();
  const day = 86_400_000;
  const days = Math.max(0, Math.floor((end - start) / day));
  return formatDateKey(new Date(start + Math.floor(Math.random() * (days + 1)) * day));
}

export async function fetchWallpaperInBrowser(date: string): Promise<Wallpaper> {
  const key = dateToApiKey(date);
  const month = key.slice(0, 6);
  const response = await fetch(
    `/archive/month/${month}.json`,
  );
  if (!response.ok) {
    throw new Error(`壁纸数据请求失败（${response.status}）`);
  }
  const records = (await response.json()) as Record<string, RemoteWallpaper>;
  const record = records[key];
  if (!record) {
    throw new Error("没有找到这一天的壁纸");
  }
  return {
    date: record.date ?? date,
    title: record.imgtitle,
    description: record.imgdesc ?? "",
    imageUrl: record.imgurl,
  };
}
