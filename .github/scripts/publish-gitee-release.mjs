import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

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

const assets = (await readdir(assetDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => join(assetDir, entry.name))
  .sort();

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

const localNames = new Set(assets.map((asset) => basename(asset)));
const existing =
  (await giteeRequest(`/releases/${release.id}/attach_files?per_page=100`)) ?? [];
for (const attachment of existing) {
  if (!localNames.has(attachment.name)) continue;
  await giteeRequest(
    `/releases/${release.id}/attach_files/${attachment.id}`,
    { method: "DELETE" },
  );
  console.log(`Replaced existing attachment ${attachment.name}`);
}

for (const asset of assets) {
  const fileName = basename(asset);
  const form = new FormData();
  form.set("file", new Blob([await readFile(asset)]), fileName);
  await giteeRequest(`/releases/${release.id}/attach_files`, {
    method: "POST",
    body: form,
  });
  console.log(`Uploaded ${fileName}`);
}

console.log(`Published ${assets.length} installers to Gitee release ${tag}`);
