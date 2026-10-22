import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test } from "vitest";
import { buildUpdaterManifest, updaterPlatforms } from "./updater-manifest.mjs";
import { attachmentMatches, manifestFromContents, releaseVersion, shouldPublishManifest } from "./release-safety.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function runPublisher({ currentVersion, stalePackage = false }) {
  const tag = "v1.2.7";
  const root = await mkdtemp(join(tmpdir(), "mybingwallpaper-publisher-"));
  directories.push(root);
  const winName = updaterPlatforms(tag)["windows-x86_64"];
  const macName = updaterPlatforms(tag)["darwin-aarch64"];
  for (const name of [winName, macName]) {
    await writeFile(join(root, name), "new-data");
    await writeFile(join(root, `${name}.sig`), `signature-${name}`);
  }
  const attachments = stalePackage
    ? [{ id: 9, name: winName, size: 8, browser_download_url: "https://downloads.example.test/old-package" }]
    : [];
  const bodies = new Map([["https://downloads.example.test/old-package", Buffer.from("old-data")]]);
  const uploads = [];
  const branchWrites = [];
  const deleted = [];
  let nextId = 10;
  const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const contents = { encoding: "base64", sha: "current-blob", content: Buffer.from(JSON.stringify({ version: currentVersion })).toString("base64") };
  const fetchMock = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? "GET";
    if (url.hostname === "downloads.example.test") {
      const bytes = bodies.get(url.href);
      if (!bytes) throw new Error(`Missing fake attachment: ${url.href}`);
      return new Response(bytes);
    }
    if (url.hostname === "api.github.com") {
      if (url.pathname.includes("/releases/tags/")) return response({ body: "Release notes" });
      if (url.pathname.endsWith("/git/ref/heads/updater")) return response({ object: { sha: "updater-commit" } });
      if (url.pathname.endsWith("/contents/latest.json")) {
        if (method === "GET") return response(contents);
        branchWrites.push({ host: "github", body: JSON.parse(options.body) });
        return response({});
      }
    }
    if (url.hostname === "gitee.com") {
      if (url.pathname.endsWith("/contents/latest.json")) {
        if (method === "GET") return response(contents);
        branchWrites.push({ host: "gitee", body: Object.fromEntries(options.body) });
        return response({});
      }
      if (method === "DELETE") {
        deleted.push(Number(url.pathname.split("/").at(-1)));
        return response({});
      }
      if (url.pathname.endsWith("/attach_files")) return response(attachments);
      if (url.pathname.includes("/releases/")) return response({ id: 1 });
    }
    throw new Error(`Unexpected API: ${method} ${url}`);
  };
  // Intercept the curl transport too: tests execute the production publisher but
  // no child processes, real credentials or external API writes are possible.
  const upload = async (_command, args) => {
    const file = args.find((arg) => arg.startsWith("file=@"));
    const [, path, name] = /^file=@(.*);filename=(.*)$/.exec(file);
    const bytes = await readFile(path);
    const attachment = { id: nextId++, name, size: bytes.length, browser_download_url: `https://downloads.example.test/${nextId}/${name}` };
    bodies.set(attachment.browser_download_url, bytes);
    uploads.push(attachment);
    return { stdout: JSON.stringify(attachment), stderr: "HTTP 200" };
  };
  const source = (await readFile(new URL("./publish-gitee-release.mjs", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction(
    "execFile", "readdir", "stat", "writeFile", "basename", "join", "promisify", "buildUpdaterManifest",
    "attachmentMatches", "manifestFromContents", "releaseVersion", "shouldPublishManifest", "process", "fetch", "console", source,
  )(
    () => { throw new Error("Real subprocesses are forbidden in this test"); },
    readdir, stat, writeFile, basename, join, () => upload, buildUpdaterManifest,
    (attachment, path) => attachmentMatches(attachment, path, fetchMock), manifestFromContents, releaseVersion, shouldPublishManifest,
    { env: { GITEE_API_TOKEN: "fake-test-token", GITHUB_TOKEN: "fake-test-token", GITEE_OWNER: "owner", GITEE_REPO: "repo", RELEASE_TAG: tag, RELEASE_COMMIT: "commit", ASSET_DIR: root } },
    fetchMock, { log() {} },
  );
  return { uploads, branchWrites, deleted, winName, bodies, manifest: JSON.parse(await readFile(join(root, "latest.json"), "utf8")) };
}

test("repairing an old release uploads its files without replacing either newer updater branch", async () => {
  const result = await runPublisher({ currentVersion: "1.2.8" });
  expect(result.uploads).toHaveLength(5);
  expect(result.branchWrites).toEqual([]);
  expect(result.manifest.version).toBe("1.2.7");
});

test("a same-sized stale Gitee package is replaced before publishing its new signature manifest", async () => {
  const result = await runPublisher({ currentVersion: "1.2.7", stalePackage: true });
  expect(result.deleted).toContain(9);
  const replacement = result.uploads.find((item) => item.name === result.winName);
  expect(replacement).toBeDefined();
  expect(result.bodies.get(replacement.browser_download_url).toString()).toBe("new-data");
  expect(result.manifest.platforms["windows-x86_64"].url).toBe(replacement.browser_download_url);
  expect(result.branchWrites.map((write) => write.host)).toEqual(["github", "gitee"]);
});
