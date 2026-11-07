#!/usr/bin/env node
import { runCli } from '../src/index.js';

runCli().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
