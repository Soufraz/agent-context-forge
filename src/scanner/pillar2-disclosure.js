import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

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

  // 1. ENABLE_LSP_TOOL flag in settings.json (4 pts)
  const lspFlag = settings?.env?.ENABLE_LSP_TOOL;
  if (lspFlag === '1' || lspFlag === 1) {
    score += 4;
    findings.push({
      status: 'pass',
      title: 'Native LSP Intelligence Enabled (ENABLE_LSP_TOOL=1)',
      description: 'Claude Code is configured to use language server symbol queries.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'ENABLE_LSP_TOOL Flag Missing',
      description: 'Claude Code will rely on broad text search instead of compiler-backed symbol navigation.'
    });
  }

  // 2. Language Server binary on PATH (8 pts)
  const isCommandAvailable = (cmd) => {
    try {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  const detectedLSPs = [];
  if (isCommandAvailable('vtsls')) detectedLSPs.push('vtsls (TypeScript)');
  if (isCommandAvailable('typescript-language-server')) detectedLSPs.push('typescript-language-server');
  if (isCommandAvailable('pyright')) detectedLSPs.push('pyright (Python)');
  if (isCommandAvailable('pylsp')) detectedLSPs.push('pylsp (Python)');
  if (isCommandAvailable('gopls')) detectedLSPs.push('gopls (Go)');
  if (isCommandAvailable('rust-analyzer')) detectedLSPs.push('rust-analyzer (Rust)');

  if (detectedLSPs.length > 0) {
    score += 8;
    findings.push({
      status: 'pass',
      title: `Language Server(s) Available: ${detectedLSPs.join(', ')}`,
      description: 'Progressive symbol resolution (goToDefinition, findReferences) is ready to operate.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'No Supported Language Server Detected on PATH',
      description: 'Install a language server (e.g. npm i -g @vtsls/language-server, pyright, gopls, or rust-analyzer) to enable ~70% token savings on symbol lookups.'
    });
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

  return { score, maxScore, findings };
}
