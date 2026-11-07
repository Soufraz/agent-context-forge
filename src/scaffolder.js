import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProjectContext, generateStarterClaudeMd } from './context-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Suffix for our version of a user-owned file we refused to overwrite. It must not end in
// `.md`, or Claude Code would load a proposed `.claude/agents/*.md` as a duplicate agent.
export const PROPOSAL_SUFFIX = '.context-forge-new';

// Hook scripts this harness wires into settings.json. On re-install, hook entries running
// these scripts are replaced with the current definitions; every other hook is left alone.
const HARNESS_HOOK_SCRIPTS = [
  'scripts/agent-gates/doctor.sh',
  'scripts/agent-gates/session-context.sh',
  '.claude/hooks/rewrite-rtk.sh',
  '.claude/hooks/guard-whole-file-reads.sh',
  '.claude/hooks/pre-commit-prefix-stability.sh',
  '.claude/hooks/guard-subagent-isolation.py',
  '.claude/hooks/pre-compact-handover.sh'
];

// Read deny rules that v0.1 of this harness added. They also block Grep and `grep` on those
// files, which made agents fail lockfile questions, so upgrades remove them; the
// guard-whole-file-reads hook replaces them.
const LEGACY_HARNESS_DENY_RULES = new Set([
  'Read(**/package-lock.json)',
  'Read(**/pnpm-lock.yaml)',
  'Read(**/yarn.lock)',
  'Read(**/Cargo.lock)',
  'Read(**/poetry.lock)',
  'Read(**/uv.lock)',
  'Read(**/node_modules/**)',
  'Read(**/dist/**)',
  'Read(**/build/**)',
  'Read(**/.next/**)',
  'Read(**/coverage/**)',
  'Read(**/*.min.js)',
  'Read(**/*.min.css)',
  'Read(**/*.map)'
]);

const sha256 = (content) => crypto.createHash('sha256').update(content).digest('hex');

const isHarnessHook = (hook) =>
  typeof hook?.command === 'string' &&
  HARNESS_HOOK_SCRIPTS.some((script) => hook.command.includes(script));

/**
 * Merges the harness settings into an existing settings object without dropping anything
 * the user configured: deny rules are unioned, and only hook entries that run this
 * harness's own scripts are replaced.
 */
export function mergeSettings(existing, ours) {
  const merged = { ...existing };
  if (!merged.$schema) merged.$schema = ours.$schema;

  // The user's env values win over ours
  if (ours.env || existing.env) {
    merged.env = { ...(ours.env || {}), ...(existing.env || {}) };
  }

  if (existing.permissions) {
    merged.permissions = { ...existing.permissions };
    if (Array.isArray(existing.permissions.deny)) {
      const deny = existing.permissions.deny.filter((rule) => !LEGACY_HARNESS_DENY_RULES.has(rule));
      if (deny.length > 0) {
        merged.permissions.deny = deny;
      } else {
        delete merged.permissions.deny;
      }
    }
    if (Object.keys(merged.permissions).length === 0) delete merged.permissions;
  }

  merged.hooks = { ...(existing.hooks || {}) };
  for (const event of new Set([...Object.keys(merged.hooks), ...Object.keys(ours.hooks)])) {
    const userGroups = (Array.isArray(merged.hooks[event]) ? merged.hooks[event] : [])
      .map((group) => ({
        ...group,
        hooks: Array.isArray(group.hooks) ? group.hooks.filter((hook) => !isHarnessHook(hook)) : group.hooks
      }))
      .filter((group) => !Array.isArray(group.hooks) || group.hooks.length > 0);
    const groups = [...userGroups, ...(ours.hooks[event] || [])];
    if (groups.length > 0) {
      merged.hooks[event] = groups;
    } else {
      delete merged.hooks[event];
    }
  }

  return merged;
}

/**
 * Scaffolds the Agent Context Forge harness into a target directory.
 *
 * Existing files are never silently destroyed:
 * - `.claude/settings.json` is merged (see `mergeSettings`) and backed up before it changes.
 * - Harness-owned scripts are replaced; local edits are kept in a `.bak` copy first.
 * - User-owned files (CLAUDE.md, AGENTS.md, rules, agents, git hooks) are only replaced when
 *   they are unchanged since the last install. Otherwise the user's file is kept and our
 *   version is written next to it with the `PROPOSAL_SUFFIX` suffix.
 *
 * @param {string} targetDir Destination folder
 * @param {object} options Selected configuration options
 * @returns {{files: string[], backups: string[], proposals: string[]}} Paths relative to
 *   targetDir: files written, backups made, and proposals written beside user files
 */
