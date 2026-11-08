#!/usr/bin/env node
import { runCli } from '../src/index.js';
import { runUsage } from '../src/usage-report.js';

if (process.argv[2] === 'usage') {
  runUsage(process.argv.slice(3));
} else {
  runCli().catch((err) => {
    console.error('\nUnexpected error:', err);
    process.exit(1);
  });
}
