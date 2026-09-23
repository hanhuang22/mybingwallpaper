import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildUpdaterManifest } from "./updater-manifest.mjs";

const assetDir = process.env.ASSET_DIR;
const tag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY;
if (!assetDir || !tag || !repository) {
  throw new Error("ASSET_DIR, RELEASE_TAG and GITHUB_REPOSITORY are required");
}

const manifest = await buildUpdaterManifest({
  assetDir,
  tag,
  urlForAsset: (fileName) =>
    `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(fileName)}`,
});

await writeFile(join(assetDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated updater manifest for ${Object.keys(manifest.platforms).length} platforms`);
