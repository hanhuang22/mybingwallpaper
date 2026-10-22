import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { autoReleasePlan, projectVersion } from "./release-safety.mjs";

const testedSha = process.env.TESTED_SHA;
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
if (!testedSha || !repository || !token || !process.env.GITHUB_OUTPUT) throw new Error("Missing auto-release environment");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const mainSha = git("ls-remote", "--exit-code", "origin", "refs/heads/main").split(/\s+/)[0];
if (mainSha !== testedSha) {
  console.log("A newer main commit exists; skipping this build.");
} else {
  const tag = `v${await projectVersion()}`;
  const refs = git("ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
    .split("\n").filter(Boolean).map((line) => line.split(/\s+/));
  const tagCommit = refs.find(([, ref]) => ref.endsWith("^{}"))?.[0] ?? refs[0]?.[0];
  const query = new URLSearchParams({ head_sha: testedSha, per_page: "100" });
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/release.yml/runs?${query}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "mybingwallpaper-auto-release" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Cannot check existing Release runs (${response.status})`);
  const { workflow_runs: runs } = await response.json();
  const plan = autoReleasePlan({ testedSha, tagCommit, runs, tag });
  if (plan.dispatch) {
    await appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\nshould_release=true\ncreate_tag=${plan.createTag}\n`);
    console.log(`${plan.createTag ? "Create" : "Reuse"} ${tag} and dispatch Release`);
  } else {
    console.log(plan.reason);
  }
}
