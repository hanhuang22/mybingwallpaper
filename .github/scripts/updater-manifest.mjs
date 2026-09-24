import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export const updaterPlatforms = (tag) => ({
  "windows-x86_64": `mybingwallpaper-${tag}-windows-x64-setup.exe`,
  "windows-i686": `mybingwallpaper-${tag}-windows-x86-setup.exe`,
  "windows-aarch64": `mybingwallpaper-${tag}-windows-arm64-setup.exe`,
  "darwin-x86_64": `mybingwallpaper-${tag}-macos-intel.app.tar.gz`,
  "darwin-aarch64": `mybingwallpaper-${tag}-macos-apple-silicon.app.tar.gz`,
});

const legacyPlatforms = new Set(["windows-i686", "windows-aarch64", "darwin-x86_64"]);

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function buildUpdaterManifest({ assetDir, tag, urlForAsset }) {
  const platforms = {};
  for (const [platform, fileName] of Object.entries(updaterPlatforms(tag))) {
    const assetPath = join(assetDir, fileName);
    const signaturePath = `${assetPath}.sig`;
    const [hasAsset, hasSignature] = await Promise.all([
      fileExists(assetPath),
      fileExists(signaturePath),
    ]);
    if (legacyPlatforms.has(platform) && !hasAsset && !hasSignature) continue;
    if (!hasAsset || !hasSignature) {
      throw new Error(`Missing updater asset or signature for ${platform}: ${fileName}`);
    }
    const signature = (await readFile(signaturePath, "utf8")).trim();
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
