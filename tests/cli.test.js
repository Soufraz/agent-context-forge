import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import { inspectDirectory } from '../src/detector.js';
import { generateProjectContext } from '../src/context-generator.js';
import { scaffoldProject, isExistingInstall, installedContextDrift, PROPOSAL_SUFFIX } from '../src/scaffolder.js';
import { explainContextDrift } from '../src/index.js';
import { auditProject } from '../src/scanner/index.js';
import { generateHtmlReport } from '../src/reporter/html-template.js';
import { buildUsageReport, formatUsageReport, projectTranscriptDir } from '../src/usage-report.js';
import { autoCompactStatus, describeAutoCompact, enableAutoCompactLocally } from '../src/compaction.js';
import { auditPillar2 } from '../src/scanner/pillar2-disclosure.js';
import { auditPillar5 } from '../src/scanner/pillar5-memory.js';
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
    // Lockfiles are guarded by a Read hook, not deny rules (those also block grep on them)
    assert.equal(settings.permissions, undefined);
    const readHooks = settings.hooks.PreToolUse.filter((g) => g.matcher === 'Read').flatMap((g) => g.hooks);
    assert.ok(readHooks.some((h) => h.command.includes('guard-whole-file-reads.sh')));
    assert.equal(settings.env.RTK_SUPPRESS_HOOK_WARNING, '1');
    assert.ok(settings.hooks.SessionStart[0].hooks[0].command.includes('session-context.sh'));
    assert.ok(settings.hooks.SessionStart);
    assert.ok(settings.hooks.PreToolUse);
    assert.ok(settings.hooks.PreCompact);

    // Context Stability: one script on every event it handles, and a starter rules file
    const runsStability = (event) =>
      settings.hooks[event].some((g) => g.hooks.some((h) => h.command.includes('context-stability.py')));
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PreToolUse', 'Stop']) {
      assert.ok(runsStability(event), `context-stability.py must run on ${event}`);
    }
    assert.equal(settings.hooks.SessionStart[0].matcher, undefined, 'SessionStart must also fire after compaction');
    const rulesFile = JSON.parse(fs.readFileSync(path.join(tmpProject, '.claude', 'enforced-rules.json'), 'utf-8'));
    assert.deepEqual(rulesFile.rules, []);
    const stabilityStat = fs.statSync(path.join(tmpProject, '.claude', 'hooks', 'context-stability.py'));
    assert.equal(stabilityStat.mode & 0o111, 0o111, 'context-stability.py must be executable');

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
        // One user rule, one rule v0.1 of this harness added
        permissions: { allow: ['Bash(make:*)'], deny: ['Read(./secrets/**)', 'Read(**/pnpm-lock.yaml)'] },
        env: { RTK_SUPPRESS_HOOK_WARNING: '0', MY_VAR: 'x' },
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
    assert.deepEqual(settings.permissions.deny, ['Read(./secrets/**)'], 'legacy harness deny rules are removed');
    assert.deepEqual(settings.env, { RTK_SUPPRESS_HOOK_WARNING: '0', MY_VAR: 'x' }, "the user's env values win");
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

  // Context drift hook: on for new installs, opt-in for projects that already have a manifest
  const driftCommand = '"$CLAUDE_PROJECT_DIR/.claude/hooks/context-drift.py"';
  const driftHooks = (project, event) => {
    const settings = JSON.parse(fs.readFileSync(path.join(project, '.claude', 'settings.json'), 'utf-8'));
    return (settings.hooks[event] || []).flatMap((g) => g.hooks).filter((h) => h.command.includes('context-drift.py'));
  };
  const readManifest = (project) =>
    JSON.parse(fs.readFileSync(path.join(project, '.claude', 'context-forge.json'), 'utf-8'));
  const driftScript = (project) => path.join(project, '.claude', 'hooks', 'context-drift.py');

  test('scaffoldProject: a new install wires context-drift.py on SessionStart and Stop with a Stop timeout above 150', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_drift_new_'));
    scaffoldProject(tmpProject, {});

    const settings = JSON.parse(fs.readFileSync(path.join(tmpProject, '.claude', 'settings.json'), 'utf-8'));
    for (const event of ['SessionStart', 'Stop']) {
      const hooks = driftHooks(tmpProject, event);
      assert.equal(hooks.length, 1, `context-drift.py runs once on ${event}`);
      assert.equal(hooks[0].command, driftCommand);
      assert.ok(hooks[0].timeout > 150, `${event} timeout must exceed the judge's 150 s`);
    }
    const group = settings.hooks.SessionStart.find((g) => g.hooks.some((h) => h.command.includes('context-drift.py')));
    assert.equal(group.matcher, undefined, 'SessionStart must also fire after compaction');
    for (const event of Object.keys(settings.hooks).filter((e) => e !== 'SessionStart' && e !== 'Stop')) {
      assert.equal(driftHooks(tmpProject, event).length, 0, `no context-drift.py on ${event}`);
    }
    assert.equal(readManifest(tmpProject).contextDrift, 'on');

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('scaffoldProject: re-running on an existing acf project without the option does not add the hook', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_drift_upgrade_'));
    scaffoldProject(tmpProject, { contextDrift: 'off' });
    assert.equal(driftHooks(tmpProject, 'Stop').length, 0);

    // An upgrade from an older acf: a manifest without the key
    const manifestPath = path.join(tmpProject, '.claude', 'context-forge.json');
    const { contextDrift, ...older } = readManifest(tmpProject);
    fs.writeFileSync(manifestPath, JSON.stringify(older, null, 2) + '\n');

    scaffoldProject(tmpProject, {});
    for (const event of ['SessionStart', 'Stop']) {
      assert.equal(driftHooks(tmpProject, event).length, 0, `no context-drift.py on ${event}`);
    }
    assert.ok(!fs.existsSync(driftScript(tmpProject)), 'the script is not installed');
    assert.equal(readManifest(tmpProject).contextDrift, 'off');

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test("scaffoldProject: re-running with contextDrift 'on' adds it, and the manifest records it", () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_drift_optin_'));
    scaffoldProject(tmpProject, { contextDrift: 'off' });

    scaffoldProject(tmpProject, { contextDrift: 'on' });
    for (const event of ['SessionStart', 'Stop']) {
      assert.equal(driftHooks(tmpProject, event).length, 1, `context-drift.py runs once on ${event}`);
    }
    assert.equal(readManifest(tmpProject).contextDrift, 'on');

    // Re-running without the option keeps it on, and does not duplicate the entries
    const again = scaffoldProject(tmpProject, {});
    assert.equal(driftHooks(tmpProject, 'Stop').length, 1);
    assert.equal(readManifest(tmpProject).contextDrift, 'on');
    assert.equal(again.backups.length, 0);

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test("scaffoldProject: contextDrift 'off' on a project that had it removes its hook entries and keeps user hooks", () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_drift_off_'));
    scaffoldProject(tmpProject, {});
    assert.equal(driftHooks(tmpProject, 'Stop').length, 1);

    const settingsPath = path.join(tmpProject, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    settings.hooks.Stop.push({ hooks: [{ type: 'command', command: 'my-stop.sh' }] });
    settings.hooks.SessionStart[0].hooks.push({ type: 'command', command: 'my-start.sh' });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

    scaffoldProject(tmpProject, { contextDrift: 'off' });
    for (const event of ['SessionStart', 'Stop']) {
      assert.equal(driftHooks(tmpProject, event).length, 0, `no context-drift.py on ${event}`);
    }
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    assert.ok(after.hooks.Stop.some((g) => g.hooks.some((h) => h.command === 'my-stop.sh')));
    assert.ok(after.hooks.SessionStart.some((g) => g.hooks.some((h) => h.command === 'my-start.sh')));
    assert.equal(readManifest(tmpProject).contextDrift, 'off');

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('scaffoldProject: the hook script is installed executable only when on', () => {
    const on = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_drift_script_on_'));
    const off = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_drift_script_off_'));
    scaffoldProject(on, { contextDrift: 'on' });
    scaffoldProject(off, { contextDrift: 'off' });

    assert.equal(fs.statSync(driftScript(on)).mode & 0o111, 0o111, 'context-drift.py must be executable');
    assert.ok(!fs.existsSync(driftScript(off)));

    fs.rmSync(on, { recursive: true, force: true });
    fs.rmSync(off, { recursive: true, force: true });
  });

  test('isExistingInstall: false for an empty dir and a dir with an unparseable manifest, true after scaffoldProject', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_isexisting_'));
    assert.equal(isExistingInstall(tmpProject), false);

    fs.mkdirSync(path.join(tmpProject, '.claude'));
    fs.writeFileSync(path.join(tmpProject, '.claude', 'context-forge.json'), '{ not json');
    assert.equal(isExistingInstall(tmpProject), false);

    fs.rmSync(path.join(tmpProject, '.claude', 'context-forge.json'));
    scaffoldProject(tmpProject, {});
    assert.equal(isExistingInstall(tmpProject), true);

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test("installedContextDrift: null for a new project, 'on' or 'off' as the manifest records it", () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_installed_drift_'));
    assert.equal(installedContextDrift(tmpProject), null);

    scaffoldProject(tmpProject, { contextDrift: 'on' });
    assert.equal(installedContextDrift(tmpProject), 'on');

    scaffoldProject(tmpProject, { contextDrift: 'off' });
    assert.equal(installedContextDrift(tmpProject), 'off');

    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test("explainContextDrift: states that source diffs are sent to a model through claude -p under the user's login, the typical cost and its ceiling, when it skips the model, and the off switch", () => {
    const text = explainContextDrift();
    assert.match(text, /claude -p/);
    assert.match(text, /diff/);
    assert.match(text, /login/);
    assert.match(text, /\$0\.001-0\.002/);
    assert.match(text, /at most about \$0\.05/);
    assert.match(text, /docs other than the\s+context files, tests or formatting skips the model call/);
    assert.match(text, /never edits/);
    assert.match(text, /ACF_CONTEXT_DRIFT=off/);
    assert.match(text, /\.claude\/settings\.json/);
    assert.ok(text.split('\n').length <= 10, 'stays short enough for a terminal');
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

  test('scaffoldProject: the SDD choice reaches CLAUDE.md without custom project context', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_sdd_'));
    scaffoldProject(tmpProject, { sdd: 'gsd' });
    const claudeMd = fs.readFileSync(path.join(tmpProject, 'CLAUDE.md'), 'utf-8');
    assert.ok(claudeMd.includes('# Project Instructions'));
    assert.ok(claudeMd.includes('## Planning & SDD Methodology: GetShitDone (GSD)'));
    fs.rmSync(tmpProject, { recursive: true, force: true });
  });

  test('scaffoldProject: the LSP references rule is opt-in, since its cost is unproven', () => {
    const lspRule = /`LSP` tool's references lookup/;
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_nolsp_'));
    scaffoldProject(plain);
    assert.ok(!lspRule.test(fs.readFileSync(path.join(plain, 'CLAUDE.md'), 'utf-8')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(plain, '.claude', 'context-forge.json'), 'utf-8')).lsp, 'off');
    const doctor = execSync(`"${path.join(plain, 'scripts', 'agent-gates', 'check-lsp.sh')}"`, {
      cwd: plain,
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: plain }
    });
    assert.ok(!doctor.includes('⚠️'), 'no LSP warning reaches the session when LSP is off');

    const chosen = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_lsp_on_'));
    scaffoldProject(chosen, { lsp: 'native' });
    assert.ok(lspRule.test(fs.readFileSync(path.join(chosen, 'CLAUDE.md'), 'utf-8')));
    assert.ok(!lspRule.test(generateProjectContext({ projectName: 'X' }).claudeMdContent));
    assert.ok(!generateProjectContext({ projectName: 'X' }).agentsMdContent.includes('LSP Navigation'));
    fs.rmSync(plain, { recursive: true, force: true });
    fs.rmSync(chosen, { recursive: true, force: true });
  });

  test('usage report: reads transcripts, counts each response once and skips subagents', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_usage_'));
    const project = '/work/my.app';
    const dir = projectTranscriptDir(project, home);
    assert.equal(path.basename(dir), '-work-my-app');
    fs.mkdirSync(dir, { recursive: true });
    const turn = (id, read, write1h, out, extra = {}) =>
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-11-08T10:00:00Z',
        message: {
          id,
          usage: {
            input_tokens: 0,
            cache_read_input_tokens: read,
            cache_creation_input_tokens: write1h,
            cache_creation: { ephemeral_1h_input_tokens: write1h, ephemeral_5m_input_tokens: 0 },
            output_tokens: out
          }
        },
        ...extra
      });
    fs.writeFileSync(
      path.join(dir, 's1.jsonl'),
      [
        turn('m1', 0, 50_000, 100),
        turn('m1', 0, 50_000, 100), // a second content block of the same response
        turn('sub', 900_000, 0, 10, { isSidechain: true }),
        JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
        turn('m2', 250_000, 0, 200)
      ].join('\n')
    );
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ autoCompactEnabled: false }));

    const report = buildUsageReport({ projectDir: project, home });
    assert.equal(report.sessions.length, 1);
    assert.equal(report.requests, 2);
    assert.equal(report.medianFirstPrompt, 50_000);
    assert.equal(report.peakContext, 250_000);
    assert.equal(report.compactions, 1);
    assert.equal(report.compaction.enabled, false);
    assert.equal(report.compaction.source, 'user');
    // re-sent 250k x 0.1 = 25k, written 50k x 2 = 100k, output 300 x 5 = 1.5k
    assert.ok(Math.abs(report.share.cacheWrite1h - 100_000 / 126_500) < 1e-9);
    const text = formatUsageReport(report);
    assert.ok(text.includes('Auto-compaction is off'));
    assert.ok(text.includes('fixed prompt is ~50k'));
    assert.ok(formatUsageReport(buildUsageReport({ projectDir: '/nothing', home })).startsWith('No Claude Code sessions'));
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('auto-compaction: the most specific setting wins, and the installer turns it on locally', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_compact_home_'));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_compact_'));
    assert.deepEqual(autoCompactStatus(project, { home, env: {} }), { enabled: true, source: 'default', file: null });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ autoCompactEnabled: false }));
    const off = autoCompactStatus(project, { home, env: {} });
    assert.equal(off.enabled, false);
    assert.match(describeAutoCompact(off), /~\/\.claude\/settings\.json/);

    fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules');
    enableAutoCompactLocally(project);
    enableAutoCompactLocally(project);
    assert.deepEqual(autoCompactStatus(project, { home, env: {} }).enabled, true, 'project local beats user');
    assert.equal(fs.readFileSync(path.join(project, '.gitignore'), 'utf-8'), 'node_modules\n.claude/settings.local.json\n');
    assert.equal(autoCompactStatus(project, { home, env: { DISABLE_AUTO_COMPACT: '1' } }).source, 'env');

    const doctor = execSync(`"${path.join(process.cwd(), 'scripts', 'agent-gates', 'check-memory.sh')}"`, {
      cwd: project,
      encoding: 'utf-8',
      env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project, DISABLE_AUTO_COMPACT: '' }
    });
    assert.match(doctor, /Auto-Compaction\]: on/);
    fs.rmSync(path.join(project, '.claude', 'settings.local.json'));
    const doctorOff = execSync(`"${path.join(process.cwd(), 'scripts', 'agent-gates', 'check-memory.sh')}"`, {
      cwd: project,
      encoding: 'utf-8',
      env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project, DISABLE_AUTO_COMPACT: '' }
    });
    assert.match(doctorOff, /⚠️ {2}\[Auto-Compaction\]: off/);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  test('auditPillar1: dead path check flags missing files, not expressions or generated output', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_deadpaths_'));
    execSync('git init -q', { cwd: tmpProject });
    fs.mkdirSync(path.join(tmpProject, 'packages', 'app', 'src', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(tmpProject, 'packages', 'app', 'src', 'cli', 'dev.ts'), '');
    fs.writeFileSync(path.join(tmpProject, '.gitignore'), '.next/\n');
    execSync('git add -A', { cwd: tmpProject });
    fs.writeFileSync(
      path.join(tmpProject, 'CLAUDE.md'),
      [
        '- Run `scripts/missing.sh` before committing.', // really missing
        '- Dev server: `src/cli/dev.ts`.', // package-relative, exists under packages/app
        '- Never read `.next/` output.', // git-ignored build output
        '- Native addons end in `.node`; query with `.items.name`.', // not paths
        '- Branches look like `.../ABC-1/fix-thing`.' // placeholder
      ].join('\n')
    );

    const finding = auditProject(tmpProject).pillars.pillar1.findings.find((f) => /Dead Path/.test(f.title));
    assert.deepEqual(finding?.details, ['scripts/missing.sh']);

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

  test('auditPillar5: a SessionStart hook with no matcher also runs after compaction', () => {
    const tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'acf_test_pillar5_'));
    fs.mkdirSync(path.join(tmpProject, '.claude'));
    const withMatcher = (matcher) => {
      const group = { hooks: [{ type: 'command', command: 'echo facts' }] };
      if (matcher !== undefined) group.matcher = matcher;
      fs.writeFileSync(path.join(tmpProject, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [group] } }));
      return auditPillar5(tmpProject).findings.some((f) => f.title.includes('Lossy Compaction Protection Active'));
    };
    // Omitted, "" and "*" match every source, compact included (code.claude.com/docs/en/hooks)
    assert.equal(withMatcher(undefined), true);
    assert.equal(withMatcher(''), true);
    assert.equal(withMatcher('*'), true);
    assert.equal(withMatcher('startup|compact'), true);
    assert.equal(withMatcher('startup'), false);
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
      return report.score - (report.findings.some((f) => f.title.startsWith('No Lockfiles in Repository Root')) ? 4 : 0);
    };

    try {
      fs.writeFileSync(path.join(tmpProject, 'package.json'), '{}');
      assert.equal(lspScore(), 0);

      // A Python server earns nothing in a TypeScript repo
      fakeBinary('pyright-langserver');
      assert.equal(lspScore(), 0);

      // The server binary alone can't start without a tsserver.js (TypeScript 7 ships none)
      fakeBinary('typescript-language-server');
      assert.equal(lspScore(), 0);
      fs.mkdirSync(path.join(tmpProject, 'node_modules', 'typescript', 'lib'), { recursive: true });
      fs.writeFileSync(path.join(tmpProject, 'node_modules', 'typescript', 'lib', 'tsserver.js'), '');
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
