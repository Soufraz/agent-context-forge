import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const IGNORED_FILES = new Set([
  '.git',
  '.gitignore',
  '.DS_Store',
  'Thumbs.db',
  'node_modules',
  '.npmignore'
]);

/**
 * Inspects a directory to determine if it is empty, an existing codebase,
 * or already has Agent Context Forge installed.
 *
 * @param {string} targetDir
 * @returns {{
 *   isEmpty: boolean,
 *   projectTypes: string[],
 *   isContextForgeInstalled: boolean,
 *   filesFound: string[]
 * }}
 */
export function inspectDirectory(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return {
      isEmpty: true,
      projectTypes: [],
      isContextForgeInstalled: false,
      filesFound: []
    };
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  const significantEntries = entries
    .map((e) => e.name)
    .filter((name) => !IGNORED_FILES.has(name));

  const isEmpty = significantEntries.length === 0;

  // Detect tech stack markers
  const projectTypes = [];
  const filesFound = [];

  const checkFile = (fileName, label) => {
    if (fs.existsSync(path.join(targetDir, fileName))) {
      projectTypes.push(label);
      filesFound.push(fileName);
    }
  };

  if (fs.existsSync(path.join(targetDir, 'tsconfig.json'))) {
    projectTypes.push('TypeScript');
    filesFound.push('tsconfig.json');
  } else if (fs.existsSync(path.join(targetDir, 'package.json'))) {
    projectTypes.push('JavaScript / Node.js');
    filesFound.push('package.json');
  }

  checkFile('pyproject.toml', 'Python');
  checkFile('requirements.txt', 'Python');
  checkFile('Cargo.toml', 'Rust');
  checkFile('go.mod', 'Go');
  checkFile('pom.xml', 'Java (Maven)');
  checkFile('build.gradle', 'Java / Kotlin (Gradle)');

  // Deduplicate detected project types
  const uniqueTypes = [...new Set(projectTypes)];

  // Detect if Agent Context Forge is already present
  const hasSettings = fs.existsSync(path.join(targetDir, '.claude', 'settings.json'));
  const hasDoctor = fs.existsSync(path.join(targetDir, 'scripts', 'agent-gates', 'doctor.sh'));
  const hasPrefixHook = fs.existsSync(
    path.join(targetDir, '.claude', 'hooks', 'pre-commit-prefix-stability.sh')
  );
  const isContextForgeInstalled = hasSettings && (hasDoctor || hasPrefixHook);

  return {
    isEmpty,
    projectTypes: uniqueTypes.length > 0 ? uniqueTypes : ['Generic Codebase'],
    isContextForgeInstalled,
    filesFound
  };
}

// Variables that point git somewhere else than the folder it runs in
const GIT_REDIRECT_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CEILING_DIRECTORIES', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'];

/** A copy of the environment that makes git answer about the folder itself, in English. */
function gitProbeEnv() {
  const env = { ...process.env, LC_ALL: 'C' };
  for (const name of GIT_REDIRECT_VARS) delete env[name];
  return env;
}

/**
 * Says whether a folder is a git repository.
 *
 * - 'repo': the folder is the root of a work tree
 * - 'nested': the folder sits inside another repository (a monorepo subproject)
 * - 'none': the folder is not inside any work tree
 * - 'no-git': git is missing or could not answer, so nothing is offered
 *
 * @param {string} dir
 * @returns {'repo' | 'nested' | 'none' | 'no-git'}
 */
export function gitRepoState(dir) {
  let result;
  try {
    result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 5000,
      env: gitProbeEnv()
    });
  } catch {
    return 'no-git';
  }
  if (result.error) return 'no-git';
  if (result.status !== 0) {
    return /not a git repository/i.test(result.stderr || '') ? 'none' : 'no-git';
  }
  try {
    const top = fs.realpathSync(result.stdout.trim());
    return top === fs.realpathSync(dir) ? 'repo' : 'nested';
  } catch {
    return 'no-git';
  }
}
