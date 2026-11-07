/**
 * Generates custom Tier-1 and Tier-2 context documents (CLAUDE.md, AGENTS.md,
 * and .agents/rules/project-architecture.md) based on user-provided project context.
 *
 * All generated files strictly adhere to Pillar 1:
 * - Compact Tier-1 prefix (< 150 lines / ~1000 tokens)
 * - Zero volatile task state (no sprint checkboxes, issue IDs, or due dates)
 * - Valid relative file path pointers
 */

/**
 * The CLAUDE.md section for the chosen SDD / planning methodology, or '' for none.
 *
 * @param {string} sdd Methodology id from the wizard
 * @param {number} number Section number to use in the heading
 */
export function buildSddSection(sdd, number) {
  if (sdd === 'superpowers') {
    return `
## ${number}. Planning & SDD Methodology: Superpowers
- **Subagent-Driven Development:** Follow the [Superpowers SDD](https://github.com/obra/superpowers) red-green-refactor workflow.
- **Subagent Spawning:** When delegating tasks to subagents, provide explicit spec boundaries and expect <250 words summary with file:line pointers.`;
  } else if (sdd === 'gsd') {
    return `
## ${number}. Planning & SDD Methodology: GetShitDone (GSD)
- **Spec-Driven Workflow:** Follow [GetShitDone](https://github.com/open-gsd/gsd-core) contract-first task phases (Discuss -> Plan -> Execute -> Verify).
- **Context Isolation:** Keep primary chat flat; execute plan tasks in isolated subagents.`;
  } else if (sdd === 'ecc') {
    return `
## ${number}. Planning & SDD Methodology: Everything Claude Code (ECC)
- **PDCA Engineering Loop:** Follow [ECC](https://github.com/affaan-m/everything-claude-code) Plan-Test-Implement-Review-Verify cycles.
- **Workflow Skills:** Leverage specialized sub-agents and modular skills without dirtying the root prefix.`;
  } else if (sdd === 'elephant-goldfish') {
    return `
## ${number}. Planning & SDD Methodology: Elephant-Goldfish Model (EGM)
- **The Elephant:** Long-horizon architectural memory lives on disk (specifications, ADRs, schemas).
- **The Goldfish:** Fresh, zero-context reviewers evaluated cold without conversational bias. See [google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model).`;
  }
  return '';
}

export function generateProjectContext(options = {}) {
  const {
    projectName = 'My Project',
    description = 'Modern software application',
    techStack = 'TypeScript / Node.js',
    customRules = '',
    sdd = 'none',
    lsp = 'native',
    masking = 'rtk',
    episodicMemory = 'builtin'
  } = options;

  // 1. Build SDD Section for CLAUDE.md if requested
  const sddSection = buildSddSection(sdd, 3);

  // 2. Memory instructions
  const memoryNote =
    episodicMemory === 'context-mode'
      ? '- **Context Virtualization:** This project uses [context-mode](https://github.com/mksglu/context-mode) MCP for advanced episodic context tracking.'
      : '- **Episodic Auto-Memory:** Cross-session lessons are captured automatically in `~/.claude/projects/<slug>/memory/` (verified via `doctor.sh`).';

  // 3. LSP & Masking notes
  const lspNote =
    lsp === 'native'
      ? '- **Progressive Disclosure (LSP First):** When the `LSP` tool is available (a code intelligence plugin is installed), query symbols (`goToDefinition`, `documentSymbol`) before reading whole files.'
      : `- **Progressive Disclosure:** Use ${typeof lsp === 'object' && lsp.custom ? lsp.custom : 'configured code intelligence'} to navigate symbols.`;

  const maskingNote =
    masking === 'rtk'
      ? '- **Observation Masking (`rtk`):** Wrap test and build executions with `rtk` (e.g. `rtk npm test`) to collapse passing test stdout.'
      : `- **Observation Masking:** Filter test stdout using ${typeof masking === 'object' && masking.custom ? masking.custom : 'output filter'}.`;

  const claudeMdContent = `# ${projectName} — Context & Architectural Laws (Tier 1)

> **Prefix Stability Rule:** Static root prefix (< 150 lines). Zero volatile state (no checkboxes or issue IDs): it is re-sent on every turn, so every line costs tokens and competes for attention.

## 1. Project Overview & Stack
- **Project:** ${projectName}
- **Description:** ${description}
- **Core Stack:** ${techStack}
- **Environment Doctor:** \`./scripts/agent-gates/doctor.sh\`
- **Prefix Stability Gate:** \`./.claude/hooks/pre-commit-prefix-stability.sh\`

## 2. Context Engineering & Tool Discipline
${lspNote}
${maskingNote}
- **Token-Bomb Avoidance:** Never \`Read\` lockfiles (\`pnpm-lock.yaml\`, \`package-lock.json\`, \`Cargo.lock\`) or build bundles (\`dist/\`, \`.next/\`).
- **Subagent Context Isolation:** Delegate multi-file searches (10+ calls) to subagents (\`Agent\` tool) and return only <250 words synthesis.
${memoryNote}${sddSection}

## 4. Key References (On-Demand Pointers)
- Detailed architecture: \`.agents/rules/project-architecture.md\`
- Claude settings & hooks: \`.claude/settings.json\` & \`.claude/hooks/\`
- Portable health gates: \`scripts/agent-gates/\`
`;

  const agentsMdContent = `# ${projectName} — Universal Agent Instructions (AGENTS.md)

> **Prefix Stability Rule:** Static root context (< 150 lines). Never place temporary sprint notes or task checkboxes here.

## 1. Overview & Stack
- **Project:** ${projectName} (${description})
- **Primary Stack:** ${techStack}
- **Pre-flight Doctor:** \`./scripts/agent-gates/doctor.sh\`

## 2. Universal Agent Laws
1. **LSP Navigation:** Prefer symbol navigation tools over full-file reads.
2. **Output Compression:** Use command compressors (\`rtk\`) for tests to prevent context RAM flooding.
3. **Subagent Delegation:** Offload deep research to isolated child agents.
4. **Architectural Deep-Dive:** See \`.agents/rules/project-architecture.md\` for domain rules.
`;

  const architectureRuleContent = `# ${projectName} — Architectural Rules & Domain Guidelines

This document provides on-demand Tier-2 architectural context. It is loaded when deeper domain or stack decisions are required, preserving Tier-1 prefix cache stability.

## Project Scope
${description}

## Technology Stack & Conventions
- **Stack:** ${techStack}
${customRules ? `\n## Domain & Custom Architectural Constraints\n${customRules}\n` : ''}
## Core Engineering Principles
1. **Simplicity First:** Keep modules single-purpose and decoupled.
2. **Type Safety & Contracts:** Enforce rigorous type contracts and validate external boundaries.
3. **Automated Verification:** Every code change must be accompanied by unit or integration tests.
4. **Context Cleanliness:** Keep commit diffs focused; avoid mixing refactoring with feature development.
`;

  return {
    claudeMdContent,
    agentsMdContent,
    architectureRuleContent
  };
}
