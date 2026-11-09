/**
 * `acf usage`: where Claude Code tokens go, read from the session transcripts Claude Code keeps
 * in ~/.claude/projects. No model is called and nothing leaves the machine.
 *
 * In long sessions the money goes to re-sending the conversation: every request carries all of
 * it. Savings tools shrink tool output, a small slice of that, so this report shows the drivers
 * that matter more: context size per request, the fixed prompt, and session length.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { autoCompactStatus, describeAutoCompact } from './compaction.js';

// Relative prices at the standard Claude ratios (input = 1). Not dollars: those vary by model.
export const WEIGHTS = { input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2, output: 5 };
const LONG_SESSION_REQUESTS = 100;
const BIG_CONTEXT = 200_000;

/** The folder Claude Code keeps a project's transcripts in. */
export function projectTranscriptDir(projectDir, home = os.homedir()) {
  return path.join(home, '.claude', 'projects', projectDir.replace(/[^a-zA-Z0-9]/g, '-'));
}

/** Metrics for one transcript, or null when it has no main-conversation requests. */
export function analyzeTranscript(file) {
  const seen = new Set();
  const requests = [];
  let compactions = 0;
  let start = null;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (line.includes('"compact_boundary"')) compactions += 1;
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const usage = entry.message?.usage;
    // Each content block of a response is logged with the same usage; count the response once
    if (entry.type !== 'assistant' || entry.isSidechain || !usage || seen.has(entry.message.id)) continue;
    seen.add(entry.message.id);
    start ??= entry.timestamp;
    const write = usage.cache_creation_input_tokens || 0;
    const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    requests.push({
      input: usage.input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite5m: write - write1h,
      cacheWrite1h: write1h,
      output: usage.output_tokens || 0
    });
  }
  if (requests.length === 0) return null;
  const sum = (key) => requests.reduce((total, r) => total + r[key], 0);
  const context = requests.map((r) => r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h);
  const tokens = Object.fromEntries(Object.keys(WEIGHTS).map((key) => [key, sum(key)]));
  const cost = Object.fromEntries(Object.entries(tokens).map(([key, n]) => [key, n * WEIGHTS[key]]));
  return {
    file,
    start,
    requests: requests.length,
    firstPrompt: context[0],
    averageContext: Math.round(context.reduce((a, b) => a + b, 0) / context.length),
    peakContext: Math.max(...context),
    compactions,
    tokens,
    cost,
    totalCost: Object.values(cost).reduce((a, b) => a + b, 0)
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * Sessions of one project (or all projects) modified in the last `days` days, with totals.
 */
export function buildUsageReport({ projectDir = process.cwd(), all = false, days = 30, home = os.homedir() } = {}) {
  const root = path.join(home, '.claude', 'projects');
  const dirs = all
    ? (fs.existsSync(root) ? fs.readdirSync(root).map((d) => path.join(root, d)) : [])
    : [projectTranscriptDir(projectDir, home)];
  const since = Date.now() - days * 86_400_000;
  const sessions = [];
  for (const dir of dirs.filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory())) {
    for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const file = path.join(dir, name);
      if (fs.statSync(file).mtimeMs < since) continue;
      const session = analyzeTranscript(file);
      if (session) sessions.push({ ...session, project: path.basename(dir) });
    }
  }
  const totals = Object.fromEntries(Object.keys(WEIGHTS).map((key) => [key, 0]));
  for (const s of sessions) for (const key of Object.keys(totals)) totals[key] += s.cost[key];
  const totalCost = Object.values(totals).reduce((a, b) => a + b, 0);
  const long = sessions.filter((s) => s.requests >= LONG_SESSION_REQUESTS);
  return {
    days,
    sessions,
    requests: sessions.reduce((a, s) => a + s.requests, 0),
    share: Object.fromEntries(Object.entries(totals).map(([key, c]) => [key, totalCost ? c / totalCost : 0])),
    medianFirstPrompt: median(sessions.map((s) => s.firstPrompt)),
    medianAverageContext: median(sessions.map((s) => s.averageContext)),
    longSessions: long.length,
    longAverageContext: long.length ? Math.round(long.reduce((a, s) => a + s.averageContext, 0) / long.length) : 0,
    peakContext: Math.max(0, ...sessions.map((s) => s.peakContext)),
    bigSessions: sessions.filter((s) => s.peakContext > BIG_CONTEXT).length,
    compactions: sessions.reduce((a, s) => a + s.compactions, 0),
    compaction: autoCompactStatus(projectDir, { home })
  };
}

