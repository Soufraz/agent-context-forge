import fs from 'node:fs';
import path from 'node:path';

/**
 * Audits Pillar 4: Subagent Context Isolation
 * Max score: 20 points
 */
export function auditPillar4(projectDir) {
  let score = 0;
  const maxScore = 20;
  const findings = [];

  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  let hasGuardrailHook = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const rawSettings = fs.readFileSync(settingsPath, 'utf-8');
      if (rawSettings.includes('guard-subagent-isolation.py')) {
        hasGuardrailHook = true;
      }
    } catch {}
  }

  // 1. Exploration Guardrail Hook (12 pts)
  if (hasGuardrailHook) {
    score += 12;
    findings.push({
      status: 'pass',
      title: 'Subagent Exploration Guardrail Active',
      description: 'PreToolUse hook blocks runaway inline searches (10+ Read/Grep calls) and enforces subagent delegation.'
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
        const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
        // If an agent is designated orchestrator or planner, check if write tools are omitted
        if (/name:\s*(?:orchestrator|coordinator|planner)/i.test(content)) {
          if (/\b(?:Edit|Write)\b/.test(content)) {
            orchestratorSafe = false;
            findings.push({
              status: 'warn',
              title: `Orchestrator Agent (${file}) Lacks Permission Scoping`,
              description: 'Orchestrator has Edit/Write tools. Removing them mechanically prevents inline code edits, forcing subagent dispatch.'
            });
            break;
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
      if (/subagent|Task tool|Goldfish/i.test(claudeContent)) {
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
