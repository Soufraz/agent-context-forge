import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Audits Pillar 3: Observation Masking via rtk / command compression
 * Max score: 15 points
 */
export function auditPillar3(projectDir) {
  let score = 0;
  const maxScore = 15;
  const findings = [];

  const isCommandAvailable = (cmd) => {
    try {
      execSync(`command -v ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };

  // 1. Check if rtk binary is installed on PATH (7 pts)
  const hasRtk = isCommandAvailable('rtk');
  if (hasRtk) {
    score += 7;
    findings.push({
      status: 'pass',
      title: 'Rust Token Killer (rtk) Installed on PATH',
      description: 'rtk is ready to compress test stdout, build outputs, and git inspections (~60-90% token savings).'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'rtk (Rust Token Killer) Not Installed',
      description: 'Raw test runs (e.g. pytest, npm test, cargo test) will dump all passing assertions into context RAM. Install via: cargo install rtk-ai'
    });
  }

  // 2. Check if PreToolUse command rewriter or hook is configured (8 pts)
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  let hasRewriter = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const rawSettings = fs.readFileSync(settingsPath, 'utf-8');
      if (rawSettings.includes('rewrite-rtk.sh') || rawSettings.includes('rtk')) {
        hasRewriter = true;
      }
    } catch {}
  }

  if (hasRewriter) {
    score += 8;
    findings.push({
      status: 'pass',
      title: 'Transparent Command Rewriter Configured',
      description: 'Claude Code PreToolUse Bash hook transparently intercepts noisy test and build commands.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'Command Rewriter Hook Missing',
      description: 'Agents may run raw `npm test` or `git status` without rtk compression unless prompted.'
    });
  }

  return { score, maxScore, findings };
}
