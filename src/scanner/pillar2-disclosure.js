import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { inspectDirectory } from '../detector.js';
import { isPluginEnabled, lspPluginsFor, pluginInstallCommand } from '../lsp-plugins.js';
import { loadSettingsLayers } from './settings.js';

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
    // 1. Code intelligence plugin enabled for each language (4 pts). This, not a settings
    //    flag, is what turns on Claude Code's LSP tool.
    const missingPlugins = servers.filter((server) => !isPluginEnabled(layers, server.plugin));
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
        title: `Code Intelligence Plugin Not Enabled: ${missingPlugins.map((s) => s.plugin).join(', ')}`,
        description: `Claude Code keeps its LSP tool off until the plugin is installed. Run: ${missingPlugins
          .map(pluginInstallCommand)
          .join(' && ')}`
      });
    }

    // 2. The binary each plugin starts is on PATH (8 pts)
    const missingBinaries = servers.filter((server) => !isCommandAvailable(server.binary));
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

  // 3. permissions.deny Token-Bomb configuration (4 pts)
  const deniedList = settings?.permissions?.deny || [];
  const hasDenyRules = Array.isArray(deniedList) && deniedList.length > 0;
  const protectsLockfiles = deniedList.some((rule) => rule.includes('lock'));

  if (hasDenyRules && protectsLockfiles) {
    score += 4;
    findings.push({
      status: 'pass',
      title: `Token Bomb Denials Active (${deniedList.length} rules)`,
      description: 'permissions.deny blocks accidental reads of lockfiles, build outputs, and minified bundles.'
    });
  } else {
    findings.push({
      status: 'fail',
      title: 'No Token Bomb Denials in permissions.deny',
      description: 'An accidental Read call on a lockfile or build bundle can dump 20,000–100,000 tokens into context RAM.'
    });
  }

  // 4. Discovery of unprotected token-bomb files in repo (4 pts)
  const commonTokenBombs = [
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'Cargo.lock',
    'poetry.lock',
    'uv.lock'
  ];

  const foundTokenBombs = [];
  for (const tb of commonTokenBombs) {
    const fullPath = path.join(projectDir, tb);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      const sizeKb = Math.round(stats.size / 1024);
      const estTokens = Math.round(stats.size / 4);
      foundTokenBombs.push({ file: tb, sizeKb, estTokens });
    }
  }

  if (foundTokenBombs.length === 0) {
    score += 4;
    findings.push({
      status: 'pass',
      title: 'No Raw Lockfiles in Repository Root',
      description: 'No massive lockfiles found in root to threaten context budget.'
    });
  } else {
    // If found, check if they are protected
    if (protectsLockfiles) {
      score += 4;
      findings.push({
        status: 'pass',
        title: `Discovered Lockfiles are Protected: ${foundTokenBombs.map((f) => `${f.file} (~${f.estTokens} tokens)`).join(', ')}`,
        description: 'Lockfiles exist in project but are safely guarded by permissions.deny.'
      });
    } else {
      findings.push({
        status: 'fail',
        title: `Unprotected Token Bomb(s) Found in Project: ${foundTokenBombs.map((f) => f.file).join(', ')}`,
        description: 'These files exist and could be read in full by an agent, causing catastrophic context dilution.',
        details: foundTokenBombs
      });
    }
  }

  // Tokens a single Read of an unprotected lockfile could load (bytes / 4)
  const unprotectedTokens = protectsLockfiles ? 0 : foundTokenBombs.reduce((sum, f) => sum + f.estTokens, 0);
  return { score, maxScore, findings, stats: { unprotectedTokens } };
}
