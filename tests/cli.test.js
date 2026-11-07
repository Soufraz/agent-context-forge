import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { inspectDirectory } from '../src/detector.js';
import { generateProjectContext } from '../src/context-generator.js';
import { scaffoldProject, PROPOSAL_SUFFIX } from '../src/scaffolder.js';
import { auditProject } from '../src/scanner/index.js';
import { generateHtmlReport } from '../src/reporter/html-template.js';
import { auditPillar2 } from '../src/scanner/pillar2-disclosure.js';
import {
  auditPillar4,
  parseAgentFrontmatter,
  writeToolsGranted
} from '../src/scanner/pillar4-isolation.js';

// Keep the scanner from reading this machine's ~/.claude settings and memory
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_home_'));

describe('Agent Context Forge CLI & Scanner Suite', () => {
  test('inspectDirectory: correctly classifies empty and populated folders', () => {
    const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_empty_'));
    const emptyResult = inspectDirectory(tmpEmpty);
    assert.equal(emptyResult.isEmpty, true);
    assert.equal(emptyResult.isContextForgeInstalled, false);
    fs.rmSync(tmpEmpty, { recursive: true, force: true });

    const selfResult = inspectDirectory(process.cwd());
    assert.equal(selfResult.isEmpty, false);
    assert.ok(selfResult.projectTypes.length > 0);
  });

  test('generateProjectContext: produces compact Tier-1 and Tier-2 rules adhering to Pillar 1', () => {
    const ctx = generateProjectContext({
      projectName: 'TestApp',
      description: 'A test microservice for real-time payments',
      techStack: 'TypeScript / Node.js / Postgres',
      customRules: 'Never use any; all database queries must use parameterized transactions.',
      sdd: 'superpowers',
      lsp: 'native',
      masking: 'rtk',
      episodicMemory: 'builtin'
    });

    const claudeLines = ctx.claudeMdContent.split('\n');
    assert.ok(claudeLines.length < 150, `CLAUDE.md lines (${claudeLines.length}) must be < 150`);
    assert.ok(!/-\s*\[[ xX]\]/.test(ctx.claudeMdContent), 'Must contain zero volatile task checklists');
    assert.ok(!/#\d{1,6}\b/.test(ctx.claudeMdContent), 'Must contain zero volatile issue numbers');
    assert.ok(ctx.claudeMdContent.includes('TestApp'));
    assert.ok(ctx.claudeMdContent.includes('Superpowers'));

    assert.ok(ctx.agentsMdContent.includes('AGENTS.md'));
    assert.ok(ctx.architectureRuleContent.includes('parameterized transactions'));
  });

  test('scaffoldProject: generates fully configured harness with executable permissions', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_scaffold_'));

    const { files: createdFiles } = scaffoldProject(tmpProject, {
      engine: 'claude',
      lsp: 'native',
      masking: 'rtk',
      subagentIsolation: 'both',
      episodicMemory: 'context-mode',
      sdd: 'gsd',
      projectContext: {
        projectName: 'GsdApp',
        description: 'App with GSD methodology',
        techStack: 'Go'
      }
    });

    assert.ok(createdFiles.length >= 10, 'Should create at least 10 harness files');

    // Check settings.json
    const settingsPath = path.join(tmpProject, '.claude', 'settings.json');
    assert.ok(fs.existsSync(settingsPath));
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.equal(settings.env?.ENABLE_LSP_TOOL, undefined, 'no settings flag enables the LSP tool');
    assert.ok(Array.isArray(settings.permissions.deny));
    assert.ok(settings.permissions.deny.some((r) => r.includes('lock')));
    assert.ok(settings.hooks.SessionStart);
    assert.ok(settings.hooks.PreToolUse);
    assert.ok(settings.hooks.PreCompact);

    // Check script permissions (0755)
    const doctorStat = fs.statSync(path.join(tmpProject, 'scripts', 'agent-gates', 'doctor.sh'));
    assert.equal(doctorStat.mode & 0o111, 0o111, 'doctor.sh must be executable');

    const prefixHookStat = fs.statSync(
      path.join(tmpProject, '.claude', 'hooks', 'pre-commit-prefix-stability.sh')
    );
    assert.equal(prefixHookStat.mode & 0o111, 0o111, 'pre-commit-prefix-stability.sh must be executable');

    // Check orchestrator and context-mode guide
    assert.ok(fs.existsSync(path.join(tmpProject, '.claude', 'agents', 'orchestrator.md')));
    assert.ok(fs.existsSync(path.join(tmpProject, '.claude', 'context-mode-guide.md')));

    // Check manifest
    const manifestPath = path.join(tmpProject, '.claude', 'context-forge.json');
    assert.ok(fs.existsSync(manifestPath));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    assert.equal(manifest.engine, 'claude');
    assert.equal(manifest.episodicMemory, 'context-mode');
    assert.equal(manifest.sdd, 'gsd');

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('scaffoldProject: never destroys existing user files on install', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_existing_'));
    const claudeDir = path.join(tmpProject, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# My hand-written rules\n');
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(make:*)'], deny: ['Read(./secrets/**)'] },
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'my-stop.sh' }] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-bash-guard.sh' }] }]
        }
      })
    );

    const { backups, proposals } = scaffoldProject(tmpProject, { subagentIsolation: 'guardrail' });

    // User-owned CLAUDE.md is kept; ours is proposed alongside it
    assert.equal(fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf-8'), '# My hand-written rules\n');
    assert.ok(proposals.includes(`CLAUDE.md${PROPOSAL_SUFFIX}`));
    assert.ok(fs.existsSync(path.join(tmpProject, `CLAUDE.md${PROPOSAL_SUFFIX}`)));

    // settings.json is merged, not replaced, and the original is backed up
    const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
    assert.deepEqual(settings.permissions.allow, ['Bash(make:*)']);
    assert.ok(settings.permissions.deny.includes('Read(./secrets/**)'));
    assert.ok(settings.permissions.deny.some((r) => r.includes('lock')));
    assert.equal(settings.hooks.Stop[0].hooks[0].command, 'my-stop.sh');
    const preToolCommands = settings.hooks.PreToolUse.flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(preToolCommands.includes('my-bash-guard.sh'));
    assert.ok(preToolCommands.some((c) => c.includes('guard-subagent-isolation.py')));
    assert.ok(backups.includes(path.join('.claude', 'settings.json.bak')));

    // Re-running does not duplicate harness hooks or create more backups
    const second = scaffoldProject(tmpProject, { subagentIsolation: 'guardrail' });
    const settingsAgain = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));
    assert.deepEqual(settingsAgain, settings);
    assert.equal(second.backups.length, 0);

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('scaffoldProject: upgrades user-owned files only when unedited since last install', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_upgrade_'));
    const ctx = (description) => ({ projectName: 'App', description, techStack: 'Go' });

    scaffoldProject(tmpProject, { projectContext: ctx('first') });
    // Unedited since install: a re-install with new content replaces it
    const second = scaffoldProject(tmpProject, { projectContext: ctx('second') });
    assert.ok(fs.readFileSync(path.join(tmpProject, 'AGENTS.md'), 'utf-8').includes('second'));
    assert.equal(second.proposals.length, 0);

    // Edited by the user: kept, and ours is proposed alongside
    fs.appendFileSync(path.join(tmpProject, 'AGENTS.md'), '\nMy own rule.\n');
    const third = scaffoldProject(tmpProject, { projectContext: ctx('third') });
    assert.ok(fs.readFileSync(path.join(tmpProject, 'AGENTS.md'), 'utf-8').includes('My own rule.'));
    assert.ok(third.proposals.includes(`AGENTS.md${PROPOSAL_SUFFIX}`));

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test("scaffoldProject: keeps the project's own AGENTS.md loading in Claude Code", () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_agentsmd_'));
    fs.writeFileSync(path.join(tmpProject, 'AGENTS.md'), '# Our team rules\n');

    scaffoldProject(tmpProject, {});
    // Claude Code reads only CLAUDE.md when both exist, so ours must import theirs
    const claudeMd = fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf-8');
    assert.ok(claudeMd.startsWith('@AGENTS.md\n'));
    assert.equal(fs.readFileSync(path.join(tmpProject, 'AGENTS.md'), 'utf-8'), '# Our team rules\n');

    // A re-install keeps the import
    scaffoldProject(tmpProject, {});
    assert.ok(fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf-8').startsWith('@AGENTS.md\n'));

    // A fresh project gets both files from the harness and no import
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_fresh_'));
    scaffoldProject(fresh, {});
    assert.ok(!fs.readFileSync(path.join(fresh, 'CLAUDE.md'), 'utf-8').startsWith('@AGENTS.md'));

    fs.rmSync(tmpProject, { recursive: true, force: true });
    fs.rmSync(fresh, { recursive: true, force: true });
  });

  test('auditPillar1: measures what Claude Code loads, following @imports', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_imports_'));
    const longRules = Array.from({ length: 300 }, (_, i) => `- Rule ${i}`).join('\n');
    fs.writeFileSync(path.join(tmpProject, 'AGENTS.md'), `# Rules\n${longRules}\n- [ ] ship it\n`);
    fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '@AGENTS.md\n\nSee `@not-an-import.md`.\n');

    const report = auditProject(tmpProject);
    assert.ok(report.measurements.tier1.lines > 300, 'imported AGENTS.md is counted');
    assert.equal(report.measurements.tier1.file, 'CLAUDE.md + AGENTS.md');
    const p1 = report.pillars.pillar1.findings;
    assert.ok(p1.some((f) => f.title.startsWith('Tier-1 Context is Bloated')));
    assert.ok(p1.some((f) => f.details?.some((d) => d.file === 'AGENTS.md' && d.reason.startsWith('Task checklist'))));
    assert.ok(!p1.some((f) => f.title === 'AGENTS.md Is Not Loaded by Claude Code'));

    // Without the import, AGENTS.md is ignored by Claude Code and the scanner says so
    fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# Rules\n');
    assert.ok(auditProject(tmpProject).pillars.pillar1.findings.some((f) => f.title === 'AGENTS.md Is Not Loaded by Claude Code'));

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('auditPillar4: orchestrator scoping follows the real `tools` frontmatter, not comments', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_pillar4_'));
    scaffoldProject(tmpProject, { subagentIsolation: 'both' });
    const shipped = auditPillar4(tmpProject);
    assert.equal(shipped.score, shipped.maxScore, 'the shipped orchestrator must pass our own scanner');

    const agentPath = path.join(tmpProject, '.claude', 'agents', 'orchestrator.md');
    fs.writeFileSync(
      agentPath,
      '---\nname: orchestrator\ndescription: x\nallowed_tools:\n  - Read\n  - Agent\n---\nNever use Edit or Write.\n'
    );
    const ignoredKey = auditPillar4(tmpProject);
    assert.ok(ignoredKey.findings.some((f) => f.title.includes('allowed_tools')));
    assert.ok(ignoredKey.findings.some((f) => f.title.includes('Lacks Permission Scoping')));

    assert.deepEqual(writeToolsGranted(parseAgentFrontmatter('---\nname: o\ntools: Read, Agent\n---\n')), []);
    assert.deepEqual(writeToolsGranted(parseAgentFrontmatter('---\nname: o\ndisallowedTools: Edit, Write\n---\n')), []);
    assert.deepEqual(writeToolsGranted(parseAgentFrontmatter('---\nname: o\ntools:\n  - Read\n  - Edit\n---\n')), ['Edit']);

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('auditProject: hook checks need real, working hooks, not filenames in settings.json', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_wiring_'));
    fs.writeFileSync(path.join(tmpProject, 'CLAUDE.md'), '# Rules\n');
    const bare = auditProject(tmpProject);

    // Filenames mentioned in settings.json without any hook wired earn nothing
    fs.mkdirSync(path.join(tmpProject, '.claude'));
    const settingsPath = path.join(tmpProject, '.claude', 'settings.json');
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ note: 'pre-commit-prefix-stability.sh rtk guard-subagent-isolation.py PreCompact' })
    );
    assert.equal(auditProject(tmpProject).totalScore, bare.totalScore);

    // A hook wired to a missing script fails and is reported as a dead path
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Read',
              hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-subagent-isolation.py"' }]
            }
          ]
        }
      })
    );
    const broken = auditProject(tmpProject);
    assert.equal(broken.pillars.pillar4.score, bare.pillars.pillar4.score);
    assert.ok(broken.pillars.pillar4.findings.some((f) => f.status === 'fail' && f.title.includes('Missing Script')));
    assert.ok(broken.pillars.pillar1.findings.some((f) => f.details?.some((d) => d.includes('guard-subagent-isolation.py'))));

    // rtk's own hook from `rtk init -g` in user settings counts as a rewriter
    const userClaudeDir = path.join(process.env.HOME, '.claude');
    fs.mkdirSync(userClaudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(userClaudeDir, 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }] } })
    );
    const withNativeRtk = auditProject(tmpProject);
    assert.ok(withNativeRtk.pillars.pillar3.findings.some((f) => f.title === 'Transparent Command Rewriter Configured'));
    fs.rmSync(userClaudeDir, { recursive: true, force: true });

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('auditPillar2: LSP points need the plugin and server for the repo language', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_lsp_'));
    const mockBin = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_lsp_bin_'));
    const originalPath = process.env.PATH;
    process.env.PATH = `${mockBin}:/usr/bin:/bin`;
    const fakeBinary = (name) => fs.writeFileSync(path.join(mockBin, name), '#!/bin/sh\n', { mode: 0o755 });
    const lspScore = () => {
      const report = auditPillar2(tmpProject);
      // Leave out the token-bomb checks (8 pts) that don't depend on LSP setup
      return report.score - (report.findings.some((f) => f.title.startsWith('No Raw Lockfiles')) ? 4 : 0);
    };

    try {
      fs.writeFileSync(path.join(tmpProject, 'package.json'), '{}');
      assert.equal(lspScore(), 0);

      // A Python server earns nothing in a TypeScript repo
      fakeBinary('pyright-langserver');
      assert.equal(lspScore(), 0);

      fakeBinary('typescript-language-server');
      assert.equal(lspScore(), 8);

      fs.mkdirSync(path.join(tmpProject, '.claude'));
      fs.writeFileSync(
        path.join(tmpProject, '.claude', 'settings.json'),
        JSON.stringify({ enabledPlugins: { 'typescript-lsp@claude-plugins-official': true } })
      );
      assert.equal(lspScore(), 12);
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(tmpProject, { recursive: true, force: true });
      fs.rmSync(mockBin, { recursive: true, force: true });
    }
  });

  test('auditProject and generateHtmlReport: produces score, grade, and visual HTML dashboard', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_audit_'));

    scaffoldProject(tmpProject, {
      engine: 'claude',
      lsp: 'native',
      masking: 'rtk',
      subagentIsolation: 'guardrail',
      episodicMemory: 'builtin',
      sdd: 'none'
    });

    const report = auditProject(tmpProject);
    assert.equal(report.maxScore, 100);
    assert.ok(typeof report.totalScore === 'number' && report.totalScore > 0);
    assert.ok(['A', 'B', 'C', 'D', 'F'].includes(report.grade));
    assert.ok(report.pillars.pillar1);
    assert.ok(report.pillars.pillar2);
    assert.ok(report.pillars.pillar3);
    assert.ok(report.pillars.pillar4);
    assert.ok(report.pillars.pillar5);

    // Report only what was measured, never figures derived from the score
    assert.equal(report.cacheHitRate, undefined);
    assert.equal(report.measurements.tier1.file, 'CLAUDE.md');
    assert.ok(report.measurements.tier1.lines > 0);
    assert.equal(report.measurements.unprotectedLockfileTokens, 0);

    const html = generateHtmlReport(report);
    assert.ok(!/cache hit/i.test(html), 'no estimated cache hit rate in the dashboard');
    assert.ok(html.includes('Context Health Audit Dashboard'));
    assert.ok(html.includes(`${report.totalScore}`));
    assert.ok(html.includes('Pillar 1'));
    assert.ok(html.includes('Pillar 5'));

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });
});
