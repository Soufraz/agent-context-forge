import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Official code intelligence plugins and the language server binary each one starts.
 *
 * Claude Code keeps its LSP tool inactive until a code intelligence plugin is installed for
 * the language; a language server binary on PATH is not enough on its own, and there is no
 * settings flag that turns it on. Source: https://code.claude.com/docs/en/plugins/code-intelligence
 */

export const LSP_MARKETPLACE = 'claude-plugins-official';

// typescript-language-server runs tsserver.js from the `typescript` package, and TypeScript 7
// (the native port) no longer ships one: pin 6, the last release that does.
const TYPESCRIPT = {
  language: 'TypeScript/JavaScript',
  plugin: 'typescript-lsp',
  binary: 'typescript-language-server',
  install: 'npm install -g typescript-language-server typescript@6',
  needsTsserver: true
};
const PYTHON = {
  language: 'Python',
  plugin: 'pyright-lsp',
  binary: 'pyright-langserver',
  install: 'npm install -g pyright'
};
const GO = {
  language: 'Go',
  plugin: 'gopls-lsp',
  binary: 'gopls',
  install: 'go install golang.org/x/tools/gopls@latest'
};
const RUST = {
  language: 'Rust',
  plugin: 'rust-analyzer-lsp',
  binary: 'rust-analyzer',
  install: 'rustup component add rust-analyzer'
};
const JAVA = {
  language: 'Java',
  plugin: 'jdtls-lsp',
  binary: 'jdtls',
  install: 'brew install jdtls'
};

// Keyed by the project types `inspectDirectory` reports
const BY_PROJECT_TYPE = {
  TypeScript: TYPESCRIPT,
  'JavaScript / Node.js': TYPESCRIPT,
  Python: PYTHON,
  Go: GO,
  Rust: RUST,
  'Java (Maven)': JAVA,
  'Java / Kotlin (Gradle)': JAVA
};

/**
 * @param {string[]} projectTypes Project types from `inspectDirectory`
 * @returns {{language: string, plugin: string, binary: string, install: string}[]}
 */
export function lspPluginsFor(projectTypes) {
  return [...new Set(projectTypes.map((type) => BY_PROJECT_TYPE[type]).filter(Boolean))];
}

export function pluginInstallCommand(entry) {
  return `claude plugin install ${entry.plugin}@${LSP_MARKETPLACE}`;
}

/**
 * Whether typescript-language-server can find a tsserver.js: in the project's own `typescript`
 * package, or in the global one it falls back to.
 */
export function tsserverAvailable(projectDir) {
  const tsserver = (root) => path.join(root, 'typescript', 'lib', 'tsserver.js');
  if (fs.existsSync(tsserver(path.join(projectDir, 'node_modules')))) return true;
  const npmRoot = spawnSync('npm', ['root', '-g'], { encoding: 'utf-8', timeout: 15000 });
  return npmRoot.status === 0 && fs.existsSync(tsserver(npmRoot.stdout.trim()));
}

const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Plugin ids Claude Code has installed and enabled for this folder, from
 * `claude plugin list --json`: user-scope installs, plus local/project-scope installs recorded
 * for this path. Enabling a plugin in settings is not enough on its own: it loads once it is
 * installed for the folder. Returns null when the claude CLI is unavailable.
 */
export function installedPluginsFor(projectDir) {
  const run = spawnSync('claude', ['plugin', 'list', '--json'], { cwd: projectDir, encoding: 'utf-8', timeout: 30000 });
  if (run.status !== 0) return null;
  let entries;
  try {
    entries = JSON.parse(run.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const here = realpath(projectDir);
  return entries
    .filter((e) => e.enabled !== false && (e.scope === 'user' || (e.projectPath && realpath(e.projectPath) === here)))
    .map((e) => e.id);
}

/**
 * Whether a plugin is enabled in any of the given settings layers (`enabledPlugins` keys
 * look like `typescript-lsp@claude-plugins-official`).
 */
export function isPluginEnabled(layers, plugin) {
  return layers.some(({ settings }) =>
    Object.entries(settings.enabledPlugins || {}).some(
      ([key, enabled]) => enabled === true && key.startsWith(`${plugin}@`)
    )
  );
}
