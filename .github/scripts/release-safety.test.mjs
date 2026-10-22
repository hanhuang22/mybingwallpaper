import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, test, vi } from "vitest";
import {
  attachmentMatches, autoReleasePlan, compareVersions, manifestFromContents,
  projectVersion, releaseVersion, shouldPublishManifest, validateReleaseRef,
} from "./release-safety.mjs";

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory() {
  const path = await mkdtemp(join(tmpdir(), "mybingwallpaper-release-safety-"));
  temporaryDirectories.push(path);
  return path;
}

test.each(["main", "vmain", "1.2.7", "v1.2", "v01.2.7", "v1.2.7-beta.1", "v1.2.7\nmain"])("rejects unsafe release ref %s", (tag) => {
  expect(() => releaseVersion(tag)).toThrow("vX.Y.Z");
});

test("only a version tag matching all application versions can publish", () => {
  expect(releaseVersion("v1.2.7")).toBe("1.2.7");
  expect(() => validateReleaseRef({ refType: "branch", tag: "main", version: "1.2.7" })).toThrow("branch");
  expect(() => validateReleaseRef({ refType: "branch", tag: "v1.2.7", version: "1.2.7" })).toThrow("branch");
  expect(() => validateReleaseRef({ refType: "tag", tag: "v1.2.8", version: "1.2.7" })).toThrow("does not match");
  expect(() => validateReleaseRef({ refType: "tag", tag: "v1.2.7", version: "1.2.7" })).not.toThrow();
});

test("project version guard detects mismatched manifest or lock versions", async () => {
  const root = await directory();
  await mkdir(join(root, "src-tauri"));
  await Promise.all([
    writeFile(join(root, "package.json"), JSON.stringify({ version: "1.2.7" })),
    writeFile(join(root, "package-lock.json"), JSON.stringify({ version: "1.2.7", packages: { "": { version: "1.2.7" } } })),
    writeFile(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "1.2.7" })),
    writeFile(join(root, "src-tauri/Cargo.toml"), '[package]\nname = "my-bing-wallpaper"\nversion = "1.2.7"\n'),
    writeFile(join(root, "src-tauri/Cargo.lock"), '[[package]]\nname = "my-bing-wallpaper"\nversion = "1.2.7"\n'),
  ]);
  await expect(projectVersion(root)).resolves.toBe("1.2.7");
  await writeFile(join(root, "src-tauri/Cargo.lock"), '[[package]]\nname = "my-bing-wallpaper"\nversion = "1.2.6"\n');
  await expect(projectVersion(root)).rejects.toThrow("do not match");
});

test("repairing an older release never rolls back a newer updater manifest", () => {
  expect(shouldPublishManifest({ version: "1.2.7" }, { version: "1.2.6" })).toBe(false);
  expect(shouldPublishManifest({ version: "1.2.9" }, { version: "1.2.10" })).toBe(true);
  expect(shouldPublishManifest({ version: "1.2.7" }, { version: "1.2.7" })).toBe(true);
  expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
  expect(compareVersions("1.2.7", "1.2.7")).toBe(0);
  expect(shouldPublishManifest(null, { version: "1.2.7" })).toBe(true);
  expect(shouldPublishManifest({ version: "main" }, { version: "1.2.7" })).toBe(true);
  expect(() => shouldPublishManifest(null, { version: "main" })).toThrow();
});

test("unreadable API contents fail closed; malformed JSON can be repaired", () => {
  const content = Buffer.from(JSON.stringify({ version: "1.2.7" })).toString("base64");
  expect(manifestFromContents({ encoding: "base64", content })).toEqual({ version: "1.2.7" });
  expect(() => manifestFromContents({ sha: "old-sha" })).toThrow("Cannot verify");
  expect(manifestFromContents({ encoding: "base64", content: Buffer.from("broken-json").toString("base64") })).toBeNull();
});

const candidate = { tag: "v1.2.7", testedSha: "tested-commit", tagCommit: null, runs: [] };
test("auto release resumes after tag creation even if dispatch previously failed", () => {
  expect(autoReleasePlan(candidate)).toEqual({ dispatch: true, createTag: true });
  expect(autoReleasePlan({ ...candidate, tagCommit: candidate.testedSha })).toEqual({ dispatch: true, createTag: false });
  expect(() => autoReleasePlan({ ...candidate, tagCommit: "different-commit" })).toThrow("different commit");
});

test("auto release does not duplicate active or completed releases but retries failures", () => {
  const run = { head_sha: candidate.testedSha, head_branch: candidate.tag, status: "queued", conclusion: null };
  expect(autoReleasePlan({ ...candidate, runs: [run] }).dispatch).toBe(false);
  expect(autoReleasePlan({ ...candidate, runs: [{ ...run, status: "completed", conclusion: "success" }] }).dispatch).toBe(false);
  for (const conclusion of ["failure", "cancelled", "timed_out"]) {
    expect(autoReleasePlan({ ...candidate, tagCommit: candidate.testedSha, runs: [{ ...run, status: "completed", conclusion }] })).toEqual({ dispatch: true, createTag: false });
  }
  expect(autoReleasePlan({ ...candidate, runs: [{ ...run, head_branch: "main" }] }).dispatch).toBe(true);
});

async function fixture(bytes = "new-data") {
  const root = await directory();
  const path = join(root, "installer.exe");
  await writeFile(path, bytes);
  return { path, attachment: { size: Buffer.byteLength(bytes), browser_download_url: "https://example.test/installer.exe" } };
}

test("same filename and size are not sufficient to reuse an attachment", async () => {
  const { path, attachment } = await fixture();
  const fetchImpl = vi.fn(async () => new Response("old-data"));
  await expect(attachmentMatches(attachment, path, fetchImpl)).resolves.toBe(false);
  await expect(attachmentMatches(attachment, path, async () => new Response("new-data"))).resolves.toBe(true);
  expect(fetchImpl).toHaveBeenCalledOnce();
});

test("changed metadata skips verification download and truncated/oversized bodies are rejected", async () => {
  const { path, attachment } = await fixture();
  const fetchImpl = vi.fn();
  await expect(attachmentMatches({ ...attachment, size: 1 }, path, fetchImpl)).resolves.toBe(false);
  await expect(attachmentMatches({ ...attachment, browser_download_url: "http://example.test/file" }, path, fetchImpl)).resolves.toBe(false);
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(attachmentMatches(attachment, path, async () => new Response("short"))).resolves.toBe(false);
  await expect(attachmentMatches(attachment, path, async () => new Response("too much data"))).resolves.toBe(false);
});

test("verification failures preserve the existing attachment instead of accepting unverified bytes", async () => {
  const { path, attachment } = await fixture();
  await expect(attachmentMatches(attachment, path, async () => new Response("error", { status: 503 }))).rejects.toThrow("HTTP 503");
  await expect(attachmentMatches(attachment, path, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
});
