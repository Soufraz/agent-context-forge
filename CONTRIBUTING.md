# Contributing to Agent Context Forge

First off, thank you for considering contributing to **Agent Context Forge**! 🛠️

This project was built on the open-source ethos that developer tools should be transparent, lightweight, zero-telemetry, and community-driven. Whether you want to add support for a new AI coding engine (Gemini CLI, Antigravity, OpenCode, Cursor), write a new context auditor rule, or improve existing hook performance, your contributions are welcome!

---

## 🌟 Ways You Can Contribute

1. **Portability Adapters (Engines):** Help build adapters for other AI agent runtimes ([Issue #1](https://github.com/Soufraz/agent-context-forge/issues/1)):
   - Gemini CLI / Google Antigravity
   - OpenCode / Aider (`AGENTS.md`)
   - Cursor / Windsurf rules & hooks
   - OpenAI Codex CLI
2. **Scanner & Auditor Rules:** Add new checks to `src/scanner/` for detecting token bombs, dead file references, or leaky prompt caches.
3. **Pluggable Tools & MCPs:** Expand options for Pillar 2 (LSP servers) and Pillar 3 (custom output compressors beyond `rtk`).
4. **Documentation & Guides:** Share case studies, benchmark numbers, or workflow guides on pairing `agent-context-forge` with Layer 2 methodologies (Superpowers SDD, GSD, ECC).

---

## 🛠️ Local Development Setup

### 1. Prerequisites
- **Node.js**: `>= 18.0.0`
- **npm**: `>= 9.0.0`
- **Bash / POSIX shell**: For testing hooks
- **Python 3**: For testing the subagent isolation state machine (`guard-subagent-isolation.py`)

### 2. Clone & Install
```bash
git clone https://github.com/Soufraz/agent-context-forge.git
cd agent-context-forge
npm install
```

### 3. Run the Test Suite
We maintain a comprehensive self-test suite covering both Node.js unit tests and shell/hook integration tests:

```bash
npm test
```

This runs:
- `node --test tests/cli.test.js`: Validates directory detection, Tier-1 rule generation, scaffolding, and 5-Pillar HTML scoring.
- `./tests/run-tests.sh`: Executes end-to-end integration tests for all 5 Pillars (prefix-stability gate, RTK command rewriting, 15-search exploration note, episodic memory checks, and `.claude/settings.json` validation).

Make sure all 17+ tests pass before submitting your PR!

---

## 📐 Project Structure

```text
agent-context-forge/
├── bin/
│   └── cli.js                     # Global executable entrypoint (npx agent-context-forge)
├── src/
│   ├── index.js                   # CLI wizard, interactive prompts & routing
│   ├── detector.js                # Project type & empty directory inspection
│   ├── scaffolder.js              # Harness template generator & file injector
│   ├── context-generator.js       # Prefix-stable Tier-1 / Tier-2 markdown rules
│   ├── installer-helper.js        # Environment tool detection & installer helper
│   ├── scanner/                   # 5-Pillar context auditing engine
│   │   ├── pillar1-prefix.js      # Volatile state & broken path scanner
│   │   ├── pillar2-disclosure.js  # Lockfile token bombs & LSP detector
│   │   ├── pillar3-masking.js     # RTK & output compressor detector
│   │   ├── pillar4-isolation.js   # Subagent hook & orchestrator detector
│   │   └── pillar5-memory.js      # Auto-Memory & compaction hook detector
│   └── reporter/
│       ├── html-template.js       # Dark-mode HTML Context Health Dashboard
│       └── open-browser.js        # Cross-platform browser launcher
├── .claude/
│   └── hooks/                     # Reference implementation of zero-overhead hooks
├── scripts/
│   └── agent-gates/               # Portable pre-flight checks (doctor, LSP, memory, RTK)
├── tests/                         # Node.js and shell test suites
└── assets/                        # SVG diagrams, report mockups, and VHS demo script
```

---

## 🚀 Submitting a Pull Request (PR)

1. **Fork the repository** and create a feature branch off `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. **Make your changes** while keeping code clean, documented, and adhering to existing style.
3. **Add tests** for any new functionality or bug fixes.
4. **Ensure the test suite passes**:
   ```bash
   npm test
   ```
5. **Commit your changes** with clear, descriptive commit messages following Conventional Commits (e.g., `feat(scanner): add support for uv.lock scanning`, `fix(hooks): resolve regex issue in pre-commit filter`).
6. **Push to your fork** and open a PR against `main`.

---

## 📄 License & Intellectual Property

By contributing to Agent Context Forge, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
