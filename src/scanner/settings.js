import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const readJson = (file) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Loads the settings files Claude Code applies to a project on this machine, most specific
 * first. Missing or unparseable files are skipped.
 *
 * @returns {{scope: 'local'|'project'|'user', file: string, settings: object}[]}
 */
export function loadSettingsLayers(projectDir) {
  return [
    { scope: 'local', file: path.join(projectDir, '.claude', 'settings.local.json') },
    { scope: 'project', file: path.join(projectDir, '.claude', 'settings.json') },
    { scope: 'user', file: path.join(os.homedir(), '.claude', 'settings.json') }
  ]
    .map((layer) => ({ ...layer, settings: readJson(layer.file) }))
    .filter((layer) => layer.settings);
}

/**
 * Lists every command hook wired for an event across the given settings layers.
 *
 * @returns {{scope: string, matcher: string, command: string}[]}
 */
export function hookCommands(layers, event) {
  return layers.flatMap(({ scope, settings }) => {
    const groups = Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : [];
    return groups.flatMap((group) =>
      (Array.isArray(group?.hooks) ? group.hooks : [])
        .filter((hook) => typeof hook?.command === 'string')
        .map((hook) => ({ scope, matcher: group.matcher ?? '', command: hook.command }))
    );
  });
}

/**
 * Resolves the script a hook command runs from the project directory, written as
 * `"$CLAUDE_PROJECT_DIR/path"`, and checks that it exists and is executable.
 *
 * @returns {{file: string|null, ok: boolean}} `file` is null when the command does not
 *   run a project script, in which case it cannot be checked and `ok` is true.
 */
export function projectScriptStatus(projectDir, command) {
  const match = command.match(/^\s*"?\$(?:CLAUDE_PROJECT_DIR|\{CLAUDE_PROJECT_DIR\})\/([^"\s]+)"?/);
  if (!match) return { file: null, ok: true };
  const file = match[1];
  try {
    fs.accessSync(path.join(projectDir, file), fs.constants.X_OK);
    return { file, ok: true };
  } catch {
    return { file, ok: false };
  }
}

/**
 * Finds hooks for an event whose command matches `pattern`, and reports whether at least
 * one of them actually works (its project script, if any, exists and is executable).
 *
 * @returns {{wired: boolean, working: boolean, broken: string[]}} `broken` lists the
 *   project scripts that matching hooks point to but that are missing or not executable.
 */
export function findHook(projectDir, layers, event, pattern) {
  const matches = hookCommands(layers, event).filter((hook) => pattern.test(hook.command));
  const statuses = matches.map((hook) => projectScriptStatus(projectDir, hook.command));
  return {
    wired: matches.length > 0,
    working: statuses.some((status) => status.ok),
    broken: statuses.filter((status) => !status.ok).map((status) => status.file)
  };
}
