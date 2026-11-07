import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { inspectDirectory } from '../detector.js';
import {
  installedPluginsFor,
  isPluginEnabled,
  lspPluginsFor,
  pluginInstallCommand,
  tsserverAvailable
} from '../lsp-plugins.js';
import { findHook, loadSettingsLayers } from './settings.js';

/**
 * Audits Pillar 2: Progressive Disclosure via Language Server Protocol & Token Bomb Protection
 * Max score: 20 points
 */
export function auditPillar2(projectDir) {
  let score = 0;
  const maxScore = 20;
  const findings = [];

  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {}
  }

  const isCommandAvailable = (cmd) => {
    try {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  // Score only the language servers for this repo's own languages
  const servers = lspPluginsFor(inspectDirectory(projectDir).projectTypes);
  const layers = loadSettingsLayers(projectDir);

  if (servers.length === 0) {
    findings.push({
      status: 'warn',
      title: 'No Language With an Official Code Intelligence Plugin Detected',
      description:
        'LSP navigation needs a code intelligence plugin for the repo language (see https://code.claude.com/docs/en/plugins/code-intelligence).'
    });
  } else {
    // 1. Code intelligence plugin installed for this folder, per language (4 pts). This, not a
    //    settings flag, is what turns on Claude Code's LSP tool. Without the claude CLI, fall
    //    back to what settings enable.
    const installed = installedPluginsFor(projectDir);
    const isActive = (plugin) =>
      installed ? installed.some((id) => id.startsWith(`${plugin}@`)) : isPluginEnabled(layers, plugin);
    const missingPlugins = servers.filter((server) => !isActive(server.plugin));
    score += Math.round((4 * (servers.length - missingPlugins.length)) / servers.length);
    if (missingPlugins.length === 0) {
      findings.push({
        status: 'pass',
        title: `Code Intelligence Plugin Enabled: ${servers.map((s) => s.plugin).join(', ')}`,
        description: "Claude Code's LSP tool is active for this repo's languages."
      });
    } else {
      findings.push({
        status: 'warn',
        title: `Code Intelligence Plugin Not Installed: ${missingPlugins.map((s) => s.plugin).join(', ')}`,
        description: `Claude Code keeps its LSP tool off until the plugin is installed. Run: ${missingPlugins
          .map(pluginInstallCommand)
          .join(' && ')}`
      });
    }

    // 2. The binary each plugin starts is on PATH and can run (8 pts)
    const missingBinaries = servers.filter(
      (server) => !isCommandAvailable(server.binary) || (server.needsTsserver && !tsserverAvailable(projectDir))
    );
    score += Math.round((8 * (servers.length - missingBinaries.length)) / servers.length);
    if (missingBinaries.length === 0) {
      findings.push({
        status: 'pass',
        title: `Language Server(s) Available: ${servers.map((s) => `${s.binary} (${s.language})`).join(', ')}`,
        description: 'Progressive symbol resolution (goToDefinition, findReferences) is ready to operate.'
      });
    } else {
      findings.push({
        status: 'warn',
        title: `Language Server Missing for ${missingBinaries.map((s) => s.language).join(', ')}`,
        description: `The code intelligence plugin needs its binary on PATH. Install: ${missingBinaries
          .map((s) => s.install)
          .join(' && ')}`
      });
    }
  }

  // 3. Whole-file read guard for lockfiles and bundles (4 pts). permissions.deny Read rules
  //    also stop Grep and `grep` on those files, so they get partial credit and a warning.
  const deniedList = Array.isArray(settings?.permissions?.deny) ? settings.permissions.deny : [];
  const denyRulesCoverLockfiles = deniedList.some((rule) => /lock/.test(rule));
  const readGuard = findHook(projectDir, layers, 'PreToolUse', /guard-whole-file-reads\.sh/);
  const protectsLockfiles = readGuard.working || denyRulesCoverLockfiles;

  if (readGuard.working) {
    score += 4;
    findings.push({
      status: 'pass',
      title: 'Whole-File Reads of Lockfiles and Bundles Are Guarded',
      description: 'A PreToolUse hook blocks reading lockfiles, minified bundles, and source maps whole, and points to grep. Searches and ranged reads still work.'
    });
  } else if (denyRulesCoverLockfiles) {
    score += 2;
    findings.push({
      status: 'warn',
      title: 'Lockfiles Are Blocked by permissions.deny',
      description:
        'Read deny rules also block Grep and `grep` on those files, so agents cannot answer questions like "which version is locked". Prefer a hook that blocks only whole-file reads.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'Nothing Guards Whole-File Reads of Lockfiles',
      description: 'Claude Code refuses to Read files over 256 KB and caps one Read at 25,000 tokens, so the exposure is smaller lockfiles read whole.'
    });
  }

  // 4. Lockfile exposure in the repo root (4 pts). What one whole-file Read would load: nothing
  //    for files over 256 KB (Read refuses them), at most 25,000 tokens otherwise (bytes / 4).
  const READ_MAX_BYTES = 256 * 1024;
  const READ_MAX_TOKENS = 25000;
  const commonTokenBombs = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'Cargo.lock',
    'poetry.lock',
    'uv.lock'
  ];

  const foundTokenBombs = [];
  for (const tb of commonTokenBombs) {
    const fullPath = path.join(projectDir, tb);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      const estTokens = stats.size > READ_MAX_BYTES ? 0 : Math.min(READ_MAX_TOKENS, Math.round(stats.size / 4));
      foundTokenBombs.push({ file: tb, sizeKb: Math.round(stats.size / 1024), estTokens });
    }
  }
  const exposed = protectsLockfiles ? [] : foundTokenBombs.filter((f) => f.estTokens > 0);

  if (foundTokenBombs.length === 0) {
    score += 4;
    findings.push({
      status: 'pass',
      title: 'No Lockfiles in Repository Root',
      description: 'No lockfiles found in the root to threaten the context budget.'
    });
  } else if (exposed.length === 0) {
    score += 4;
    findings.push({
      status: 'pass',
      title: `Lockfiles Can't Be Read Whole: ${foundTokenBombs.map((f) => `${f.file} (${f.sizeKb} KB)`).join(', ')}`,
      description: protectsLockfiles
        ? 'Whole-file reads of these lockfiles are blocked.'
        : 'Each is over 256 KB, which Claude Code refuses to Read whole.'
    });
  } else {
    findings.push({
      status: 'fail',
      title: `Lockfiles Can Be Read Whole: ${exposed.map((f) => `${f.file} (~${f.estTokens} tokens)`).join(', ')}`,
      description: 'An agent can load these into context in one Read call.',
      details: exposed
    });
  }

  const unprotectedTokens = exposed.reduce((sum, f) => sum + f.estTokens, 0);
  return { score, maxScore, findings, stats: { unprotectedTokens } };
}
