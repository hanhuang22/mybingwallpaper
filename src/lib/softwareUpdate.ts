export interface SoftwareUpdateProgress {
  source: "GitHub" | "Gitee";
  downloaded: number;
  total?: number | null;
}

export function softwareUpdatePercent({ downloaded, total }: SoftwareUpdateProgress): number | null {
  if (!total || !Number.isFinite(total) || total < 0 || !Number.isFinite(downloaded)) return null;
  return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
}
