import fs from 'node:fs';
import path from 'node:path';

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
