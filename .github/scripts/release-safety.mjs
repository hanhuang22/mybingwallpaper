import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export function releaseVersion(tag) {
  if (typeof tag !== "string" || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error("Release must use a stable vX.Y.Z tag, not a branch or arbitrary name");
  }
  return tag.slice(1);
}

export function compareVersions(left, right) {
  const a = releaseVersion(`v${left}`).split(".").map(BigInt);
  const b = releaseVersion(`v${right}`).split(".").map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export async function projectVersion(root = ".") {
  const [npm, npmLock, tauri, cargo, cargoLock] = await Promise.all([
    readFile(join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(join(root, "package-lock.json"), "utf8").then(JSON.parse),
    readFile(join(root, "src-tauri/tauri.conf.json"), "utf8").then(JSON.parse),
    readFile(join(root, "src-tauri/Cargo.toml"), "utf8"),
    readFile(join(root, "src-tauri/Cargo.lock"), "utf8"),
  ]);
  const versions = [
    npm.version, npmLock.version, npmLock.packages?.[""]?.version, tauri.version,
    cargo.match(/^\[package\]\s*\nname = "my-bing-wallpaper"\s*\nversion = "([^"]+)"/m)?.[1],
    cargoLock.match(/\[\[package\]\]\s*name = "my-bing-wallpaper"\s*version = "([^"]+)"/)?.[1],
  ];
  releaseVersion(`v${npm.version}`);
  if (!versions.every((version) => version === npm.version)) {
    throw new Error("Application version fields do not match");
  }
  return npm.version;
}

export function validateReleaseRef({ refType, tag, version }) {
  if (refType !== "tag") throw new Error("Release must run on a version tag; branch builds cannot publish");
  if (releaseVersion(tag) !== version) throw new Error("Release tag does not match the application version");
}

export function shouldPublishManifest(current, incoming) {
  releaseVersion(`v${incoming.version}`);
  if (!current) return true;
  try {
    return compareVersions(incoming.version, current.version) >= 0;
  } catch {
    // A valid release may repair an invalid manifest left by an older workflow.
    return true;
  }
}

export function manifestFromContents(contents) {
  if (!contents?.content || contents.encoding !== "base64") {
    throw new Error("Cannot verify the current updater manifest contents");
  }
  try {
    return JSON.parse(Buffer.from(contents.content, "base64").toString("utf8"));
  } catch {
    // Invalid JSON may be repaired, but unreadable API responses must not be overwritten.
    return null;
  }
}

export function autoReleasePlan({ testedSha, tagCommit, runs, tag }) {
  releaseVersion(tag);
  if (tagCommit && tagCommit !== testedSha) throw new Error(`${tag} points to a different commit`);
  const matching = runs.filter((run) => run.head_sha === testedSha && run.head_branch === tag);
  if (matching.some((run) => run.status !== "completed")) return { dispatch: false, reason: "Release already running" };
  if (matching.some((run) => run.conclusion === "success")) return { dispatch: false, reason: "Release already completed" };
  // An existing matching tag is not proof that workflow_dispatch succeeded.
  return { dispatch: true, createTag: !tagCommit };
}

async function localDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function attachmentMatches(attachment, path, fetchImpl = fetch) {
  const size = (await stat(path)).size;
  if (!attachment?.browser_download_url || Number(attachment.size) !== size) return false;
  const url = new URL(attachment.browser_download_url);
  if (url.protocol !== "https:") return false;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Cannot verify existing attachment (HTTP ${response.status})`);
  const hash = createHash("sha256");
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > size) {
      return false;
    }
    hash.update(chunk);
  }
  return received === size && hash.digest("hex") === await localDigest(path);
}
