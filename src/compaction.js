/**
 * Auto-compaction: whether Claude Code will compact a long conversation on its own, and a way to
 * turn it back on for one project.
 *
 * With it off, a session grows until the model's context window is full. Every request re-sends
 * the whole conversation, and models answer less reliably as their input grows, so a session
 * that never compacts gets slower, costlier and less accurate as it goes. Compaction summarizes,
 * which loses detail; the harness's PreCompact handover and rule capture exist to limit that.
 *
 * `autoCompactEnabled` can be set in any settings file (user, project, or project local), and
 * the most specific one wins. `DISABLE_AUTO_COMPACT=1` turns it off and no setting can override it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOCAL_SETTINGS = path.join('.claude', 'settings.local.json');

/**
 * @returns {{enabled: boolean, source: 'default'|'env'|'local'|'project'|'user', file: string|null}}
 */
export function autoCompactStatus(projectDir, { home = os.homedir(), env = process.env } = {}) {
  if (env.DISABLE_AUTO_COMPACT === '1' || env.DISABLE_AUTO_COMPACT === 'true') {
    return { enabled: false, source: 'env', file: null };
  }
  const layers = [
    ['local', path.join(projectDir, LOCAL_SETTINGS)],
    ['project', path.join(projectDir, '.claude', 'settings.json')],
    ['user', path.join(home, '.claude', 'settings.json')]
  ];
  for (const [source, file] of layers) {
    try {
      const settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (settings.env?.DISABLE_AUTO_COMPACT === '1') return { enabled: false, source: 'env', file };
      if (typeof settings.autoCompactEnabled === 'boolean') return { enabled: settings.autoCompactEnabled, source, file };
    } catch {}
  }
  return { enabled: true, source: 'default', file: null };
}

/** One line for terminals and reports: where the setting comes from and what to do. */
export function describeAutoCompact(status) {
  if (status.enabled) {
    return status.source === 'default' ? 'on (Claude Code default)' : `on (${status.source} settings)`;
  }
  if (status.source === 'env') {
    return 'off: DISABLE_AUTO_COMPACT is set, which no setting can override; unset it to turn compaction back on';
  }
  const where = status.source === 'user' ? '~/.claude/settings.json' : status.file;
  return `off (autoCompactEnabled: false in ${where})`;
}

/**
 * Turns auto-compaction on for this project only, in .claude/settings.local.json (personal, not
 * shared with the team), and keeps that file out of git.
 */
export function enableAutoCompactLocally(projectDir) {
  const file = path.join(projectDir, LOCAL_SETTINGS);
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...settings, autoCompactEnabled: true }, null, 2) + '\n', 'utf-8');

  const gitignore = path.join(projectDir, '.gitignore');
  const entry = '.claude/settings.local.json';
  const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf-8') : '';
  if (!current.split('\n').some((line) => line.trim() === entry)) {
    fs.writeFileSync(gitignore, current + (current && !current.endsWith('\n') ? '\n' : '') + entry + '\n', 'utf-8');
  }
  return file;
}
