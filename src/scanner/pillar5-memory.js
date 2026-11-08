import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { hookCommands, loadSettingsLayers, projectScriptStatus } from './settings.js';

/**
 * Audits Pillar 5: Episodic Memory & Lossy Compaction Protection
 * Max score: 15 points
 */
export function auditPillar5(projectDir) {
  let score = 0;
  const maxScore = 15;
  const findings = [];

  const layers = loadSettingsLayers(projectDir);

  // 1. Check if Auto-Memory is in use or context-mode MCP is configured (8 pts). Auto-Memory
  //    is on by default, so being merely enabled earns half: it shows nothing was done.
  const isAutoMemoryDisabledEnv =
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === '1' ||
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === 'true';
  const autoMemorySetting = layers.find((layer) => 'autoMemoryEnabled' in layer.settings);
  const isAutoMemoryDisabledSettings = autoMemorySetting?.settings.autoMemoryEnabled === false;

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
    // Check existing project memory dir if present
    const homeDir = os.homedir();
    const projectSlug = path.resolve(projectDir).replace(/\//g, '-');
    const memoryDir = path.join(homeDir, '.claude', 'projects', projectSlug, 'memory');
    const hasIndex = fs.existsSync(path.join(memoryDir, 'MEMORY.md'));
    let topicCount = 0;

    if (fs.existsSync(memoryDir)) {
      try {
        const files = fs.readdirSync(memoryDir);
        topicCount = files.filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length;
      } catch {}
    }

    if (hasIndex) {
      score += 8;
      findings.push({
        status: 'pass',
        title: `Episodic Auto-Memory in Use (${topicCount} topic(s) recorded)`,
        description: 'Two-tier memory captures lessons outside tracked repo files, so Tier-1 rules stay unchanged.'
      });
    } else {
      score += 4;
      findings.push({
        status: 'warn',
        title: 'Auto-Memory Enabled by Default, Nothing Recorded Yet',
        description: 'Auto-Memory is on (the Claude Code default) but has no MEMORY.md for this project on this machine yet.'
      });
    }
  } else {
    findings.push({
      status: 'warn',
      title: 'Episodic Memory Disabled',
      description: 'Auto-memory is explicitly turned off. Sessions will suffer from amnesia across restarts.'
    });
  }

  // 2. Compaction handover hook (7 pts): any working PreCompact hook, or a SessionStart hook
  //    that runs after compaction: matcher `compact`, or omitted, "" or "*", which match every source
  const compactionHooks = [
    ...hookCommands(layers, 'PreCompact'),
    ...hookCommands(layers, 'SessionStart').filter((hook) => ['', '*'].includes(hook.matcher) || /compact/.test(hook.matcher))
  ];
  const hasPreCompactHook = compactionHooks.some((hook) => projectScriptStatus(projectDir, hook.command).ok);

  if (hasPreCompactHook) {
    score += 7;
    findings.push({
      status: 'pass',
      title: 'Lossy Compaction Protection Active (PreCompact Hook)',
      description: 'Gives the compaction summarizer the active git state and instructions to preserve exact file:line pointers.'
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
