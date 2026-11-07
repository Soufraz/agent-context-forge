/**
 * Generates a self-contained, dark-theme HTML report from an audit result.
 *
 * @param {object} report Result from auditProject()
 * @returns {string} Standalone HTML document string
 */
export function generateHtmlReport(report) {
  const {
    projectName,
    projectPath,
    timestamp,
    totalScore,
    maxScore,
    grade,
    gradeLabel,
    cacheHitRate,
    tokenWasteRisk,
    pillars
  } = report;

  const getGradeColor = (g) => {
    switch (g) {
      case 'A':
        return '#10b981'; // emerald
      case 'B':
        return '#06b6d4'; // cyan
      case 'C':
        return '#f59e0b'; // amber
      case 'D':
        return '#f97316'; // orange
      default:
        return '#ef4444'; // red
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pass':
        return '<span class="badge badge-pass">✓ PASS</span>';
      case 'warn':
        return '<span class="badge badge-warn">⚠️ WARN</span>';
      default:
        return '<span class="badge badge-fail">❌ FAIL</span>';
    }
  };

  const gradeColor = getGradeColor(grade);
  const scorePercent = Math.round((totalScore / maxScore) * 100);

  const renderFindings = (findings) => {
    return findings
      .map((f) => {
        let detailsHtml = '';
        if (f.details && Array.isArray(f.details)) {
          detailsHtml = `
            <div class="finding-details">
              ${f.details
                .map((d) => {
                  if (typeof d === 'string') {
                    return `<code>${escapeHtml(d)}</code>`;
                  }
                  if (d.lineNum) {
                    return `<div><span class="line-tag">Line ${d.lineNum}</span> <strong>${escapeHtml(d.reason)}:</strong> <code>${escapeHtml(d.lineText)}</code></div>`;
                  }
                  if (d.file) {
                    return `<div><code>${escapeHtml(d.file)}</code> — ${d.sizeKb} KB (~${d.estTokens.toLocaleString()} tokens)</div>`;
                  }
                  return `<code>${escapeHtml(JSON.stringify(d))}</code>`;
                })
                .join('')}
            </div>
          `;
        }

        return `
          <div class="finding-card ${f.status}">
            <div class="finding-header">
              <span class="finding-title">${escapeHtml(f.title)}</span>
              ${getStatusBadge(f.status)}
            </div>
            <p class="finding-desc">${escapeHtml(f.description)}</p>
            ${detailsHtml}
          </div>
        `;
      })
      .join('');
  };

  const renderPillarCard = (key, p, index) => {
    const percent = Math.round((p.score / p.maxScore) * 100);
    const color = percent >= 80 ? '#10b981' : percent >= 60 ? '#f59e0b' : '#ef4444';

    return `
      <div class="pillar-section">
        <div class="pillar-header">
          <div class="pillar-title-group">
            <span class="pillar-number">Pillar ${index}</span>
            <h2 class="pillar-name">${escapeHtml(p.name)}</h2>
          </div>
          <div class="pillar-score-badge" style="border-color: ${color}; color: ${color};">
            ${p.score} / ${p.maxScore} pts (${percent}%)
          </div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${percent}%; background-color: ${color};"></div>
        </div>
        <div class="findings-container">
          ${renderFindings(p.findings)}
        </div>
      </div>
    `;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Context Health Audit — ${escapeHtml(projectName)}</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --border-focus: #374151;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --accent: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 32px 16px;
    }
    .container {
      max-width: 1040px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
    }
    .header-info h1 {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-meta {
      color: var(--text-muted);
      font-size: 13px;
      margin-top: 6px;
    }
    .engine-pill {
      display: inline-block;
      background: #1e1b4b;
      color: #a5b4fc;
      border: 1px solid #3730a3;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }

    /* Score Board */
    .scoreboard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .stat-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 800;
    }
    .stat-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* Mental Model & 2-Layer Architecture */
    .concepts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .concept-card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 18px 20px;
    }
    .concept-card h3 {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .concept-card p {
      font-size: 13px;
      color: #94a3b8;
      line-height: 1.5;
    }

    /* Pillars */
    .pillar-section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .pillar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .pillar-title-group {
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .pillar-number {
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: 0.5px;
    }
    .pillar-name {
      font-size: 18px;
      font-weight: 700;
    }
    .pillar-score-badge {
      font-size: 13px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 9999px;
      border: 1px solid;
    }
    .progress-bar-bg {
      width: 100%;
      height: 6px;
      background: #1f2937;
      border-radius: 9999px;
      overflow: hidden;
      margin-bottom: 20px;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.4s ease;
    }

    /* Findings */
    .findings-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .finding-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      background: #0f172a;
    }
    .finding-card.pass {
      border-left: 4px solid #10b981;
    }
    .finding-card.warn {
      border-left: 4px solid #f59e0b;
    }
    .finding-card.fail {
      border-left: 4px solid #ef4444;
    }
    .finding-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .finding-title {
      font-size: 14px;
      font-weight: 600;
    }
    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }
    .badge-pass { background: #064e3b; color: #6ee7b7; border: 1px solid #059669; }
    .badge-warn { background: #78350f; color: #fde68a; border: 1px solid #d97706; }
    .badge-fail { background: #7f1d1d; color: #fca5a5; border: 1px solid #dc2626; }
    .finding-desc {
      font-size: 13px;
      color: #94a3b8;
    }
    .finding-details {
      margin-top: 10px;
      padding: 10px;
      background: #090d16;
      border-radius: 6px;
      font-family: monospace;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      color: #cbd5e1;
    }
    .line-tag {
      background: #374151;
      padding: 2px 6px;
      border-radius: 4px;
      color: #e5e7eb;
      font-size: 11px;
    }
    code {
      background: #1e293b;
      padding: 2px 6px;
      border-radius: 4px;
      color: #38bdf8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    /* Remediation */
    .remediation-box {
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      border: 1px solid #3730a3;
      border-radius: 12px;
      padding: 24px;
      margin-top: 32px;
    }
    .remediation-box h2 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 12px;
      color: #e0e7ff;
    }
    .remediation-box p {
      font-size: 14px;
      color: #c7d2fe;
      margin-bottom: 14px;
    }
    .cmd-snippet {
      background: #090d16;
      border: 1px solid #312e81;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: monospace;
      color: #a5b4fc;
      font-size: 13px;
      overflow-x: auto;
    }

    footer {
      text-align: center;
      margin-top: 40px;
      color: var(--text-muted);
      font-size: 12px;
    }
    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-info">
        <h1>🛠️ Context Health Audit Dashboard</h1>
        <div class="header-meta">
          <strong>Project:</strong> ${escapeHtml(projectName)} &bull;
          <strong>Path:</strong> <code>${escapeHtml(projectPath)}</code> &bull;
          <strong>Scanned:</strong> ${new Date(timestamp).toLocaleString()}
        </div>
      </div>
      <div>
        <span class="engine-pill">Claude Code Engine</span>
      </div>
    </header>

    <div class="scoreboard">
      <div class="stat-card">
        <span class="stat-label">Context Health Score</span>
        <div class="stat-value" style="color: ${gradeColor};">
          ${totalScore} <span style="font-size: 18px; color: var(--text-muted); font-weight: 500;">/ ${maxScore}</span>
        </div>
        <span class="stat-sub">Grade <strong>${grade}</strong> &bull; ${escapeHtml(gradeLabel)}</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Est. Prompt Cache Hit Rate</span>
        <div class="stat-value" style="color: #38bdf8;">
          ${escapeHtml(cacheHitRate)}
        </div>
        <span class="stat-sub">Based on Tier-1 prefix stability</span>
      </div>

      <div class="stat-card">
        <span class="stat-label">Token Waste Risk</span>
        <div class="stat-value" style="color: ${tokenWasteRisk.includes('Critical') || tokenWasteRisk.includes('High') ? '#ef4444' : '#10b981'};">
          ${escapeHtml(tokenWasteRisk)}
        </div>
        <span class="stat-sub">Lockfile & test stdout exposure</span>
      </div>
    </div>

    <div class="concepts-grid">
      <div class="concept-card">
        <h3>🧠 The Mental Model: RAM vs. Disk</h3>
        <p>
          Treat the active LLM context window like <strong>fast, high-signal RAM</strong> (kept lean, static, and frozen).
          Use repository files, LSP compiler tools, and persistent Auto-Memory as <strong>deep Disk storage</strong> queried progressively on demand.
        </p>
      </div>
      <div class="concept-card">
        <h3>🧩 Layer 1 (Harness) vs. Layer 2 (Methodology)</h3>
        <p>
          <strong>Layer 1 (This Harness):</strong> Provides the rails, token filters, LSP bridges, and pre-commit cache gates.<br>
          <strong>Layer 2 (Your Methodology):</strong> Choose how you plan and decompose tasks (Superpowers SDD, GetShitDone, ECC, Elephant-Goldfish, or TDD).
        </p>
      </div>
    </div>

    ${renderPillarCard('pillar1', pillars.pillar1, 1)}
    ${renderPillarCard('pillar2', pillars.pillar2, 2)}
    ${renderPillarCard('pillar3', pillars.pillar3, 3)}
    ${renderPillarCard('pillar4', pillars.pillar4, 4)}
    ${renderPillarCard('pillar5', pillars.pillar5, 5)}

    <div class="remediation-box">
      <h2>🚀 Recommended Actions</h2>
      <p>To upgrade this project to a 100/100 Context Health score and maximize LLM reasoning fidelity:</p>
      <div class="cmd-snippet">
        # Inject or upgrade the full Agent Context Forge harness into this repository:<br>
        <strong>npx agent-context-forge</strong><br><br>
        # Install recommended developer environment tools (TypeScript shown; see the Pillar 2 findings for your language):<br>
        npm install -g typescript-language-server typescript<br>
        claude plugin install typescript-lsp@claude-plugins-official<br>
        brew install rtk
      </div>
    </div>

    <footer>
      Generated by <a href="https://github.com/Soufraz/agent-context-forge" target="_blank" rel="noopener">Agent Context Forge</a> &bull; An open harness for modern AI coding agents
    </footer>
  </div>
</body>
</html>
`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
