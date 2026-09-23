import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const updaterPlatforms = (tag) => ({
  "windows-x86_64": `mybingwallpaper-${tag}-windows-x64-setup.exe`,
  "windows-i686": `mybingwallpaper-${tag}-windows-x86-setup.exe`,
  "windows-aarch64": `mybingwallpaper-${tag}-windows-arm64-setup.exe`,
  "darwin-x86_64": `mybingwallpaper-${tag}-macos-intel.app.tar.gz`,
  "darwin-aarch64": `mybingwallpaper-${tag}-macos-apple-silicon.app.tar.gz`,
});

export async function buildUpdaterManifest({ assetDir, tag, urlForAsset }) {
  const platforms = {};
  for (const [platform, fileName] of Object.entries(updaterPlatforms(tag))) {
    const signature = (await readFile(join(assetDir, `${fileName}.sig`), "utf8")).trim();
    platforms[platform] = {
      url: await urlForAsset(fileName),
      signature,
    };
  }

  return {
    version: tag.replace(/^v/i, ""),
    notes: `mybingwallpaper ${tag}`,
    pub_date: new Date().toISOString(),
    platforms,
  };
}
