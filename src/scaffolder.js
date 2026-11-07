import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateProjectContext } from './context-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

/**
 * Scaffolds the Agent Context Forge harness into a target directory.
 *
 * @param {string} targetDir Destination folder
 * @param {object} options Selected configuration options
 * @returns {string[]} List of created or updated files relative to targetDir
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

  const createdFiles = [];

  const ensureDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  };

  const copyFileWithPerms = (src, dest, isExecutable = false) => {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    if (isExecutable) {
      fs.chmodSync(dest, 0o755);
    }
    createdFiles.push(path.relative(targetDir, dest));
  };

  const writeFileWithPerms = (dest, content, isExecutable = false) => {
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, content, 'utf-8');
    if (isExecutable) {
      fs.chmodSync(dest, 0o755);
    }
    createdFiles.push(path.relative(targetDir, dest));
  };

  // 1. Build .claude/settings.json dynamically based on user choices
  const settings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json'
  };

  if (lsp === 'native') {
    settings.env = {
      ENABLE_LSP_TOOL: '1'
    };
  }

  // Always protect against accidental lockfile & build token bombs
  settings.permissions = {
    deny: [
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
    ]
  };

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
    }
  ];

  if (subagentIsolation === 'guardrail' || subagentIsolation === 'both') {
    preToolUseList.push({
      matcher: 'Read|Grep|Glob|Task|Write|Edit',
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
            command: '"$CLAUDE_PROJECT_DIR/scripts/agent-gates/doctor.sh"',
            statusMessage: 'Checking agent context environment (LSP, RTK & Memory readiness)...'
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
            statusMessage: 'Snapshotting active state before context compaction...'
          }
        ]
      }
    ]
  };

  const settingsPath = path.join(targetDir, '.claude', 'settings.json');
  writeFileWithPerms(settingsPath, JSON.stringify(settings, null, 2) + '\n');

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
        path.join(targetDir, '.claude', 'agents', 'orchestrator.md')
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
    copyFileWithPerms(gitHookSrc, path.join(targetDir, '.githooks', 'pre-commit'), true);
  }

  // 6. Context Documents (Custom or Starter)
  if (projectContext) {
    const generated = generateProjectContext({
      ...projectContext,
      sdd,
      lsp,
      masking,
      episodicMemory
    });
    writeFileWithPerms(path.join(targetDir, 'CLAUDE.md'), generated.claudeMdContent);
    writeFileWithPerms(path.join(targetDir, 'AGENTS.md'), generated.agentsMdContent);
    writeFileWithPerms(
      path.join(targetDir, '.agents', 'rules', 'project-architecture.md'),
      generated.architectureRuleContent
    );
  } else {
    copyFileWithPerms(path.join(PACKAGE_ROOT, 'CLAUDE.md'), path.join(targetDir, 'CLAUDE.md'));
    copyFileWithPerms(path.join(PACKAGE_ROOT, 'AGENTS.md'), path.join(targetDir, 'AGENTS.md'));
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
    installedAt: new Date().toISOString()
  };
  writeFileWithPerms(
    path.join(targetDir, '.claude', 'context-forge.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );

  return createdFiles;
}
