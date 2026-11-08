import { execSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { inspectDirectory } from './detector.js';
import {
  installedPluginsFor,
  isPluginEnabled,
  lspPluginsFor,
  pluginInstallCommand,
  tsserverAvailable
} from './lsp-plugins.js';
import { loadSettingsLayers } from './scanner/settings.js';

export function isCommandAvailable(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks for missing environment tools (rtk, language servers, code intelligence plugins)
 * and interactively offers to install them for the user.
 *
 * @param {string} targetDir Project root directory
 * @param {{lsp?: boolean}} [options] `lsp: false` skips the language server and plugin offers
 */
export async function offerToolInstallations(targetDir, { lsp = true } = {}) {
  const dirInfo = inspectDirectory(targetDir);

  const hasRtk = isCommandAvailable('rtk');
  const hasBrew = isCommandAvailable('brew');
  const hasNpm = isCommandAvailable('npm');

  // 1. Offer to install RTK if missing. Never via cargo: a different crate named "rtk"
  //    exists on crates.io.
  if (!hasRtk) {
    if (hasBrew) {
      const installRtk = await p.confirm({
        message:
          'Rust Token Killer (rtk) is not installed. Would you like us to install it now via Homebrew? (Runs: brew install rtk)',
        initialValue: true
      });

      if (!p.isCancel(installRtk) && installRtk) {
        const spinner = p.spinner();
        spinner.start('Installing rtk via `brew install rtk`...');
        try {
          execSync('brew install rtk', { stdio: 'ignore' });
          spinner.stop('✓ rtk installed successfully and ready on PATH!');
        } catch (err) {
          spinner.stop('⚠️ Could not automatically install rtk.');
          p.log.warn('You can install it manually whenever you want:\n  brew install rtk');
        }
      }
    } else {
      p.log.info(
        `${pc.yellow('Notice:')} rtk (Rust Token Killer) is not installed. Homebrew was not found on PATH.\n` +
          `To enable smart test output compression later, see ${pc.cyan('https://github.com/rtk-ai/rtk#installation')} (winget on Windows, or the install script).`
      );
    }
  }

  // 2. Offer to install each language server, then point to its code intelligence plugin:
  //    Claude Code keeps its LSP tool off until the plugin is installed.
  //    Skipped when the user left LSP off (the default).
  const layers = loadSettingsLayers(targetDir);
  const installed = installedPluginsFor(targetDir);
  for (const server of lsp ? lspPluginsFor(dirInfo.projectTypes) : []) {
    if (!isCommandAvailable(server.binary) || (server.needsTsserver && !tsserverAvailable(targetDir))) {
      if (server.install.startsWith('npm ') && hasNpm) {
        const installLsp = await p.confirm({
          message: `${server.language} language server (${server.binary}) is not installed. Install it globally? (Runs: ${server.install})`,
          initialValue: true
        });

        if (!p.isCancel(installLsp) && installLsp) {
          const spinner = p.spinner();
          spinner.start(`Installing ${server.binary} via \`${server.install}\`...`);
          try {
            execSync(server.install, { stdio: 'ignore' });
            spinner.stop(`✓ ${server.binary} installed successfully!`);
          } catch {
            spinner.stop(`⚠️ Could not automatically install ${server.binary}.`);
            p.log.warn(`You can install it manually:\n  ${server.install}`);
          }
        }
      } else {
        p.log.info(
          `${pc.yellow('Notice:')} ${server.language} language server not detected. Install it via: ${pc.cyan(server.install)}`
        );
      }
    }

    const pluginActive = installed
      ? installed.some((id) => id.startsWith(`${server.plugin}@`))
      : isPluginEnabled(layers, server.plugin);
    if (!pluginActive) {
      p.log.info(
        `${pc.yellow('Notice:')} Claude Code's LSP tool stays off until the ${server.plugin} code intelligence plugin is installed.\n` +
          `Install it with: ${pc.cyan(pluginInstallCommand(server))}`
      );
    }
  }
}
