import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const workflow = (name) => readFile(new URL(`../workflows/${name}.yml`, import.meta.url), "utf8");

test.each(["release", "repair-gitee-release", "gitee-sync"])("%s serializes all Gitee writes without replacing pending publishers", async (name) => {
  const source = await workflow(name);
  expect(source).toMatch(/concurrency:\n\s+group: gitee-release-publish\n\s+cancel-in-progress: false\n\s+queue: max/);
});

test("both release builders wait for tag and version validation", async () => {
  const source = await workflow("release");
  expect(source).toContain("run: node .github/scripts/validate-release.mjs");
  expect(source).toMatch(/\n  windows:\n    needs: validate\n/);
  expect(source).toMatch(/\n  macos:\n    needs: validate\n/);
});

test("auto release can reuse its matching existing tag and re-dispatch after failure", async () => {
  const source = await workflow("auto-release");
  expect(source).toContain("run: node .github/scripts/auto-release-candidate.mjs");
  expect(source).toContain('if [ "$CREATE_TAG" = "true" ]; then');
  expect(source).toContain('gh workflow run release.yml --ref "$TAG"');
  expect(source).not.toContain("already exists; skipping release");
  expect(source).toMatch(/group: auto-release-main\n\s+cancel-in-progress: false\n\s+queue: max/);
});
