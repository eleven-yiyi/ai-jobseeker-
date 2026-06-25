'use strict';

// popup.js calls document.addEventListener at module load — stub it before require
document.addEventListener = jest.fn();

const {
  makeCacheKey,
  todayStr,
  getUsageCount,
  tryIncrementUsage,
  DAILY_LIMIT,
} = require('../popup/popup.js');

// ─────────────────────────────────────────────
// makeCacheKey
// ─────────────────────────────────────────────
describe('makeCacheKey', () => {
  test('returns a string starting with "job_"', () => {
    expect(makeCacheKey('字节跳动', '产品经理')).toMatch(/^job_\d+$/);
  });

  test('returns the same key for identical inputs', () => {
    const a = makeCacheKey('腾讯科技', '前端工程师');
    const b = makeCacheKey('腾讯科技', '前端工程师');
    expect(a).toBe(b);
  });

  test('returns different keys for different company names', () => {
    const a = makeCacheKey('公司A', '产品经理');
    const b = makeCacheKey('公司B', '产品经理');
    expect(a).not.toBe(b);
  });

  test('returns different keys for different job titles', () => {
    const a = makeCacheKey('字节跳动', '产品经理');
    const b = makeCacheKey('字节跳动', '运营经理');
    expect(a).not.toBe(b);
  });

  test('handles empty strings without throwing', () => {
    expect(() => makeCacheKey('', '')).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// todayStr
// ─────────────────────────────────────────────
describe('todayStr', () => {
  test('returns a string in YYYY-MM-DD format', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns today\'s UTC date', () => {
    const expected = new Date().toISOString().slice(0, 10);
    expect(todayStr()).toBe(expected);
  });
});

// ─────────────────────────────────────────────
// getUsageCount
// ─────────────────────────────────────────────
describe('getUsageCount', () => {
  test('returns 0 when no usage has been stored', async () => {
    // storage is cleared in beforeEach (setup.js)
    expect(await getUsageCount()).toBe(0);
  });

  test('returns 0 when stored usage date does not match today', async () => {
    await chrome.storage.local.set({ usage: { date: '2020-01-01', count: 15 } });
    expect(await getUsageCount()).toBe(0);
  });

  test('returns stored count when usage date matches today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await chrome.storage.local.set({ usage: { date: today, count: 12 } });
    expect(await getUsageCount()).toBe(12);
  });

  test('returns 0 when count is 0 for today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await chrome.storage.local.set({ usage: { date: today, count: 0 } });
    expect(await getUsageCount()).toBe(0);
  });
});

// ─────────────────────────────────────────────
// tryIncrementUsage
// ─────────────────────────────────────────────
describe('tryIncrementUsage', () => {
  test('returns true and sets count to 1 when no prior usage', async () => {
    const result = await tryIncrementUsage();
    expect(result).toBe(true);

    const { usage } = await chrome.storage.local.get(['usage']);
    expect(usage.count).toBe(1);
    expect(usage.date).toBe(new Date().toISOString().slice(0, 10));
  });

  test('increments existing count and returns true when under limit', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await chrome.storage.local.set({ usage: { date: today, count: 5 } });

    const result = await tryIncrementUsage();
    expect(result).toBe(true);

    const { usage } = await chrome.storage.local.get(['usage']);
    expect(usage.count).toBe(6);
  });

  test('returns false and does NOT increment when daily limit is reached', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await chrome.storage.local.set({ usage: { date: today, count: DAILY_LIMIT } });

    const result = await tryIncrementUsage();
    expect(result).toBe(false);

    const { usage } = await chrome.storage.local.get(['usage']);
    expect(usage.count).toBe(DAILY_LIMIT); // unchanged
  });

  test('resets count to 1 when stored date is from a previous day', async () => {
    await chrome.storage.local.set({ usage: { date: '2020-01-01', count: 29 } });

    const result = await tryIncrementUsage();
    expect(result).toBe(true);

    const { usage } = await chrome.storage.local.get(['usage']);
    expect(usage.count).toBe(1);
    expect(usage.date).toBe(new Date().toISOString().slice(0, 10));
  });

  test('DAILY_LIMIT is 30', () => {
    expect(DAILY_LIMIT).toBe(30);
  });
});
