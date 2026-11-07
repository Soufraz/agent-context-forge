import fs from 'node:fs';
import path from 'node:path';
import { findHook, loadSettingsLayers } from './settings.js';

// Keys people reach for that Claude Code does not recognize; it ignores them without an error,
// so the subagent silently inherits every tool.
const IGNORED_TOOL_KEYS = ['allowed_tools', 'allowedTools', 'allowed-tools'];

/**
 * Parses the flat YAML frontmatter of a subagent file: `key: value` and `key:` followed by
 * `- item` lists. Returns null when the file has no frontmatter.
 */
export function parseAgentFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fields = {};
  let listKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const keyValue = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (keyValue) {
      const value = keyValue[2].trim();
      fields[keyValue[1]] = value || [];
      listKey = value ? null : keyValue[1];
      continue;
    }
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item && listKey) {
      fields[listKey].push(item[1].trim());
    }
  }
  return fields;
}

const toToolList = (value) => {
  if (value === undefined) return undefined;
  const items = Array.isArray(value) ? value : value.replace(/^\[|\]$/g, '').split(',');
  return items.map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
};

/**
 * Returns which of Edit/Write a subagent ends up with, following Claude Code's rules:
 * omitting `tools` inherits every tool, and `disallowedTools` is removed from either.
 */
export function writeToolsGranted(frontmatter) {
  const tools = toToolList(frontmatter.tools);
  const disallowed = toToolList(frontmatter.disallowedTools) || [];
  return ['Edit', 'Write'].filter(
    (tool) => !disallowed.includes(tool) && (tools === undefined || tools.includes(tool))
  );
}

/**
 * Audits Pillar 4: Subagent Context Isolation
 * Max score: 20 points
 */
export function auditPillar4(projectDir) {
  let score = 0;
  const maxScore = 20;
  const findings = [];

  // 1. Exploration Guardrail Hook (12 pts; checks for this harness's guardrail)
  const guardrail = findHook(
    projectDir,
    loadSettingsLayers(projectDir),
    'PreToolUse',
    /guard-subagent-isolation\.py/
  );

  if (guardrail.working) {
    score += 12;
    findings.push({
      status: 'pass',
      title: 'Subagent Exploration Guardrail Active',
      description: 'PreToolUse hook blocks runaway inline searches (10+ Read/Grep calls) and enforces subagent delegation.'
    });
  } else if (guardrail.wired) {
    findings.push({
      status: 'fail',
      title: 'Exploration Guardrail Points to a Missing Script',
      description: `The hook is wired but cannot run: ${guardrail.broken.join(', ')}`
    });
  } else {
    findings.push({
      status: 'warn',
      title: 'Exploration Guardrail Hook Not Wired',
      description: 'Primary agent may run dozens of search calls inline, causing context dilution (lost-in-the-middle effect).'
    });
  }

  // 2. Tool Permission Scoping & Agent Design (8 pts)
  const agentsDir = path.join(projectDir, '.claude', 'agents');
  let orchestratorSafe = true;
  let hasCustomAgents = false;

  if (fs.existsSync(agentsDir)) {
    const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    if (agentFiles.length > 0) {
      hasCustomAgents = true;
      for (const file of agentFiles) {
        const frontmatter = parseAgentFrontmatter(fs.readFileSync(path.join(agentsDir, file), 'utf-8'));
        if (!frontmatter) continue;

        const ignoredKeys = IGNORED_TOOL_KEYS.filter((key) => key in frontmatter);
        if (ignoredKeys.length > 0) {
          findings.push({
            status: 'warn',
            title: `Unrecognized Frontmatter Key in ${file}: ${ignoredKeys.join(', ')}`,
            description:
              'Claude Code ignores this key without an error. Use `tools` (allowlist) or `disallowedTools` (denylist) to restrict the subagent.'
          });
        }

        // If an agent is designated orchestrator or planner, check that it really lacks write tools
        const name = typeof frontmatter.name === 'string' ? frontmatter.name : '';
        if (/^(?:orchestrator|coordinator|planner)/i.test(name)) {
          const granted = writeToolsGranted(frontmatter);
          if (granted.length > 0) {
            orchestratorSafe = false;
            findings.push({
              status: 'warn',
              title: `Orchestrator Agent (${file}) Lacks Permission Scoping`,
              description: `Orchestrator still gets ${granted.join(' and ')}: list its tools in \`tools\` without them, or add them to \`disallowedTools\`, so it dispatches subagents instead of editing inline.`
            });
          }
        }
      }
    }
  }

  if (hasCustomAgents && orchestratorSafe) {
    score += 8;
    findings.push({
      status: 'pass',
      title: 'Architectural Tool Permission Scoping Enforced',
      description: 'Orchestrator is restricted from inline code modifications, preserving primary context RAM.'
    });
  } else if (!hasCustomAgents) {
    // Check if Tier-1 rules mention subagent delegation
    const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
    let mentionsSubagents = false;
    if (fs.existsSync(claudeMdPath)) {
      const claudeContent = fs.readFileSync(claudeMdPath, 'utf-8');
      if (/subagent|Agent tool|Task tool|Goldfish/i.test(claudeContent)) {
        mentionsSubagents = true;
      }
    }

    if (mentionsSubagents) {
      score += 8;
      findings.push({
        status: 'pass',
        title: 'Tier-1 Subagent Delegation Laws Defined',
        description: 'CLAUDE.md instructs the agent to offload deep explorations to subagents and return concise syntheses.'
      });
    } else {
      score += 4;
      findings.push({
        status: 'warn',
        title: 'No Explicit Subagent Boundaries in Context Rules',
        description: 'Consider adding rules mandating subagent delegation for multi-file research tasks.'
      });
    }
  }

  return { score, maxScore, findings };
}