const k = (n) => `${Math.round(n / 1000)}k`;
const pct = (x) => `${Math.round(x * 100)}%`;

/** Plain-text report, with suggestions only where the numbers call for them. */
export function formatUsageReport(report, { scope = 'this project' } = {}) {
  if (report.sessions.length === 0) {
    return `No Claude Code sessions for ${scope} in the last ${report.days} days (read from ~/.claude/projects).`;
  }
  const { share } = report;
  const lines = [
    `Claude Code usage for ${scope}, last ${report.days} days: ${report.sessions.length} sessions, ${report.requests.toLocaleString('en-US')} requests.`,
    'Read from ~/.claude/projects; no model call. Shares use standard price ratios, not dollars.',
    '',
    `  Where the cost goes   re-sent context ${pct(share.cacheRead)} · cache writes ${pct(share.cacheWrite5m + share.cacheWrite1h)} · output ${pct(share.output)} · fresh input ${pct(share.input)}`,
    `  Fixed prompt          ~${k(report.medianFirstPrompt)} tokens on a session's first request (median)`,
    `  Context per request   median session ${k(report.medianAverageContext)}` +
      (report.longSessions ? `; sessions of ${LONG_SESSION_REQUESTS}+ requests average ${k(report.longAverageContext)}` : '') +
      `; largest ${k(report.peakContext)}`,
    `  Compactions           ${report.compactions} in ${report.sessions.length} sessions; ${report.bigSessions} sessions passed ${k(BIG_CONTEXT)} tokens`,
    '',
    '  Costliest sessions    start        requests  avg context  peak    share'
  ];
  const total = report.sessions.reduce((a, s) => a + s.totalCost, 0);
  for (const s of [...report.sessions].sort((a, b) => b.totalCost - a.totalCost).slice(0, 5)) {
    lines.push(
      `                        ${(s.start || '').slice(0, 10).padEnd(12)} ${String(s.requests).padStart(8)}  ${k(s.averageContext).padStart(11)}  ${k(s.peakContext).padStart(6)}  ${pct(s.totalCost / total).padStart(5)}` +
        (scope === 'all projects' ? `  ${s.project}` : '')
    );
  }
  const tips = [];
  if (share.cacheRead > 0.4) {
    tips.push(
      `Re-sent context is the largest cost. It grows with context size x requests: /clear between tasks (save a note first) and /compact within a long one.`
    );
  }
  if (!report.compaction.enabled) {
    tips.push(`Auto-compaction is ${describeAutoCompact(report.compaction)}, so sessions grow until you compact by hand.`);
  }
  if (report.medianFirstPrompt > 40_000) {
    tips.push(
      `The fixed prompt is ~${k(report.medianFirstPrompt)} before any work (bare Claude Code is ~17k). Run /context to see it; MCP servers, plugins and skill packs you don't use in this project add to every request.`
    );
  }
  if (tips.length) lines.push('', '  Worth trying', ...tips.map((t) => `  - ${t}`));
  return lines.join('\n');
}

/** Entry point for `acf usage [--all] [--days N] [--json]`. */
export function runUsage(args) {
  const all = args.includes('--all');
  const daysAt = args.indexOf('--days');
  const days = daysAt >= 0 ? Number(args[daysAt + 1]) || 30 : 30;
  const report = buildUsageReport({ all, days });
  if (args.includes('--json')) {
    console.log(JSON.stringify({ ...report, sessions: report.sessions.map(({ file, ...s }) => s) }, null, 2));
  } else {
    console.log(formatUsageReport(report, { scope: all ? 'all projects' : 'this project' }));
  }
}
