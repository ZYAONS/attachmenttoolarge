// 盯两个仓库的流水线直到跑完，把结论（含失败任务日志摘要）写成报告
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const token = execSync("git credential fill", { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" })
  .split("\n").find((l) => l.startsWith("password=")).slice(9).trim();
const HD = { Authorization: `Bearer ${token}`, "User-Agent": "att", Accept: "application/vnd.github+json" };
const REPOS = ["attachment-too-large/attachmenttoolarge", "attachment-too-large/att-tools"];

const api = async (p) => (await fetch("https://api.github.com" + p, { headers: HD })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

async function latestRun(repo) {
  const runs = await api(`/repos/${repo}/actions/runs?per_page=10`);
  return (runs.workflow_runs || []).find((x) => x.path === ".github/workflows/release.yml");
}

let done = false;
for (let i = 0; i < 100 && !done; i++) {
  done = true;
  for (const repo of REPOS) {
    const x = await latestRun(repo);
    if (!x || x.status !== "completed") { done = false; break; }
  }
  if (!done) await sleep(15000);
}

for (const repo of REPOS) {
  say(`\n=== ${repo} ===`);
  const x = await latestRun(repo);
  if (!x) { say("  (no run)"); continue; }
  say(`  run #${x.run_number} · ${x.head_sha.slice(0, 7)} · ${x.status}/${x.conclusion}`);
  say(`  ${x.html_url}`);
  const jobs = await api(`/repos/${repo}/actions/runs/${x.id}/jobs`);
  for (const j of jobs.jobs || []) {
    const state = j.conclusion || j.status;
    const mark = state === "success" ? "OK " : state === "failure" ? "BAD" : state === "skipped" ? "-  " : "...";
    say(`    ${mark} ${j.name}  [${state}]`);
  }
  for (const j of (jobs.jobs || []).filter((j) => j.conclusion === "failure")) {
    say(`  --- failing log: ${j.name} ---`);
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${j.id}/logs`, { headers: HD, redirect: "follow" });
    const text = await res.text();
    const hits = text.split("\n").filter((l) => /error|FAIL|fatal|not found|denied|cannot|Command failed|npm ERR|Killed|zsh:/i.test(l));
    for (const h of hits.slice(-12)) say("      " + h.replace(/^\S+Z\s*/, "").trim().slice(0, 140));
  }
}

writeFileSync("ci-report.txt", lines.join("\n"), "utf8");
say("\nreport written to ci-report.txt");