export function scaffoldProject(targetDir, options = {}) {
  const {
    engine = 'claude',
    lsp = 'native',
    masking = 'rtk',
    subagentIsolation = 'guardrail',
    episodicMemory = 'builtin',
    sdd = 'none',
    projectContext = null
  } = options;

  const result = { files: [], backups: [], proposals: [] };
  const installedHashes = {};

  const manifestPath = path.join(targetDir, '.claude', 'context-forge.json');
  let previousHashes = {};
  try {
    previousHashes = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).files || {};
  } catch {}

  const ensureDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  };

  const backup = (dest) => {
    let backupPath = `${dest}.bak`;
    for (let i = 1; fs.existsSync(backupPath); i++) {
      backupPath = `${dest}.bak.${i}`;
    }
    fs.copyFileSync(dest, backupPath);
    result.backups.push(path.relative(targetDir, backupPath));
  };

  const write = (dest, content, isExecutable) => {
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, content);
    if (isExecutable) {
      fs.chmodSync(dest, 0o755);
    }
  };

  /**
   * @param {'harness' | 'user'} owner `harness` files are ours to upgrade (after a backup of
   *   local edits); `user` files are never replaced once edited.
   */
  const install = (dest, content, { isExecutable = false, owner = 'harness' } = {}) => {
    const rel = path.relative(targetDir, dest);
    const hash = sha256(content);

    if (fs.existsSync(dest)) {
      const currentHash = sha256(fs.readFileSync(dest));
      if (currentHash === hash) {
        if (isExecutable) fs.chmodSync(dest, 0o755);
        installedHashes[rel] = hash;
        return;
      }
      const unchangedSinceLastInstall = previousHashes[rel] === currentHash;
      if (!unchangedSinceLastInstall) {
        if (owner === 'user') {
          write(dest + PROPOSAL_SUFFIX, content, false);
          result.proposals.push(rel + PROPOSAL_SUFFIX);
          return;
        }
        backup(dest);
      }
    }

    write(dest, content, isExecutable);
    installedHashes[rel] = hash;
    result.files.push(rel);
  };

  const copyFileWithPerms = (src, dest, isExecutable = false, owner = 'harness') =>
    install(dest, fs.readFileSync(src), { isExecutable, owner });

  const writeFileWithPerms = (dest, content, isExecutable = false, owner = 'harness') =>
    install(dest, Buffer.from(content, 'utf-8'), { isExecutable, owner });

  const installSettings = (dest, ours) => {
    const rel = path.relative(targetDir, dest);
    let merged = ours;
    if (fs.existsSync(dest)) {
      const raw = fs.readFileSync(dest, 'utf-8');
      let existing;
      try {
        existing = JSON.parse(raw);
      } catch {}
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        // Unparseable settings: leave them for the user to fix, and propose ours alongside.
        write(dest + PROPOSAL_SUFFIX, JSON.stringify(ours, null, 2) + '\n', false);
        result.proposals.push(rel + PROPOSAL_SUFFIX);
        return;
      }
      merged = mergeSettings(existing, ours);
      const content = JSON.stringify(merged, null, 2) + '\n';
      if (content === raw) return;
      backup(dest);
    }
    write(dest, JSON.stringify(merged, null, 2) + '\n', false);
    result.files.push(rel);
  };

  // 1. Build .claude/settings.json dynamically based on user choices
  const settings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json'
  };

  // No settings flag turns on Claude Code's LSP tool: it needs a code intelligence plugin,
  // which the installer offers after scaffolding (see lsp-plugins.js).

  // rtk prints a "no hook installed" notice that only checks global settings; this project
  // install wires it, so keep the notice out of the agent's command output.
  if (masking === 'rtk') {
    settings.env = { RTK_SUPPRESS_HOOK_WARNING: '1' };
  }

  const bashHooks = [];
  if (masking === 'rtk') {
    bashHooks.push({
      type: 'command',
      command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/rewrite-rtk.sh"',
      timeout: 5
    });
  }
  bashHooks.push({
    type: 'command',
    command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/pre-commit-prefix-stability.sh"',
    timeout: 60,
    statusMessage: 'Validating context prefix stability before commit...'
  });

  const preToolUseList = [
    {
      matcher: 'Bash',
      hooks: bashHooks
    },
    {
      // Token-bomb protection: blocks only whole-file reads of lockfiles and bundles, so Grep and
      // `grep` on them keep working (permissions.deny Read rules would block those too)
      matcher: 'Read',
      hooks: [
        {
          type: 'command',
          command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-whole-file-reads.sh"',
          timeout: 5
        }
      ]
    }
  ];

  if (subagentIsolation === 'guardrail' || subagentIsolation === 'both') {
    preToolUseList.push({
      // Bash too: Claude Code searches with grep/find through Bash by default on macOS and Linux
      matcher: 'Read|Grep|Glob|Bash|Agent|Task|Write|Edit',
      hooks: [
        {
          type: 'command',
          command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-subagent-isolation.py"',
          timeout: 10
        }
      ]
    });
  }

  settings.hooks = {
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: '"$CLAUDE_PROJECT_DIR/scripts/agent-gates/session-context.sh"',
            statusMessage: 'Loading project facts and checking the environment...'
          }
        ]
      }
    ],
    PreToolUse: preToolUseList,
    PreCompact: [
      {
        hooks: [
          {
            type: 'command',
            command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/pre-compact-handover.sh"',
            statusMessage: 'Adding handover notes to the compaction summary...'
          }
        ]
      }
    ]
  };

  installSettings(path.join(targetDir, '.claude', 'settings.json'), settings);

  // 2. Copy Core Hooks
  const hooksDir = path.join(PACKAGE_ROOT, '.claude', 'hooks');
  copyFileWithPerms(
    path.join(hooksDir, 'pre-commit-prefix-stability.sh'),
    path.join(targetDir, '.claude', 'hooks', 'pre-commit-prefix-stability.sh'),
    true
  );
  copyFileWithPerms(
    path.join(hooksDir, 'pre-compact-handover.sh'),
    path.join(targetDir, '.claude', 'hooks', 'pre-compact-handover.sh'),
    true
  );
  copyFileWithPerms(
    path.join(hooksDir, 'guard-whole-file-reads.sh'),
    path.join(targetDir, '.claude', 'hooks', 'guard-whole-file-reads.sh'),
    true
  );

  if (masking === 'rtk') {
    copyFileWithPerms(
      path.join(hooksDir, 'rewrite-rtk.sh'),
      path.join(targetDir, '.claude', 'hooks', 'rewrite-rtk.sh'),
      true
    );
  }

  if (subagentIsolation === 'guardrail' || subagentIsolation === 'both') {
    copyFileWithPerms(
      path.join(hooksDir, 'guard-subagent-isolation.py'),
      path.join(targetDir, '.claude', 'hooks', 'guard-subagent-isolation.py'),
      true
    );
  }

  // 3. Orchestrator Template if requested
  if (subagentIsolation === 'orchestrator' || subagentIsolation === 'both') {
    const orchestratorSrc = path.join(PACKAGE_ROOT, '.claude', 'agents', 'orchestrator.md');
    if (fs.existsSync(orchestratorSrc)) {
      copyFileWithPerms(
        orchestratorSrc,
        path.join(targetDir, '.claude', 'agents', 'orchestrator.md'),
        false,
        'user'
      );
    }
  }

  // 4. Copy Environment Doctor & Gate Scripts
  const scriptsDir = path.join(PACKAGE_ROOT, 'scripts', 'agent-gates');
  copyFileWithPerms(
    path.join(scriptsDir, 'doctor.sh'),
    path.join(targetDir, 'scripts', 'agent-gates', 'doctor.sh'),
    true
  );
  copyFileWithPerms(
    path.join(scriptsDir, 'session-context.sh'),
    path.join(targetDir, 'scripts', 'agent-gates', 'session-context.sh'),
    true
  );
  copyFileWithPerms(
    path.join(scriptsDir, 'check-lsp.sh'),
    path.join(targetDir, 'scripts', 'agent-gates', 'check-lsp.sh'),
    true
  );
  copyFileWithPerms(
    path.join(scriptsDir, 'check-rtk.sh'),
    path.join(targetDir, 'scripts', 'agent-gates', 'check-rtk.sh'),
    true
  );
  copyFileWithPerms(
    path.join(scriptsDir, 'check-memory.sh'),
    path.join(targetDir, 'scripts', 'agent-gates', 'check-memory.sh'),
    true
  );

  // 5. Universal Git Hook
  const gitHookSrc = path.join(PACKAGE_ROOT, '.githooks', 'pre-commit');
  if (fs.existsSync(gitHookSrc)) {
    copyFileWithPerms(gitHookSrc, path.join(targetDir, '.githooks', 'pre-commit'), true, 'user');
  }

  // 6. Context Documents (Custom or Starter)
  // Claude Code reads only CLAUDE.md when both files exist, so a CLAUDE.md next to the user's
  // own AGENTS.md (not one this harness wrote) must import it, or those instructions stop loading.
  const agentsMdPath = path.join(targetDir, 'AGENTS.md');
  const userOwnsAgentsMd =
    fs.existsSync(agentsMdPath) && previousHashes['AGENTS.md'] !== sha256(fs.readFileSync(agentsMdPath));
  const withAgentsImport = (content) => (userOwnsAgentsMd ? `@AGENTS.md\n\n${content}` : content);

  if (projectContext) {
    const generated = generateProjectContext({
      ...projectContext,
      sdd,
      lsp,
      masking,
      episodicMemory
    });
    writeFileWithPerms(path.join(targetDir, 'CLAUDE.md'), withAgentsImport(generated.claudeMdContent), false, 'user');
    writeFileWithPerms(path.join(targetDir, 'AGENTS.md'), generated.agentsMdContent, false, 'user');
    writeFileWithPerms(
      path.join(targetDir, '.agents', 'rules', 'project-architecture.md'),
      generated.architectureRuleContent,
      false,
      'user'
    );
  } else {
    writeFileWithPerms(
      path.join(targetDir, 'CLAUDE.md'),
      withAgentsImport(generateStarterClaudeMd({ sdd })),
      false,
      'user'
    );
    copyFileWithPerms(path.join(PACKAGE_ROOT, 'AGENTS.md'), path.join(targetDir, 'AGENTS.md'), false, 'user');
    const rulesGitKeep = path.join(PACKAGE_ROOT, '.agents', 'rules', '.gitkeep');
    if (fs.existsSync(rulesGitKeep)) {
      copyFileWithPerms(rulesGitKeep, path.join(targetDir, '.agents', 'rules', '.gitkeep'));
    }
  }

  // 7. Context-Mode setup guide if selected
  if (episodicMemory === 'context-mode') {
    const contextModeGuide = `# context-mode Setup Guide

You selected [context-mode](https://github.com/mksglu/context-mode) for advanced episodic memory virtualization.

## Quickstart Setup
1. Follow the installation instructions at: https://github.com/mksglu/context-mode
2. Configure your Claude Code MCP server in \`.mcp.json\` or your user configuration:
\`\`\`json
{
  "mcpServers": {
    "context-mode": {
      "command": "npx",
      "args": ["-y", "context-mode"]
    }
  }
}
\`\`\`
3. Auto-Memory will work in tandem with context-mode to track cross-session state.
`;
    writeFileWithPerms(path.join(targetDir, '.claude', 'context-mode-guide.md'), contextModeGuide);
  }

  // 8. Save Context Forge Manifest for Doctor and Scans
  const manifest = {
    version: '0.1.0',
    engine,
    lsp: typeof lsp === 'object' ? lsp.custom : lsp,
    masking: typeof masking === 'object' ? masking.custom : masking,
    subagentIsolation,
    episodicMemory,
    sdd,
    installedAt: new Date().toISOString(),
    // Hashes of the files as written, so a later upgrade can tell unedited files from edited ones
    files: installedHashes
  };
  ensureDir(path.dirname(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  result.files.push(path.relative(targetDir, manifestPath));

  return result;
}
