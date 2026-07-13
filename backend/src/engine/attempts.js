const MASK_WORDS = ['star', 'wolf', 'blue', 'fire', 'moon', 'iron', 'leaf', 'wave'];
const BRUTEFORCE_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%';
const BRUTEFORCE_LEN = 6;
const DEFAULT_ATTEMPTS_PER_SECOND = 8;

// Non-final stages get a fixed floor plus a share of the total time; whatever
// stage is last in plan.stages absorbs the remainder, so durations always sum
// to exactly targetCrackTimeMs regardless of how these constants are tuned.
const STAGE_MIN_MS = { dictionary: 1500, mask: 1500 };
const STAGE_TIME_SHARE = { dictionary: 0.15, mask: 0.2 };

function pick(list, randomFn) {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }
  const index = Math.min(list.length - 1, Math.floor(randomFn() * list.length));
  return list[index];
}

function computeStageDurations(plan) {
  const stages = Array.isArray(plan && plan.stages) ? plan.stages : [];
  const targetCrackTimeMs = plan ? plan.targetCrackTimeMs : 0;

  if (stages.length === 0) {
    return [];
  }
  if (stages.length === 1) {
    return [{ stage: stages[0], startMs: 0, endMs: targetCrackTimeMs }];
  }

  const finalStage = stages[stages.length - 1];
  const leadStages = stages.slice(0, -1);

  const leadDurations = leadStages.map((stage) => {
    const share = STAGE_TIME_SHARE[stage] || 0;
    const minMs = STAGE_MIN_MS[stage] || 0;
    return Math.max(minMs, Math.round(targetCrackTimeMs * share));
  });

  // Guard the case where lead-stage minimums alone would overrun the total
  // (only reachable with unusually small targetCrackTimeMs / tuned constants) —
  // scale lead stages down so the final stage always keeps a positive share.
  const allocated = leadDurations.reduce((sum, ms) => sum + ms, 0);
  if (allocated > targetCrackTimeMs) {
    const scale = (targetCrackTimeMs * 0.8) / allocated;
    for (let i = 0; i < leadDurations.length; i += 1) {
      leadDurations[i] = Math.max(1, Math.round(leadDurations[i] * scale));
    }
  }

  const boundaries = [];
  let cursor = 0;
  leadStages.forEach((stage, index) => {
    const duration = leadDurations[index];
    boundaries.push({ stage, startMs: cursor, endMs: cursor + duration });
    cursor += duration;
  });
  boundaries.push({ stage: finalStage, startMs: cursor, endMs: targetCrackTimeMs });
  return boundaries;
}

function generateDictionaryAttempt(attemptPool, randomFn) {
  return pick(attemptPool, randomFn) || 'scanning wordlist...';
}

function generateMaskAttempt(randomFn) {
  const word = pick(MASK_WORDS, randomFn);
  const digits = Math.floor(randomFn() * 100);
  return `${word}${digits}`;
}

function generateBruteforceAttempt(randomFn) {
  let text = '';
  for (let i = 0; i < BRUTEFORCE_LEN; i += 1) {
    const index = Math.floor(randomFn() * BRUTEFORCE_CHARSET.length);
    text += BRUTEFORCE_CHARSET[index];
  }
  return text;
}

const GENERATORS = {
  dictionary: (attemptPool, randomFn) => generateDictionaryAttempt(attemptPool, randomFn),
  mask: (_attemptPool, randomFn) => generateMaskAttempt(randomFn),
  bruteforce: (_attemptPool, randomFn) => generateBruteforceAttempt(randomFn),
};

function generateAttemptText(stage, attemptPool, randomFn) {
  const generator = GENERATORS[stage];
  if (!generator) {
    throw new RangeError(`Unknown stage: ${stage}`);
  }
  return generator(attemptPool, randomFn);
}

function buildAttemptTimeline(plan, options = {}) {
  const randomFn = options.randomFn || Math.random;
  const attemptsPerSecond = options.attemptsPerSecond || DEFAULT_ATTEMPTS_PER_SECOND;
  const intervalMs = 1000 / attemptsPerSecond;

  const timeline = [];
  computeStageDurations(plan).forEach(({ stage, startMs, endMs }) => {
    for (let elapsedMs = startMs; elapsedMs < endMs; elapsedMs += intervalMs) {
      timeline.push({
        stage,
        elapsedMs: Math.round(elapsedMs),
        text: generateAttemptText(stage, plan.attemptPool, randomFn),
      });
    }
  });
  return timeline;
}

module.exports = {
  computeStageDurations,
  generateAttemptText,
  buildAttemptTimeline,
  MASK_WORDS,
  BRUTEFORCE_CHARSET,
  BRUTEFORCE_LEN,
  DEFAULT_ATTEMPTS_PER_SECOND,
  STAGE_MIN_MS,
  STAGE_TIME_SHARE,
};
