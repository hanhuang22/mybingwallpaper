import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { buildUpdaterManifest, updaterPlatforms } from "./updater-manifest.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function createAssets(tag, platforms) {
  const assetDir = await mkdtemp(join(tmpdir(), "mybingwallpaper-updater-"));
  temporaryDirectories.push(assetDir);
  const fileNames = updaterPlatforms(tag);
  for (const platform of platforms) {
    const fileName = fileNames[platform];
    await writeFile(join(assetDir, fileName), "installer");
    await writeFile(join(assetDir, `${fileName}.sig`), `signature-${platform}`);
  }
  return assetDir;
}

const currentPlatforms = ["windows-x86_64", "darwin-aarch64"];

test("new releases only include Windows x64 and Apple Silicon macOS", async () => {
  const tag = "v1.0.2";
  const assetDir = await createAssets(tag, currentPlatforms);
  const manifest = await buildUpdaterManifest({
    assetDir,
    tag,
    urlForAsset: (name) => `https://example.test/${name}`,
  });
  expect(Object.keys(manifest.platforms)).toEqual(currentPlatforms);
});

test("repairing an older release retains its legacy updater entries", async () => {
  const tag = "v1.0.1";
  const assetDir = await createAssets(tag, Object.keys(updaterPlatforms(tag)));
  const manifest = await buildUpdaterManifest({
    assetDir,
    tag,
    urlForAsset: (name) => `https://example.test/${name}`,
  });
  expect(Object.keys(manifest.platforms)).toEqual(Object.keys(updaterPlatforms(tag)));
});

test("missing required signature fails the release manifest", async () => {
  const tag = "v1.0.2";
  const assetDir = await createAssets(tag, currentPlatforms);
  const windowsSignature = join(assetDir, `${updaterPlatforms(tag)["windows-x86_64"]}.sig`);
  await rm(windowsSignature);
  await expect(buildUpdaterManifest({
    assetDir,
    tag,
    urlForAsset: (name) => `https://example.test/${name}`,
  })).rejects.toThrow("Missing updater asset or signature for windows-x86_64");
});
