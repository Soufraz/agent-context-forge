import { exec } from 'node:child_process';
import os from 'node:os';

/**
 * Opens a file or URL in the system's default browser.
 * Safe for CI/headless environments (does not throw).
 *
 * @param {string} target File path or URL
 * @returns {Promise<boolean>} Whether the open command succeeded
 */
export function openInBrowser(target) {
  return new Promise((resolve) => {
    const platform = os.platform();
    let command = '';

    if (platform === 'darwin') {
      command = `open "${target}"`;
    } else if (platform === 'win32') {
      command = `start "" "${target}"`;
    } else {
      command = `xdg-open "${target}"`;
    }

    exec(command, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}
