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
    assert.equal(settings.env.ENABLE_LSP_TOOL, '1');
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

    const html = generateHtmlReport(report);
    assert.ok(html.includes('Context Health Audit Dashboard'));
    assert.ok(html.includes(`${report.totalScore}`));
    assert.ok(html.includes('Pillar 1'));
    assert.ok(html.includes('Pillar 5'));

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });
});
