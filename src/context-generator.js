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
 */
export function buildSddSection(sdd) {
  if (sdd === 'superpowers') {
    return `
## Planning & SDD Methodology: Superpowers
- **Subagent-Driven Development:** Follow the [Superpowers SDD](https://github.com/obra/superpowers) red-green-refactor workflow.
- **Subagent Spawning:** When delegating tasks to subagents, provide explicit spec boundaries and expect <250 words summary with file:line pointers.`;
  } else if (sdd === 'gsd') {
    return `
## Planning & SDD Methodology: GetShitDone (GSD)
- **Spec-Driven Workflow:** Follow [GetShitDone](https://github.com/open-gsd/gsd-core) contract-first task phases (Discuss -> Plan -> Execute -> Verify).
- **Context Isolation:** Keep primary chat flat; execute plan tasks in isolated subagents.`;
  } else if (sdd === 'ecc') {
    return `
## Planning & SDD Methodology: Everything Claude Code (ECC)
- **PDCA Engineering Loop:** Follow [ECC](https://github.com/affaan-m/everything-claude-code) Plan-Test-Implement-Review-Verify cycles.
- **Workflow Skills:** Leverage specialized sub-agents and modular skills without dirtying the root prefix.`;
  } else if (sdd === 'elephant-goldfish') {
    return `
## Planning & SDD Methodology: Elephant-Goldfish Model (EGM)
- **The Elephant:** Long-horizon architectural memory lives on disk (specifications, ADRs, schemas).
- **The Goldfish:** Fresh, zero-context reviewers evaluated cold without conversational bias. See [google/elephant-goldfish-model](https://github.com/google/elephant-goldfish-model).`;
  }
  return '';
}

// Opt-in: LSP references are more precise than text search when names collide or imports are
// aliased, and models rarely pick LSP on their own. With this rule Sonnet found every caller in
// 2 of 6 runs (0 of 6 without), but the runs cost 49-51% more in benchmarks round 4. That figure
// is inflated by the fresh-folder cache artifact (see benchmarks/README.md), and the rule's cost
// in a fixed folder was never measured, so the starter leaves it out unless the user chooses
// LSP navigation.
const LSP_REFERENCES_RULE =
  "- To find who calls a function or where a symbol is used, prefer the `LSP` tool's references lookup when it is available (load it with ToolSearch if it isn't listed): text search conflates same-named symbols and misses aliased imports.";
const LOCKFILE_RULE = '- Search lockfiles with `grep -n` instead of reading them whole.';

const MAINTAINER_NOTE = `<!--
Claude Code strips HTML comments like this one before loading the file, so notes here cost no
tokens. Everything outside comments is sent with every request: keep it short and stable, add
only rules that change how Claude works in this project (architecture boundaries, commands,
conventions it can't infer from the code), and leave out task lists, issue numbers, and dates.
-->`;

/**
 * The starter CLAUDE.md for projects installed without custom context. Rules that hooks enforce
 * or that Claude Code handles itself are left out, since every line costs tokens on every turn.
 */
export function generateStarterClaudeMd({ sdd = 'none', lsp = 'off' } = {}) {
  const lspRule = lsp === 'native' ? LSP_REFERENCES_RULE : '';
  return [MAINTAINER_NOTE, '# Project Instructions', '', lspRule, LOCKFILE_RULE, buildSddSection(sdd)]
    .filter((part) => part !== '')
    .join('\n')
    .replace('# Project Instructions\n', '# Project Instructions\n\n') + '\n';
}

export function generateProjectContext(options = {}) {
  const {
    projectName = 'My Project',
    description = 'Modern software application',
    techStack = 'TypeScript / Node.js',
    customRules = '',
    sdd = 'none',
    lsp = 'off',
    masking = 'rtk',
    episodicMemory = 'builtin'
  } = options;

  // 1. Build SDD Section for CLAUDE.md if requested
  const sddSection = buildSddSection(sdd);

  // 2. Notes for the tools the user chose instead of the defaults
  const toolNotes = [
    lsp === 'native'
      ? LSP_REFERENCES_RULE
      : typeof lsp === 'object' && lsp.custom
      ? `- Navigate symbols with ${lsp.custom}.`
      : '',
    LOCKFILE_RULE,
    masking === 'rtk'
      ? ''
      : `- Filter test and build output through ${typeof masking === 'object' && masking.custom ? masking.custom : 'the configured output filter'}.`,
    episodicMemory === 'context-mode'
      ? '- This project uses [context-mode](https://github.com/mksglu/context-mode) MCP for context virtualization.'
      : ''
  ].filter(Boolean);

  const claudeMdContent = [
    MAINTAINER_NOTE,
    `# ${projectName}`,
    '',
    description,
    '',
    `- **Stack:** ${techStack}`,
    ...(customRules ? [`- ${customRules}`] : []),
    ...toolNotes,
    '- More architecture and domain rules: `.agents/rules/project-architecture.md`.',
    sddSection
  ]
    .join('\n')
    .trimEnd() + '\n';

  const agentsMdContent = `# ${projectName} — Universal Agent Instructions (AGENTS.md)

> **Prefix Stability Rule:** Static root context (< 150 lines). Never place temporary sprint notes or task checkboxes here.

## 1. Overview & Stack
- **Project:** ${projectName} (${description})
- **Primary Stack:** ${techStack}
- **Pre-flight Doctor:** \`./scripts/agent-gates/doctor.sh\`

## 2. Universal Agent Laws
${[
  lsp === 'native' ? '**LSP Navigation:** Prefer symbol navigation tools over full-file reads.' : '',
  '**Subagent Delegation:** Offload deep research to isolated child agents.',
  '**Architectural Deep-Dive:** See `.agents/rules/project-architecture.md` for domain rules.'
]
  .filter(Boolean)
  .map((law, i) => `${i + 1}. ${law}`)
  .join('\n')}
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
