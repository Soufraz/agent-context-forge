import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { inspectDirectory } from './detector.js';

export function isCommandAvailable(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks for missing environment tools (rtk, language servers)
 * and interactively offers to install them for the user.
 *
 * @param {string} targetDir Project root directory
 */
export async function offerToolInstallations(targetDir) {
  const dirInfo = inspectDirectory(targetDir);
  const isTsOrJs =
    dirInfo.projectTypes.includes('TypeScript') ||
    dirInfo.projectTypes.includes('JavaScript / Node.js');
  const isPython = dirInfo.projectTypes.includes('Python');

  const hasRtk = isCommandAvailable('rtk');
  const hasCargo = isCommandAvailable('cargo');
  const hasNpm = isCommandAvailable('npm');

  // 1. Offer to install RTK if missing
  if (!hasRtk) {
    if (hasCargo) {
      const installRtk = await p.confirm({
        message:
          'Rust Token Killer (rtk) is not installed. Would you like us to install it now via Cargo? (Runs: cargo install rtk-ai)',
        initialValue: true
      });

      if (!p.isCancel(installRtk) && installRtk) {
        const spinner = p.spinner();
        spinner.start('Compiling and installing rtk via `cargo install rtk-ai`...');
        try {
          execSync('cargo install rtk-ai', { stdio: 'ignore' });
          spinner.stop('✓ rtk installed successfully and ready on PATH!');
        } catch (err) {
          spinner.stop('⚠️ Could not automatically install rtk.');
          p.log.warn('You can install it manually whenever you want:\n  cargo install rtk-ai');
        }
      }
    } else {
      p.log.info(
        `${pc.yellow('Notice:')} rtk (Rust Token Killer) is not installed. Cargo was not found on PATH.\n` +
          `To enable smart test output compression later, install Rust and run: ${pc.cyan('cargo install rtk-ai')}`
      );
    }
  }

  // 2. Offer to install Language Server if missing
  if (isTsOrJs) {
    const hasVtsls = isCommandAvailable('vtsls');
    const hasTsLs = isCommandAvailable('typescript-language-server');

    if (!hasVtsls && !hasTsLs) {
      if (hasNpm) {
        const installLsp = await p.confirm({
          message:
            'TypeScript Language Server (@vtsls/language-server) is not installed. Install it globally via npm?',
          initialValue: true
        });

        if (!p.isCancel(installLsp) && installLsp) {
          const spinner = p.spinner();
          spinner.start('Installing `@vtsls/language-server` and `typescript` globally via npm...');
          try {
            execSync('npm install -g @vtsls/language-server typescript', { stdio: 'ignore' });
            spinner.stop('✓ @vtsls/language-server installed successfully!');
          } catch (err) {
            spinner.stop('⚠️ Could not automatically install @vtsls/language-server.');
            p.log.warn('You can install it manually:\n  npm install -g @vtsls/language-server typescript');
          }
        }
      } else {
        p.log.info(
          `${pc.yellow('Notice:')} Language server not detected. Install it via: ${pc.cyan('npm i -g @vtsls/language-server typescript')}`
        );
      }
    }
  } else if (isPython) {
    const hasPyright = isCommandAvailable('pyright');
    const hasPylsp = isCommandAvailable('pylsp');

    if (!hasPyright && !hasPylsp && hasNpm) {
      const installPyright = await p.confirm({
        message: 'Python language server (pyright) is not installed. Install globally via npm?',
        initialValue: true
      });

      if (!p.isCancel(installPyright) && installPyright) {
        const spinner = p.spinner();
        spinner.start('Installing pyright globally via npm...');
        try {
          execSync('npm install -g pyright', { stdio: 'ignore' });
          spinner.stop('✓ pyright installed successfully!');
        } catch {
          spinner.stop('⚠️ Could not automatically install pyright.');
        }
      }
    }
  }
}
