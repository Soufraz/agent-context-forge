/**
 * Official code intelligence plugins and the language server binary each one starts.
 *
 * Claude Code keeps its LSP tool inactive until a code intelligence plugin is installed for
 * the language; a language server binary on PATH is not enough on its own, and there is no
 * settings flag that turns it on. Source: https://code.claude.com/docs/en/plugins/code-intelligence
 */

export const LSP_MARKETPLACE = 'claude-plugins-official';

const TYPESCRIPT = {
  language: 'TypeScript/JavaScript',
  plugin: 'typescript-lsp',
  binary: 'typescript-language-server',
  install: 'npm install -g typescript-language-server typescript'
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
