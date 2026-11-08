import { execSync } from 'node:child_process';
import { findHook, loadSettingsLayers } from './settings.js';

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
      description: 'rtk is ready to compress test stdout, build outputs, and git inspections.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'rtk (Rust Token Killer) Not Installed',
      description: 'Raw test runs (e.g. pytest, npm test, cargo test) will dump all passing assertions into context RAM. Install via `brew install rtk` or see https://github.com/rtk-ai/rtk.'
    });
  }

  // 2. Check if a PreToolUse command rewriter is wired: this harness's hook, or the one
  //    `rtk init -g` installs (8 pts)
  const layers = loadSettingsLayers(projectDir);
  const harnessRewriter = findHook(projectDir, layers, 'PreToolUse', /rewrite-rtk\.sh/);
  const nativeRewriter = findHook(projectDir, layers, 'PreToolUse', /\brtk hook claude\b|rtk-rewrite\.sh/);

  if (harnessRewriter.working || nativeRewriter.working) {
    score += 8;
    findings.push({
      status: 'pass',
      title: 'Transparent Command Rewriter Configured',
      description: nativeRewriter.working
        ? "rtk's own Claude Code hook (`rtk init -g`) rewrites noisy test and build commands."
        : 'Claude Code PreToolUse Bash hook transparently intercepts noisy test and build commands.'
    });
  } else if (harnessRewriter.wired) {
    findings.push({
      status: 'fail',
      title: 'Command Rewriter Hook Points to a Missing Script',
      description: `The hook is wired but cannot run: ${harnessRewriter.broken.join(', ')}`
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
