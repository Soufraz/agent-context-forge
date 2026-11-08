import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { inspectDirectory } from './detector.js';
import { scaffoldProject } from './scaffolder.js';
import { auditProject } from './scanner/index.js';
import { generateHtmlReport } from './reporter/html-template.js';
import { openInBrowser } from './reporter/open-browser.js';
import { offerToolInstallations } from './installer-helper.js';
import { execSync } from 'node:child_process';

export async function runCli() {
  console.clear();

  p.intro(
    `${pc.bgCyan(pc.black(' 🛠️  AGENT CONTEXT FORGE '))} ${pc.dim(
      'v0.1.0 — Context Engineering Harness'
    )}`
  );

  const asciiChart = [
    pc.cyan('┌────────────────────────────────────────────────────────────────────────┐'),
    pc.cyan('│ ') + pc.bold(pc.white('LAYER 2: Workflow & Planning Methodology')) + pc.cyan('                              │'),
    pc.cyan('│ ') + pc.white('Superpowers SDD • GetShitDone (GSD) • ECC • Elephant-Goldfish • TDD  ') + pc.cyan('│'),
    pc.cyan('│ ') + pc.gray('↳ How you brainstorm, decompose features, and coordinate tasks.       ') + pc.cyan('│'),
    pc.cyan('├────────────────────────────────────────────────────────────────────────┤'),
    pc.cyan('│ ') + pc.green('▲ ▲ ▲ ▲ ▲  ') + pc.bold(pc.green('LAYER 1: The Foundation Harness (agent-context-forge)')) + pc.cyan('       │'),
    pc.cyan('│ ') + pc.white('The rails: Prefix Cache Stability • LSP Navigation • RTK Masking        ') + pc.cyan('│'),
    pc.cyan('│ ') + pc.gray('↳ Keeps active context lean, prevents token bloat, freezes the prefix.  ') + pc.cyan('│'),
    pc.cyan('└────────────────────────────────────────────────────────────────────────┘')
  ].join('\n');

  p.note(
    `${pc.bold('💡 The Mental Model:')} ${pc.green('Active Context Window = RAM')} ${pc.white(
      '(fast & lean)'
    )} | ${pc.cyan('Repository & Memory = Disk')} ${pc.white('(queried on demand)')}\n\n` +
      `${asciiChart}\n\n` +
      `${pc.bold('🏛️  The 5 Pillars of Context Engineering:')}\n` +
      `  ${pc.yellow('1. Prefix Stability')}       → Keep Tier-1 root rules small and static (<150 lines); they ride along on every turn.\n` +
      `  ${pc.yellow('2. Progressive Disclosure')} → Query compiler symbols (LSP) instead of reading 400-line files.\n` +
      `  ${pc.yellow('3. Observation Masking')}    → Compress test/build noise with RTK.\n` +
      `  ${pc.yellow('4. Context Isolation')}      → Delegate sprawling searches to subagents; keep chat flat.\n` +
      `  ${pc.yellow('5. Episodic Memory')}        → Retain cross-session lessons in Auto-Memory outside repo files.`,
    '📖 Welcome & Core Concepts'
  );

  // 1. Provider / Engine Selection
  const engine = await p.select({
    message: 'Select your target Agent / LLM Engine:',
    options: [
      {
        value: 'claude',
        label: `${pc.green('●')} Claude Code (Anthropic)`,
        hint: 'Active & fully supported'
      },
      {
        value: 'gemini',
        label: `${pc.dim('○')} Gemini / Antigravity (Google)`,
        hint: 'Coming soon'
      },
      {
        value: 'opencode',
        label: `${pc.dim('○')} OpenCode / AGENTS.md`,
        hint: 'Coming soon'
      },
      {
        value: 'cursor',
        label: `${pc.dim('○')} Cursor / Windsurf`,
        hint: 'Coming soon'
      },
      {
        value: 'codex',
        label: `${pc.dim('○')} OpenAI Codex CLI`,
        hint: 'Coming soon'
      }
    ]
  });

  if (p.isCancel(engine)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  if (engine !== 'claude') {
    p.note(
      `Support for ${engine.toUpperCase()} is actively on the roadmap!\nTracking issue: https://github.com/Soufraz/agent-context-forge/issues/1`,
      'Provider Notice'
    );
    const proceedWithClaude = await p.confirm({
      message: 'Would you like to configure for Claude Code / Universal Git instead?',
      initialValue: true
    });

    if (p.isCancel(proceedWithClaude) || !proceedWithClaude) {
      p.cancel('Exiting. Stay tuned for future engine releases!');
      process.exit(0);
    }
  }

  // 2. Directory Inspection
  const cwd = process.cwd();
  const dirInfo = inspectDirectory(cwd);

  if (dirInfo.isEmpty) {
    p.log.info(`📂 Empty directory detected: ${pc.cyan(cwd)}`);
    const shouldScaffold = await p.confirm({
      message: 'Initialize this empty folder with Agent Context Forge?',
      initialValue: true
    });

    if (p.isCancel(shouldScaffold) || !shouldScaffold) {
      p.cancel('Aborted.');
      process.exit(0);
    }

    await runCustomizationWizardAndScaffold(cwd, 'claude');
    return;
  }

  // Existing project detected
  p.log.info(
    `🔍 Existing project detected: ${pc.cyan(cwd)} [${pc.magenta(
      dirInfo.projectTypes.join(', ')
    )}]`
  );

  const action = await p.select({
    message: 'What would you like to do?',
    options: [
      {
        value: 'scan',
        label: `${pc.cyan('⚡ Scan & Generate HTML Context Audit Report')} (Recommended)`,
        hint: 'Evaluates all 5 Pillars and opens dashboard in browser'
      },
      {
        value: 'install',
        label: `${pc.green('🚀 Install / Upgrade Context Forge Harness')}`,
        hint: 'Injects hooks, doctor scripts & rules into this repo'
      },
      {
        value: 'exit',
        label: 'Exit'
      }
    ]
  });

  if (p.isCancel(action) || action === 'exit') {
    p.cancel('Done.');
    process.exit(0);
  }

  if (action === 'scan') {
    await runScanAndReport(cwd);
  } else if (action === 'install') {
    await runCustomizationWizardAndScaffold(cwd, 'claude');
  }
}

/**
 * Runs the 5-Pillar Context Scan and opens the HTML dashboard in browser.
 */
async function runScanAndReport(projectDir) {
  const spinner = p.spinner();
  spinner.start('Auditing codebase across 5 Pillars of Context Engineering...');

  const report = auditProject(projectDir);
  const html = generateHtmlReport(report);

  const reportPath = path.join(projectDir, '.agent-context-report.html');
  fs.writeFileSync(reportPath, html, 'utf-8');

  spinner.stop('Context audit complete!');

  // Display scorecard in terminal
  const gradeColor =
    report.grade === 'A'
      ? pc.green
      : report.grade === 'B'
      ? pc.cyan
      : report.grade === 'C'
      ? pc.yellow
      : pc.red;

  p.log.message(
    `\n  ${pc.bold('Health Score:')} ${gradeColor(
      `${report.totalScore} / ${report.maxScore} (Grade ${report.grade})`
    )} &bull; ${report.gradeLabel}`
  );
  const { tier1, unprotectedLockfileTokens } = report.measurements;
  p.log.message(
    `  ${pc.bold('Tier-1 Context:')} ${pc.cyan(
      tier1 ? `${tier1.file}, ${tier1.lines} lines (~${tier1.tokens} tokens)` : 'missing'
    )}  |  ${pc.bold('Unprotected Lockfiles:')} ${
      unprotectedLockfileTokens > 0 ? pc.red(`~${unprotectedLockfileTokens} tokens`) : pc.green('none')
    }`
  );
  p.log.message(`  ${pc.bold('Report Path:')} ${pc.dim(reportPath)}\n`);

  p.log.step('Opening visual HTML dashboard in your default browser...');
  const opened = await openInBrowser(reportPath);
  if (!opened) {
    p.log.info(`You can view the dashboard by opening:\n${pc.underline(reportPath)}`);
  }

  // Interactively offer to install missing tools detected in scan
  if (
    report.pillars.pillar2.score < report.pillars.pillar2.maxScore ||
    report.pillars.pillar3.score < report.pillars.pillar3.maxScore
  ) {
    p.log.step('Missing environment tools detected in scan:');
    await offerToolInstallations(projectDir);
  }

  p.outro(pc.green('Context audit finished! Check your browser for details.'));
}

/**
 * Runs the interactive stack customization wizard and scaffolds the harness.
 */
async function runCustomizationWizardAndScaffold(targetDir, engine) {
  p.log.step('Configure your Context Engineering stack:');

  // Pillar 2: Progressive Disclosure
  const lspChoice = await p.select({
    message: '[Pillar 2] Progressive Disclosure (Code Intelligence):',
    options: [
      {
        value: 'off',
        label: 'Text search (Default)',
        hint: 'Adds nothing: Claude Code searches with grep and reads line ranges'
      },
      {
        value: 'native',
        label: 'Claude Native LSP (opt-in)',
        hint: 'Exact callers on large typed codebases; measured +49-51% cost on that task'
      },
      {
        value: 'custom',
        label: 'Bring another tool / custom setup',
        hint: 'Configure custom MCP or intelligence layer'
      }
    ]
  });
  if (p.isCancel(lspChoice)) process.exit(0);

  let lsp = lspChoice;
  if (lspChoice === 'custom') {
    const customTool = await p.text({
      message: 'Enter the name of your code intelligence tool/MCP:',
      placeholder: 'e.g., custom-lsp, ctags, sourcetrail'
    });
    if (p.isCancel(customTool)) process.exit(0);
    lsp = { custom: customTool || 'custom-code-intelligence' };
  }

  // Pillar 3: Observation Masking
  const maskingChoice = await p.select({
    message: '[Pillar 3] Observation Masking (Output Compression):',
    options: [
      {
        value: 'rtk',
        label: 'RTK — Rust Token Killer (Default, recommended)',
        hint: 'Collapses passing tests, keeps failure diffs'
      },
      {
        value: 'custom',
        label: 'Bring another tool / custom setup',
        hint: 'Configure custom output filter'
      }
    ]
  });
  if (p.isCancel(maskingChoice)) process.exit(0);

  let masking = 'rtk';
  if (maskingChoice === 'custom') {
    const customFilter = await p.text({
      message: 'Enter the name of your output compression tool:',
      placeholder: 'e.g., custom-filter, strip-ansi'
    });
    if (p.isCancel(customFilter)) process.exit(0);
    masking = { custom: customFilter || 'custom-filter' };
  }

  // Pillar 4: Subagent Context Isolation
  const subagentChoice = await p.select({
    message: '[Pillar 4] Subagent Context Isolation:',
    options: [
      {
        value: 'guardrail',
        label: 'Exploration Guardrail Hook (Default, recommended)',
        hint: 'Non-blocking note after 15 consecutive searches'
      },
      {
        value: 'orchestrator',
        label: 'Orchestrator Pattern (Tool Permission Scoping)',
        hint: 'Installs orchestrator.md omitting Edit/Write tools'
      },
      {
        value: 'both',
        label: 'Both (Exploration Guardrail + Orchestrator Template)',
        hint: 'Maximum protection'
      }
    ]
  });
  if (p.isCancel(subagentChoice)) process.exit(0);

  // Pillar 5: Episodic Memory
  const memoryChoice = await p.select({
    message: '[Pillar 5] Episodic Memory (Cross-Session Learning):',
    options: [
      {
        value: 'builtin',
        label: 'Built-in Claude Auto-Memory (Default, recommended)',
        hint: 'Zero-dependency, machine-local, easy setup'
      },
      {
        value: 'context-mode',
        label: 'context-mode (Power tool, steeper learning curve)',
        hint: 'Context virtualization via MCP (mksglu/context-mode)'
      }
    ]
  });
  if (p.isCancel(memoryChoice)) process.exit(0);

  // Layer 2: Optional SDD Methodology
  const sddChoice = await p.select({
    message: '[Layer 2] SDD / Planning Methodology (Optional):',
    options: [
      {
        value: 'none',
        label: 'None / Decide later (Default, methodology-agnostic)',
        hint: 'Keep purely flexible'
      },
      {
        value: 'superpowers',
        label: 'Superpowers SDD (obra/superpowers)',
        hint: 'Strict TDD red-green-refactor loop'
      },
      {
        value: 'gsd',
        label: 'GetShitDone — GSD (open-gsd/gsd-core)',
        hint: 'Contract-first task phase loops'
      },
      {
        value: 'ecc',
        label: 'Everything Claude Code — ECC (affaan-m/ECC)',
        hint: 'PDCA engineering cycles & skills'
      },
      {
        value: 'elephant-goldfish',
        label: 'Elephant-Goldfish Model (google/elephant-goldfish-model)',
        hint: 'Stateless goldfish reviews + elephant memory'
      }
    ]
  });
  if (p.isCancel(sddChoice)) process.exit(0);

  // Context Bootstrapping
  const dropContext = await p.confirm({
    message:
      'Would you like to drop context of what you will build right now to generate custom Tier-1 rules?',
    initialValue: false
  });
  if (p.isCancel(dropContext)) process.exit(0);

  let projectContext = null;
  if (dropContext) {
    const projectName = await p.text({
      message: 'Project name:',
      initialValue: path.basename(targetDir),
      validate: (v) => (!v ? 'Project name is required' : undefined)
    });
    if (p.isCancel(projectName)) process.exit(0);

    const description = await p.text({
      message: 'Brief description / purpose:',
      placeholder: 'e.g., Real-time collaboration platform with WebSockets'
    });
    if (p.isCancel(description)) process.exit(0);

    const techStack = await p.text({
      message: 'Core tech stack:',
      placeholder: 'e.g., Next.js 15, TypeScript, Tailwind, Postgres, Prisma'
    });
    if (p.isCancel(techStack)) process.exit(0);

    const customRules = await p.text({
      message: 'Any specific architectural constraints / laws? (Optional):',
      placeholder: 'e.g., Must use functional components; tests must be colocated'
    });
    if (p.isCancel(customRules)) process.exit(0);

    projectContext = {
      projectName: projectName || path.basename(targetDir),
      description: description || 'Modern software application',
      techStack: techStack || 'TypeScript / Node.js',
      customRules: customRules || ''
    };
  }

  const spinner = p.spinner();
  spinner.start('Scaffolding Agent Context Forge harness into repository...');

  const { files, backups, proposals } = scaffoldProject(targetDir, {
    engine,
    lsp,
    masking,
    subagentIsolation: subagentChoice,
    episodicMemory: memoryChoice,
    sdd: sddChoice,
    projectContext
  });

  spinner.stop(`Scaffolded ${files.length} files successfully!`);

  if (backups.length > 0) {
    p.log.info(`Backed up before changing:\n${backups.map((f) => `  ${f}`).join('\n')}`);
  }
  if (proposals.length > 0) {
    p.log.warn(
      `Kept your existing files. Our versions were written alongside them for you to merge by hand:\n` +
        proposals.map((f) => `  ${f}`).join('\n')
    );
  }

  // Run doctor check inline if possible
  const doctorScript = path.join(targetDir, 'scripts', 'agent-gates', 'doctor.sh');
  if (fs.existsSync(doctorScript)) {
    try {
      p.log.step('Running pre-flight environment doctor:');
      const doctorOutput = execSync(`"${doctorScript}"`, {
        cwd: targetDir,
        encoding: 'utf-8'
      });
      console.log(pc.dim(doctorOutput.trim()));
    } catch {}
  }

  // Interactively offer to install missing tools (rtk, and a language server when LSP was chosen)
  await offerToolInstallations(targetDir, { lsp: lsp === 'native' });

  p.note(
    `• Tier-1 Rules: CLAUDE.md & AGENTS.md\n` +
      `• Claude Hooks: .claude/settings.json\n` +
      `• Pre-flight Doctor: ./scripts/agent-gates/doctor.sh\n` +
      `• Optional Universal Git Hook: git config core.hooksPath .githooks`,
    'Next Steps'
  );

  p.outro(pc.green('✨ Agent Context Forge is ready! Happy pairing with AI agents.'));
}
