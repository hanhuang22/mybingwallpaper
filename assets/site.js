const REPOSITORY = "hanhuang22/mybingwallpaper";
const FIRST_ARCHIVE_YEAR = 2010;
const monthNames = [
  "一月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
];

const yearSelect = document.querySelector("#year-select");
const monthSelect = document.querySelector("#month-select");
const grid = document.querySelector("#wallpaper-grid");
const status = document.querySelector("#gallery-status");

function setSmartDownloadText() {
  const platform = navigator.userAgent.toLowerCase();
  let label = "下载最新版";
  if (platform.includes("mac")) label = "下载 macOS 版";
  if (platform.includes("win")) label = "下载 Windows 版";
  document.querySelectorAll("[data-smart-download]").forEach((link) => {
    link.textContent = label;
  });
}

async function hydrateLatestRelease() {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`);
    if (!response.ok) return;
    const release = await response.json();
    document.querySelectorAll("[data-release-link]").forEach((link) => {
      link.href = release.html_url;
    });
    document.querySelectorAll("[data-release-version]").forEach((label) => {
      label.textContent = release.tag_name;
    });
  } catch {
    // The permanent /releases/latest links remain usable if the API is unavailable.
  }
}

function populateDateControls() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const params = new URLSearchParams(window.location.search);
  const requestedMonth = params.get("month");
  const requestedYear = Number(requestedMonth?.slice(0, 4));
  const requestedMonthNumber = Number(requestedMonth?.slice(4, 6));

  for (let year = currentYear; year >= FIRST_ARCHIVE_YEAR; year -= 1) {
    yearSelect.add(new Option(`${year} 年`, String(year)));
  }

  monthNames.forEach((name, index) => {
    monthSelect.add(new Option(name, String(index + 1).padStart(2, "0")));
  });

  yearSelect.value = requestedYear >= FIRST_ARCHIVE_YEAR ? String(requestedYear) : String(currentYear);
  monthSelect.value = requestedMonthNumber >= 1 && requestedMonthNumber <= 12
    ? String(requestedMonthNumber).padStart(2, "0")
    : String(now.getMonth() + 1).padStart(2, "0");
}

function cleanTitle(rawTitle = "") {
  const title = rawTitle.includes("  |  ")
    ? rawTitle.split("  |  ")[1]
    : rawTitle.includes("|")
      ? rawTitle.split("|")[1]
      : rawTitle;
  return title.replace(/\s+-\s+\d{4}\/\d{2}\/\d{2}\s*$/, "").trim() || "每日精选壁纸";
}

function previewUrl(url) {
  if (!url.includes("bing.com")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=960`;
}

function createWallpaperCard(item) {
  const link = document.createElement("a");
  link.className = "wallpaper-card";
  link.href = item.imgurl;
  link.target = "_blank";
  link.rel = "noreferrer";

  const imageBox = document.createElement("div");
  imageBox.className = "wallpaper-card-image";

  const image = document.createElement("img");
  image.src = previewUrl(item.imgurl);
  image.alt = cleanTitle(item.imgtitle);
  image.loading = "lazy";
  image.decoding = "async";
  imageBox.append(image);

  const copy = document.createElement("div");
  copy.className = "wallpaper-card-copy";

  const date = document.createElement("time");
  date.dateTime = item.date;
  date.textContent = item.date.replaceAll("-", " · ");

  const title = document.createElement("h3");
  title.textContent = cleanTitle(item.imgtitle);

  copy.append(date, title);
  link.append(imageBox, copy);
  return link;
}

async function fetchMonth(monthKey) {
  const response = await fetch(`month/${monthKey}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`month ${monthKey} not found`);
  return response.json();
}

async function loadGallery({ findLatest = false } = {}) {
  grid.replaceChildren();
  status.textContent = "正在载入壁纸…";

  let year = Number(yearSelect.value);
  let month = Number(monthSelect.value);
  let data;

  for (let attempt = 0; attempt < (findLatest ? 18 : 1); attempt += 1) {
    const key = `${year}${String(month).padStart(2, "0")}`;
    try {
      data = await fetchMonth(key);
      yearSelect.value = String(year);
      monthSelect.value = String(month).padStart(2, "0");
      break;
    } catch {
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }
  }

  if (!data) {
    status.textContent = "这个月份还没有收录壁纸，请选择其他月份。";
    return;
  }

  const entries = Object.values(data).sort((a, b) => b.date.localeCompare(a.date));
  const fragment = document.createDocumentFragment();
  entries.forEach((item) => fragment.append(createWallpaperCard(item)));
  grid.append(fragment);
  status.textContent = `${year} 年 ${monthNames[month - 1]} · 共 ${entries.length} 张壁纸`;

  const url = new URL(window.location.href);
  url.searchParams.set("month", `${year}${String(month).padStart(2, "0")}`);
  window.history.replaceState({}, "", url);
}

populateDateControls();
setSmartDownloadText();
hydrateLatestRelease();
document.querySelector("#current-year").textContent = new Date().getFullYear();

const hasRequestedMonth = new URLSearchParams(window.location.search).has("month");
loadGallery({ findLatest: !hasRequestedMonth });

yearSelect.addEventListener("change", () => loadGallery());
monthSelect.addEventListener("change", () => loadGallery());
