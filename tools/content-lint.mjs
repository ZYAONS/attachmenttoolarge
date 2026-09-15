#!/usr/bin/env node
/* ==========================================================================
   content-lint.mjs — 写给"写故事的人"的检查器

   它不判断故事好不好，只判断规则有没有破。跑一次就知道：
     · 还有哪几天没写
     · 哪一题少了一个选项、或 safe/drift 配错了
     · 哪一天的物件 id 在 objects 里不存在
     · 第一幕（1–14 天）的漂移预算有没有超

   用法： node tools/content-lint.mjs
   ========================================================================== */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = {};
new Function("window", readFileSync(join(ROOT, "game", "content.js"), "utf8"))(sandbox);
const C = sandbox.UNDERSTUDY_CONTENT;
if (!C) { console.error("content.js 没有导出 UNDERSTUDY_CONTENT"); process.exit(1); }

const problems = [];
const notes = [];
const warn = (m) => problems.push(m);
const info = (m) => notes.push(m);

const objectIds = new Set(Object.keys(C.objects || {}));
const bands = (C.meta && C.meta.driftBands) || { mixed: 30, yours: 65 };

/* ---------- 1. 每天的形状 ---------- */
const written = [], todo = [];
(C.days || []).forEach((d) => checkDay(d, "days 数组"));
Object.keys(C.pendingDays || {}).forEach((k) => {
  const d = C.pendingDays[k];
  if (typeof d !== "object") { warn("pendingDays." + k + " 应该是一个对象（就地可填的一天），现在还是字符串"); return; }
  if (d.todo) { todo.push(k + "（" + (d.note || "没有备注") + "）"); }
  checkDay(Object.assign({ n: Number(k) }, d), "pendingDays." + k);
});

function checkDay(d, where) {
  const tag = where + " / 第 " + d.n + " 天";
  if (where === "days 数组") written.push(d.n);
  /* 物件 id */
  (d.searchObjects || []).forEach((id) => {
    if (!objectIds.has(id)) warn(tag + "：物件 id「" + id + "」在 objects 里不存在");
  });
  if ((d.searchObjects || []).length !== ((d.searchObjects || []).length)) warn(tag + "：searchObjects 不是数组");
  const goal = d.searchGoal || 0;
  const marked = (d.searchObjects || []).filter((id) => {
    const o = Object.assign({}, C.objects[id] || {}, (d.objectsOverride || {})[id] || {});
    return o.birthday;
  }).length;
  if (goal > 0 && marked !== goal) {
    warn(tag + "：searchGoal = " + goal + "，但标了 birthday 的物件有 " + marked + " 件");
  }
  /* 每一题 */
  const qs = (d.meeting && d.meeting.questions) || [];
  if (!qs.length) warn(tag + "：一个会面问题都没有");
  qs.forEach((q, qi) => {
    const label = tag + " 第 " + (qi + 1) + " 问";
    if (!q.q) warn(label + "：没有问句");
    const chips = q.chips || [];
    if (chips.length !== 3) warn(label + "：必须正好三个选项，现在是 " + chips.length + " 个");
    const safeCount = chips.filter((c) => c.safe === true).length;
    const risky = chips.filter((c) => c.safe === false);
    const unknown = chips.filter((c) => c.safe === null).length;
    /* 规则不是"每种各一个"—— 那样太死，写起来会为了凑数而写废话。
       真正要紧的是：有安全路径可选、风险的都带 drift、trap 题才是三个无记录。 */
    if (q.trap) {
      if (safeCount || risky.length) warn(label + "：标了 trap，三个选项都应当是 safe:null（档案里没有答案）");
    } else {
      if (safeCount !== 1) warn(label + "：应当正好有一个 safe:true（他真会这么说的一句）");
      if (!risky.length) warn(label + "：至少要有一个 safe:false（有代价的选项）");
      if (unknown > 1) info(label + "：有 " + unknown + " 个「档案里没有答案」的选项 —— 如果不是故意设计，考虑收成一个");
    }
    risky.forEach((c, i) => {
      if (!(c.drift > 0)) warn(label + "：风险选项 #" + (i + 1) + " 没有填 drift（必须大于 0）");
      if (c.drift > 20) warn(label + "：风险选项 #" + (i + 1) + " 的 drift " + c.drift + " 太高（15 以上只留给真正致命的错）");
    });
    chips.forEach((c, i) => {
      if (!c.t) warn(label + "：选项 #" + (i + 1) + " 没有文字");
      if (!c.note) warn(label + "：选项 #" + (i + 1) + " 没有 note（账本里会显示为什么）");
      if (/好|坏|糟糕|正确|错误|应该/.test(c.note || "")) {
        info(label + "：选项 #" + (i + 1) + " 的 note 像是评价而非原因 —— 参考 CONTENT-GUIDE 的六条基调");
      }
    });
  });
  /* 删改 */
  if (d.redaction) {
    const os = d.redaction.options || [];
    if (os.length < 2) warn(tag + "：删改环节至少要有两个选项");
    if (!os.some((o) => o.gap > 0)) warn(tag + "：删改环节里没有一个选项留下档案缺口 —— 那样「删掉」就是免费的");
    if (!os.some((o) => (o.drift || 0) < 0)) warn(tag + "：删改环节里没有一个选项降低漂移");
  }
  /* 信 */
  if (d.letter) {
    if (!(d.letter.paragraphs || []).length) warn(tag + "：信里没有正文");
    if (!(d.letter.choices || []).length) warn(tag + "：信没有给选择");
  }
}

