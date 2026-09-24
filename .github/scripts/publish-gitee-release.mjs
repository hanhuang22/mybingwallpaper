import { execFile } from "node:child_process";
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { buildUpdaterManifest } from "./updater-manifest.mjs";

const execFileAsync = promisify(execFile);

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const token = required("GITEE_API_TOKEN");
const owner = required("GITEE_OWNER");
const repo = required("GITEE_REPO");
const tag = required("RELEASE_TAG");
const commit = required("RELEASE_COMMIT");
const assetDir = required("ASSET_DIR");
const apiBase = `https://gitee.com/api/v5/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

async function responseJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function giteeRequest(path, options = {}) {
  const method = options.method ?? "GET";
  const url = new URL(`${apiBase}${path}`);
  let body = options.body;

  if (method === "GET" || method === "DELETE") {
    url.searchParams.set("access_token", token);
  } else if (body instanceof URLSearchParams || body instanceof FormData) {
    body.set("access_token", token);
  }

  const response = await fetch(url, { method, body });
  const data = await responseJson(response);
  if (options.allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    const detail = data?.message ?? data?.error ?? response.statusText;
    throw new Error(`Gitee API ${method} ${path} failed (${response.status}): ${detail}`);
  }
  return data;
}

async function uploadAttachment(releaseId, filePath) {
  const fileName = basename(filePath);
  const args = [
    "--silent", "--show-error", "--fail", "--location", "--http1.1",
    "--connect-timeout", "20", "--max-time", "900",
    "--retry", "1", "--retry-all-errors", "--retry-delay", "10",
    "--write-out", "%{stderr}HTTP %{http_code}, sent %{size_upload} bytes in %{time_total}s\n",
    "--header", `Authorization: Bearer ${token}`,
    "--form", `access_token=${token}`,
    "--form", `owner=${owner}`,
    "--form", `repo=${repo}`,
    "--form", `release_id=${releaseId}`,
    "--form", `file=@${filePath};filename=${fileName}`,
    `${apiBase}/releases/${releaseId}/attach_files`,
  ];
  let output;
  try {
    const result = await execFileAsync("curl", args, { maxBuffer: 1024 * 1024 });
    output = result.stdout;
    console.log(`${fileName}: ${result.stderr.trim()}`);
  } catch (error) {
    // Do not include the command in logs: it contains the Gitee access token.
    throw new Error(`Gitee attachment upload failed for ${fileName} (curl exit ${error.code ?? "unknown"}): ${String(error.stderr ?? "").trim()}`);
  }
  let attachment;
  try {
    attachment = JSON.parse(output);
  } catch {
    throw new Error(`Gitee returned an invalid upload response for ${fileName}`);
  }
  if (!attachment?.browser_download_url) {
    throw new Error(`Gitee did not return a public download URL for ${fileName}`);
  }
  return attachment;
}

async function githubReleaseBody() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "mybingwallpaper-release-sync",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(
    `https://api.github.com/repos/hanhuang22/mybingwallpaper/releases/tags/${encodeURIComponent(tag)}`,
    { headers },
  );
  if (!response.ok) return `mybingwallpaper ${tag}\n\n请根据文件名选择适合当前系统和处理器架构的安装包。`;
  const release = await response.json();
  return release.body || `mybingwallpaper ${tag}`;
}

const assetPaths = (await readdir(assetDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(assetDir, entry.name))
  .filter((asset) => basename(asset) !== "latest.json");
const assets = (await Promise.all(assetPaths.map(async (path) => ({
  path,
  size: (await stat(path)).size,
}))))
  .sort((a, b) => a.size - b.size || a.path.localeCompare(b.path))
  .map(({ path }) => path);

if (assets.length === 0) throw new Error(`No release assets found in ${assetDir}`);

const releaseBody = await githubReleaseBody();
const releaseForm = new URLSearchParams({
  tag_name: tag,
  name: `mybingwallpaper ${tag}`,
  body: releaseBody,
  prerelease: "false",
  target_commitish: commit,
});

let release = await giteeRequest(`/releases/tags/${encodeURIComponent(tag)}`, {
  allowNotFound: true,
});
if (release) {
  release = await giteeRequest(`/releases/${release.id}`, {
    method: "PATCH",
    body: releaseForm,
  });
  console.log(`Updated Gitee release ${tag}`);
} else {
  release = await giteeRequest("/releases", {
    method: "POST",
    body: releaseForm,
  });
  console.log(`Created Gitee release ${tag}`);
}

const existing =
  (await giteeRequest(`/releases/${release.id}/attach_files?per_page=100`)) ?? [];
const existingByName = new Map(existing.map((attachment) => [attachment.name, attachment]));

const downloadUrls = new Map();
for (const asset of assets) {
  const fileName = basename(asset);
  const prior = existingByName.get(fileName);
  if (prior && Number(prior.size) === (await stat(asset)).size && prior.browser_download_url) {
    downloadUrls.set(fileName, prior.browser_download_url);
    console.log(`Kept existing ${fileName}`);
    continue;
  }
  if (prior) {
    await giteeRequest(`/releases/${release.id}/attach_files/${prior.id}`, { method: "DELETE" });
    console.log(`Removed outdated ${fileName}`);
  }
  console.log(`Uploading ${fileName}`);
  const attachment = await uploadAttachment(release.id, asset);
  downloadUrls.set(fileName, attachment.browser_download_url);
  console.log(`Uploaded ${fileName}`);
}

const updaterManifest = await buildUpdaterManifest({
  assetDir,
  tag,
  urlForAsset: (fileName) => {
    const url = downloadUrls.get(fileName);
    if (!url) throw new Error(`Missing Gitee download URL for ${fileName}`);
    return url;
  },
});
const updaterManifestPath = join(assetDir, "latest.json");
const updaterManifestContents = `${JSON.stringify(updaterManifest, null, 2)}\n`;
await writeFile(updaterManifestPath, updaterManifestContents);
const existingManifest = existingByName.get("latest.json");
if (existingManifest) {
  await giteeRequest(`/releases/${release.id}/attach_files/${existingManifest.id}`, { method: "DELETE" });
}
console.log("Uploading latest.json");
await uploadAttachment(release.id, updaterManifestPath);
console.log("Uploaded Gitee updater manifest");

async function publishUpdaterBranch() {
  const githubToken = required("GITHUB_TOKEN");
  const githubApi = "https://api.github.com/repos/hanhuang22/mybingwallpaper";
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "Content-Type": "application/json",
    "User-Agent": "mybingwallpaper-release-sync",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const request = async (path, options = {}) => {
    const response = await fetch(`${githubApi}${path}`, { ...options, headers });
    if (options.allowNotFound && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${path} failed (${response.status})`);
    return response.json();
  };

  let branch = await request("/git/ref/heads/updater", { allowNotFound: true });
  if (!branch) {
    branch = await request("/git/refs", {
      method: "POST",
      body: JSON.stringify({ ref: "refs/heads/updater", sha: commit }),
    });
  }
  const existing = await request("/contents/latest.json?ref=updater", { allowNotFound: true });
  await request("/contents/latest.json", {
    method: "PUT",
    body: JSON.stringify({
      message: `chore: update signed manifest for ${tag}`,
      content: Buffer.from(updaterManifestContents).toString("base64"),
      branch: "updater",
      ...(existing?.sha ? { sha: existing.sha } : {}),
    }),
  });
  console.log("Published Gitee-backed manifest to the updater branch");
}

await publishUpdaterBranch();
console.log(`Published ${assets.length} signed assets to Gitee release ${tag}`);
