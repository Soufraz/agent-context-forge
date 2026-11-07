import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Audits Pillar 5: Episodic Memory & Lossy Compaction Protection
 * Max score: 15 points
 */
export function auditPillar5(projectDir) {
  let score = 0;
  const maxScore = 15;
  const findings = [];

  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {}
  }

  // 1. Check if Auto-Memory is enabled or context-mode MCP is configured (8 pts)
  const isAutoMemoryDisabledEnv =
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === '1' ||
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === 'true';
  const isAutoMemoryDisabledSettings = settings?.autoMemoryEnabled === false;

  const mcpConfigPath = path.join(projectDir, '.mcp.json');
  let hasContextModeMCP = false;
  if (fs.existsSync(mcpConfigPath)) {
    try {
      const mcpContent = fs.readFileSync(mcpConfigPath, 'utf-8');
      if (mcpContent.includes('context-mode')) {
        hasContextModeMCP = true;
      }
    } catch {}
  }

  if (hasContextModeMCP) {
    score += 8;
    findings.push({
      status: 'pass',
      title: 'context-mode MCP Configured',
      description: 'Project is configured with context-mode virtualization for deep episodic tracking.'
    });
  } else if (!isAutoMemoryDisabledEnv && !isAutoMemoryDisabledSettings) {
    score += 8;

    // Check existing project memory dir if present
    const homeDir = os.homedir();
    const projectSlug = path.resolve(projectDir).replace(/\//g, '-');
    const memoryDir = path.join(homeDir, '.claude', 'projects', projectSlug, 'memory');
    let topicCount = 0;

    if (fs.existsSync(memoryDir)) {
      try {
        const files = fs.readdirSync(memoryDir);
        topicCount = files.filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length;
      } catch {}
    }

    findings.push({
      status: 'pass',
      title: `Episodic Auto-Memory Active (${topicCount} topic(s) recorded)`,
      description: 'Two-tier memory captures lessons outside tracked repo files without busting the prompt cache.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'Episodic Memory Disabled',
      description: 'Auto-memory is explicitly turned off. Sessions will suffer from amnesia across restarts.'
    });
  }

  // 2. PreCompact handover hook (7 pts)
  let hasPreCompactHook = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const rawSettings = fs.readFileSync(settingsPath, 'utf-8');
      if (rawSettings.includes('pre-compact-handover.sh') || rawSettings.includes('PreCompact')) {
        hasPreCompactHook = true;
      }
    } catch {}
  }

  if (hasPreCompactHook) {
    score += 7;
    findings.push({
      status: 'pass',
      title: 'Lossy Compaction Protection Active (PreCompact Hook)',
      description: 'Snapshots active Git diffs and instructs the summarizer to preserve exact file:line pointers.'
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'PreCompact Handover Hook Missing',
      description: 'When /compact triggers mid-session, lossy summarization may discard exact line numbers and hypotheses.'
    });
  }

  return { score, maxScore, findings };
}