/* ---------- 2. 漂移预算（第一幕 1–14 天） ---------- */
function actDrift(from, to) {
  let total = 0;
  (C.days || []).concat(Object.keys(C.pendingDays || {}).map((k) => C.pendingDays[k]))
    .filter((d) => d && d.n >= from && d.n <= to && !d.todo)   // 占位日子不计入预算
    .forEach((d) => {
      ((d.meeting && d.meeting.questions) || []).forEach((q) => {
        /* 最轻路径 = 每一题都挑代价最小的那个选项（安全选项本来就是 0），
           之前只对"风险选项"取最小值，等于假设玩家每句都要犯错 —— 那算出来的不是下限。 */
        const drifts = (q.chips || []).map((c) => (c.safe === true ? 0 : (c.drift || 0)));
        if (drifts.length) total += Math.min.apply(null, drifts);
      });
      if (d.letter) {
        const ds = (d.letter.choices || []).map((c) => c.drift || 0);
        if (ds.length) total += Math.min.apply(null, ds);
      }
    });
  return total;
}
const firstActMin = actDrift(1, 14);
if (firstActMin > bands.mixed) {
  warn("第一幕已写部分的最轻路径累计漂移是 " + firstActMin + "%，已经越过第一道坎（" + bands.mixed + "%）—— 大额代价应当留给第 37 天那类不可回避的抉择");
}

/* ---------- 3. 输出 ---------- */
console.log("UNDERSTUDY 内容检查\n");
console.log("已写：" + written.length + " 天　待写：" + todo.length + " 天");
if (todo.length) {
  console.log("\n待人工撰写（就地填 pendingDays 里的对象即可）：");
  todo.forEach((t) => console.log("  · 第 " + t));
}
console.log("\n第一幕【已写部分】的最轻路径漂移合计：" + firstActMin + "%（第一道坎 " + bands.mixed + "%）");
if (notes.length) {
  console.log("\n建议（不影响运行）：");
  notes.forEach((n) => console.log("  · " + n));
}
if (problems.length) {
  console.log("\n必须修的 " + problems.length + " 处：");
  problems.forEach((p) => console.log("  ✗ " + p));
  process.exit(1);
}
console.log("\n规则上没有硬伤。故事是你的。");
