import path from 'node:path';
import { auditPillar1 } from './pillar1-prefix.js';
import { auditPillar2 } from './pillar2-disclosure.js';
import { auditPillar3 } from './pillar3-masking.js';
import { auditPillar4 } from './pillar4-isolation.js';
import { auditPillar5 } from './pillar5-memory.js';

/**
 * Runs a comprehensive 5-Pillar Context Audit on a project directory.
 *
 * @param {string} projectDir Absolute or relative directory path
 * @returns {object} Full audit report with score, grade, and findings
 */
export function auditProject(projectDir = process.cwd()) {
  const resolvedDir = path.resolve(projectDir);

  const pillar1 = auditPillar1(resolvedDir);
  const pillar2 = auditPillar2(resolvedDir);
  const pillar3 = auditPillar3(resolvedDir);
  const pillar4 = auditPillar4(resolvedDir);
  const pillar5 = auditPillar5(resolvedDir);

  const totalScore =
    pillar1.score + pillar2.score + pillar3.score + pillar4.score + pillar5.score;
  const maxScore =
    pillar1.maxScore +
    pillar2.maxScore +
    pillar3.maxScore +
    pillar4.maxScore +
    pillar5.maxScore; // 30 + 20 + 15 + 20 + 15 = 100

  let grade = 'F';
  let gradeLabel = 'Severe Context Rot Risk';

  if (totalScore >= 90) {
    grade = 'A';
    gradeLabel = 'Optimal Context Health';
  } else if (totalScore >= 80) {
    grade = 'B';
    gradeLabel = 'Good Context Stability';
  } else if (totalScore >= 70) {
    grade = 'C';
    gradeLabel = 'Needs Attention';
  } else if (totalScore >= 60) {
    grade = 'D';
    gradeLabel = 'At Risk of Context Drift';
  }

  return {
    projectName: path.basename(resolvedDir),
    projectPath: resolvedDir,
    timestamp: new Date().toISOString(),
    totalScore,
    maxScore,
    grade,
    gradeLabel,
    // Measured from the repo, not estimated from the score
    measurements: {
      tier1: pillar1.stats,
      unprotectedLockfileTokens: pillar2.stats.unprotectedTokens
    },
    pillars: {
      pillar1: { name: 'Prefix Stability', ...pillar1 },
      pillar2: { name: 'Progressive Disclosure (LSP)', ...pillar2 },
      pillar3: { name: 'Observation Masking (RTK)', ...pillar3 },
      pillar4: { name: 'Context Isolation', ...pillar4 },
      pillar5: { name: 'Episodic Memory', ...pillar5 }
    }
  };
}
