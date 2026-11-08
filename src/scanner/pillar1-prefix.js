import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findHook, hookCommands, loadSettingsLayers, projectScriptStatus } from './settings.js';

// Claude Code follows `@path` imports in memory files up to this many hops
const MAX_IMPORT_DEPTH = 5;

/**
 * Collects a memory file and every file it imports with `@path`, the way Claude Code loads
 * them into context. Imports inside code spans and fenced code blocks are ignored.
 *
 * @returns {{file: string, content: string}[]} Absolute paths and contents, in load order
 */
export function loadWithImports(file, depth = 0, seen = new Set()) {
  const resolved = fs.realpathSync(file);
  if (seen.has(resolved)) return [];
  seen.add(resolved);

  const content = fs.readFileSync(file, 'utf-8');
  const parts = [{ file, content }];
  if (depth >= MAX_IMPORT_DEPTH) return parts;

  const prose = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const match of prose.matchAll(/(?:^|\s)@([^\s@]+)/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      parts.push(...loadWithImports(target, depth + 1, seen));
    }
  }
  return parts;
}

/**
 * Tracked files and an ignore check for the repo, or null outside git. Tracked paths cover
 * sparse checkouts, and package-relative mentions in monorepos.
 */
function gitPaths(projectDir) {
  try {
    const tracked = execSync('git ls-files', { cwd: projectDir, encoding: 'utf-8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n')
      .filter(Boolean);
    const isIgnored = (rel) => {
      try {
        execSync(`git check-ignore -q -- ${JSON.stringify(rel)}`, { cwd: projectDir, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    };
    return { tracked, isIgnored };
  } catch {
    return null;
  }
}

/**
 * Whether a path mentioned in Tier-1 context exists: on disk, as a tracked file or directory,
 * as a package-relative path in a monorepo (`src/cli/x.ts` for `packages/a/src/cli/x.ts`), or as
 * git-ignored generated output (`.next/`).
 */
function pathExists(projectDir, rawPath, repo) {
  if (fs.existsSync(path.resolve(projectDir, rawPath))) return true;
  if (!repo) return false;
  const token = rawPath.replace(/^\.\//, '');
  const rel = token.replace(/\/$/, '');
  return (
    repo.tracked.some((f) => f === rel || f.startsWith(`${rel}/`) || f.endsWith(`/${rel}`) || f.includes(`/${rel}/`)) ||
    // Keep a trailing slash: a directory-only pattern like `.next/` can't match a path that
    // doesn't exist unless git is told it names a directory
    repo.isIgnored(token)
  );
}

/**
 * Audits Pillar 1: Prefix Stability
 * Max score: 30 points
 */
export function auditPillar1(projectDir) {
  let score = 0;
  const maxScore = 30;
  const findings = [];

  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
  const agentsMdPath = path.join(projectDir, 'AGENTS.md');
  const hasClaudeMd = fs.existsSync(claudeMdPath);
  const hasAgentsMd = fs.existsSync(agentsMdPath);

  // 1. Existence check (6 pts)
  if (hasClaudeMd || hasAgentsMd) {
    score += 6;
    findings.push({
      status: 'pass',
      title: 'Tier-1 Root Context File Present',
      description: `Found ${hasClaudeMd ? 'CLAUDE.md' : ''}${hasClaudeMd && hasAgentsMd ? ' and ' : ''}${hasAgentsMd ? 'AGENTS.md' : ''}.`
    });
  } else {
    findings.push({
      status: 'fail',
      title: 'No Tier-1 Context File Found',
      description: 'Neither CLAUDE.md nor AGENTS.md was found in the repository root. Agents have no static instruction anchor.'
    });
    return { score: 0, maxScore, findings, stats: null };
  }

  // 2. Line count & compactness check (8 pts). Claude Code reads CLAUDE.md when it exists
  //    (AGENTS.md otherwise), plus everything it imports.
  const targetFile = hasClaudeMd ? claudeMdPath : agentsMdPath;
  const parts = loadWithImports(targetFile);
  const content = parts.map((part) => part.content).join('\n');
  const lineCount = parts.reduce((sum, part) => sum + part.content.split('\n').length, 0);
  const estimatedTokens = Math.round(content.length / 4);
  const loadedNames = parts.map((part) => path.relative(projectDir, part.file)).join(' + ');

  // With both files present, Claude Code reads only CLAUDE.md unless it imports AGENTS.md
  if (hasClaudeMd && hasAgentsMd) {
    const agentsLoaded = parts.some((part) => fs.realpathSync(part.file) === fs.realpathSync(agentsMdPath));
    if (!agentsLoaded) {
      findings.push({
        status: 'warn',
        title: 'AGENTS.md Is Not Loaded by Claude Code',
        description:
          'When CLAUDE.md exists, Claude Code reads it instead of AGENTS.md. Add `@AGENTS.md` to CLAUDE.md if its instructions should apply.'
      });
    }
  }

  if (lineCount <= 150) {
    score += 8;
    findings.push({
      status: 'pass',
      title: `Tier-1 Context is Compact (${lineCount} lines / ~${estimatedTokens} tokens in ${loadedNames})`,
      description: 'File is well under the 150-line threshold. It is re-sent on every turn, so every line costs tokens and attention.'
    });
  } else if (lineCount <= 250) {
    score += 4;
    findings.push({
      status: 'warn',
      title: `Tier-1 Context is Moderate (${lineCount} lines / ~${estimatedTokens} tokens in ${loadedNames})`,
      description: 'Approaching the recommended 150-line ceiling. Consider offloading domain rules to Tier-2 on-demand files.'
    });
  } else {
    findings.push({
      status: 'fail',
      title: `Tier-1 Context is Bloated (${lineCount} lines / ~${estimatedTokens} tokens in ${loadedNames})`,
      description: 'Exceeds 250 lines. A large root prefix is re-sent on every turn, costing tokens and diluting the instructions that matter.'
    });
  }

  // 3. Volatile markers check (8 pts)
  const volatileViolations = [];
  for (const part of parts) {
    const file = path.relative(projectDir, part.file);
    part.content.split('\n').forEach((line, index) => {
      const lineNum = index + 1;
      // Task lists: - [ ] or - [x]
      if (/^\s*-\s*\[[ xX]\]/.test(line)) {
        volatileViolations.push({ file, lineNum, reason: 'Task checklist item (- [ ])', lineText: line.trim() });
      }
      // Issue tracking numbers: e.g. #123, Fixes #45
      else if (/#\d{1,6}\b/.test(line) && !line.includes('C#') && !line.includes('F#')) {
        volatileViolations.push({ file, lineNum, reason: 'Issue reference (#123)', lineText: line.trim() });
      }
      // Dates: YYYY-MM-DD
      else if (/\b\d{4}-\d{2}-\d{2}\b/.test(line) && !line.toLowerCase().includes('copyright')) {
        volatileViolations.push({ file, lineNum, reason: 'Calendar date (invalidates cache over time)', lineText: line.trim() });
      }
      // TODO / FIXME markers
      else if (/\b(TODO|FIXME|WIP):/i.test(line)) {
        volatileViolations.push({ file, lineNum, reason: 'Temporary TODO/FIXME marker', lineText: line.trim() });
      }
    });
  }

  if (volatileViolations.length === 0) {
    score += 8;
    findings.push({
      status: 'pass',
      title: 'Zero Volatile Markers Detected',
      description: 'Tier-1 file contains only static architecture and tool rules, with zero task checklists or dates.'
    });
  } else {
    findings.push({
      status: 'fail',
      title: `${volatileViolations.length} Volatile Marker(s) Detected in ${loadedNames}`,
      description: 'Task state goes stale, crowds out durable rules, and each edit costs a prompt-cache miss at the next session start.',
      details: volatileViolations.slice(0, 8)
    });
  }

  // 4. Dead reference path check (4 pts)
  const deadPaths = [];
  const repo = gitPaths(projectDir);
  const pathRegex = /(?:`|\()([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+|\.[a-zA-Z0-9_\-./]+)(?:`|\))/g;
  let match;
  while ((match = pathRegex.exec(content)) !== null) {
    const rawPath = match[1];
    // Filter out URLs, scheme links, licenses, globs, and placeholders such as `.../x`
    if (
      rawPath.startsWith('http') ||
      rawPath.startsWith('file:') ||
      rawPath.startsWith('//') ||
      rawPath.includes('*') ||
      rawPath.includes('...')
    ) {
      continue;
    }
    // Only check relative repo paths (e.g. scripts/..., .claude/..., src/...). A token without
    // a slash is more often an extension, a jq filter or a property (`.node`, `.manager`).
    const isRepoPath = rawPath.startsWith('.') || rawPath.startsWith('scripts/') || rawPath.startsWith('src/');
    if (isRepoPath && rawPath.includes('/') && !pathExists(projectDir, rawPath, repo)) {
      deadPaths.push(rawPath);
    }
  }

  // Hook commands that run a project script which is missing break silently at runtime
  const layers = loadSettingsLayers(projectDir);
  const projectLayers = layers.filter((layer) => layer.scope !== 'user');
  for (const event of new Set(projectLayers.flatMap((layer) => Object.keys(layer.settings.hooks || {})))) {
    for (const hook of hookCommands(projectLayers, event)) {
      const status = projectScriptStatus(projectDir, hook.command);
      if (!status.ok) deadPaths.push(`${status.file} (${event} hook)`);
    }
  }

  const uniqueDead = [...new Set(deadPaths)];
  if (uniqueDead.length === 0) {
    score += 4;
    findings.push({
      status: 'pass',
      title: 'Valid File Path References',
      description: 'All local file paths referenced in Tier-1 context, and every hook script, exist on disk.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: `${uniqueDead.length} Dead Path Reference(s) in Tier-1 Context`,
      description: 'References to missing paths mislead agents into failed read attempts, and hooks pointing at missing scripts never run.',
      details: uniqueDead
    });
  }

  // 5. Pre-commit prefix stability hook check (4 pts; checks for this harness's gate)
  const gate = findHook(projectDir, layers, 'PreToolUse', /pre-commit-prefix-stability\.sh/);

  if (gate.working) {
    score += 4;
    findings.push({
      status: 'pass',
      title: 'Pre-Commit Prefix Stability Gate Active',
      description: 'Claude Code PreToolUse hook audits staged context changes before commits.'
    });
  } else if (gate.wired) {
    findings.push({
      status: 'fail',
      title: 'Pre-Commit Prefix Stability Gate Points to a Missing Script',
      description: `The hook is wired but cannot run: ${gate.broken.join(', ')}`
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'Pre-Commit Prefix Stability Gate Missing',
      description: 'No automated pre-commit hook is inspecting context drift.'
    });
  }

  const stats = { file: loadedNames, lines: lineCount, tokens: estimatedTokens };
  return { score, maxScore, findings, stats };
}
