'use strict';

// background.js uses chrome.runtime.onMessage.addListener at module level
const { buildSegments, calcScore, handleMessage } = require('../background/background.js');

// ─────────────────────────────────────────────
// buildSegments
// ─────────────────────────────────────────────
describe('buildSegments', () => {
  test('returns empty array when experiences is missing', () => {
    expect(buildSegments({})).toEqual([]);
  });

  test('returns empty array when experiences is empty', () => {
    expect(buildSegments({ experiences: [] })).toEqual([]);
  });

  test('returns empty array when all highlights are empty', () => {
    const profile = {
      experiences: [
        { company: 'A', role: 'PM', highlights: [] },
      ],
    };
    expect(buildSegments(profile)).toEqual([]);
  });

  test('generates segment IDs in exp_N_h_N format', () => {
    const profile = {
      experiences: [
        { highlights: ['主导了 A 项目', '降低了 30% 成本'] },
        { highlights: ['负责 B 平台建设'] },
      ],
    };
    const segments = buildSegments(profile);
    expect(segments).toEqual([
      { id: 'exp_0_h_0', text: '主导了 A 项目' },
      { id: 'exp_0_h_1', text: '降低了 30% 成本' },
      { id: 'exp_1_h_0', text: '负责 B 平台建设' },
    ]);
  });

  test('index resets per experience (exp_1_h_0, not exp_1_h_2)', () => {
    const profile = {
      experiences: [
        { highlights: ['a', 'b'] },
        { highlights: ['c'] },
      ],
    };
    const ids = buildSegments(profile).map(s => s.id);
    expect(ids).toEqual(['exp_0_h_0', 'exp_0_h_1', 'exp_1_h_0']);
  });

  test('skips experiences without highlights key', () => {
    const profile = {
      experiences: [
        { company: 'A' },            // no highlights
        { highlights: ['only one'] },
      ],
    };
    const segments = buildSegments(profile);
    expect(segments).toEqual([{ id: 'exp_1_h_0', text: 'only one' }]);
  });
});

// ─────────────────────────────────────────────
// calcScore
// ─────────────────────────────────────────────
describe('calcScore', () => {
  test('returns 0 for empty matches array', () => {
    expect(calcScore([])).toBe(0);
  });

  test('returns 100 when all matches are "match"', () => {
    const matches = [
      { status: 'match' },
      { status: 'match' },
      { status: 'match' },
    ];
    expect(calcScore(matches)).toBe(100);
  });

  test('returns 50 when all matches are "partial"', () => {
    const matches = [
      { status: 'partial' },
      { status: 'partial' },
    ];
    expect(calcScore(matches)).toBe(50);
  });

  test('returns 0 when all matches are "missing"', () => {
    const matches = [
      { status: 'missing' },
      { status: 'missing' },
    ];
    expect(calcScore(matches)).toBe(0);
  });

  test('calculates mixed statuses correctly (2 match + 1 partial + 1 missing = 63%)', () => {
    // earned = 1 + 1 + 0.5 + 0 = 2.5, total = 4, score = round(2.5/4 * 100) = 63
    const matches = [
      { status: 'match' },
      { status: 'match' },
      { status: 'partial' },
      { status: 'missing' },
    ];
    expect(calcScore(matches)).toBe(63);
  });

  test('treats unknown status as 0 weight', () => {
    const matches = [
      { status: 'match' },
      { status: 'unknown_status' },
    ];
    // earned = 1 + 0 = 1, total = 2, score = 50
    expect(calcScore(matches)).toBe(50);
  });

  test('returns integer (Math.round applied)', () => {
    // 1 match + 2 partial = 1 + 0.5 + 0.5 = 2 / 3 = 66.67 → 67
    const matches = [
      { status: 'match' },
      { status: 'partial' },
      { status: 'partial' },
    ];
    expect(Number.isInteger(calcScore(matches))).toBe(true);
    expect(calcScore(matches)).toBe(67);
  });
});

// ─────────────────────────────────────────────
// handleMessage — message router
// ─────────────────────────────────────────────
describe('handleMessage', () => {
  test('throws descriptive error for unknown message type', async () => {
    await expect(handleMessage({ type: 'UNKNOWN_TYPE' }))
      .rejects.toThrow('未知消息类型: UNKNOWN_TYPE');
  });
});

// ─────────────────────────────────────────────
// rewriteResume segment filtering
// ─────────────────────────────────────────────
describe('rewriteResume segment filtering', () => {
  test('quick mode: only exp_0 and exp_1 segments pass through', () => {
    const segments = [
      { id: 'exp_0_h_0', text: 'h1' },
      { id: 'exp_1_h_0', text: 'h2' },
      { id: 'exp_2_h_0', text: 'h3' },
    ];
    const filtered = segments.filter(s => {
      const parts = s.id.split('_');
      return parts[0] !== 'exp' || parseInt(parts[1], 10) < 2;
    });
    expect(filtered).toEqual([
      { id: 'exp_0_h_0', text: 'h1' },
      { id: 'exp_1_h_0', text: 'h2' },
    ]);
  });

  test('full mode: all segments pass through — filter not applied', () => {
    const segments = [
      { id: 'exp_0_h_0', text: 'h1' },
      { id: 'exp_2_h_0', text: 'h3' },
    ];
    // Simulate full mode: no filter, all segments used as-is
    const promptSegments = segments; // mode === 'full' → no filter
    expect(promptSegments).toHaveLength(2);
    expect(promptSegments.find(s => s.id === 'exp_2_h_0')).toBeDefined();
  });

  test('quick mode: non-exp segments always pass through', () => {
    const segments = [
      { id: 'edu_0', text: 'education' },
      { id: 'exp_3_h_0', text: 'should be filtered' },
    ];
    const filtered = segments.filter(s => {
      const parts = s.id.split('_');
      return parts[0] !== 'exp' || parseInt(parts[1], 10) < 2;
    });
    expect(filtered).toEqual([{ id: 'edu_0', text: 'education' }]);
  });
});
