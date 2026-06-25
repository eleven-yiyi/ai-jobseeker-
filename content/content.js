'use strict';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const JD_KEYWORDS = ['职责', '要求', '技能', '经验', '岗位', '任职', '负责', '能力', '资质', '工作内容'];

const COMPANY_SUFFIXES = [
  '有限公司', '股份公司', '集团', '科技', '网络', '信息', '软件',
  '互联网', '传媒', '咨询', 'Ltd', 'Inc', 'Corp', 'Group',
];

const PLATFORM_NAV_KEYWORDS = ['BOSS直聘', '智联招聘', '猎聘', '拉勾', '首页', '登录', '注册', '发布职位'];

// ─────────────────────────────────────────────
// Page-level cache (re-use within same tab session)
// ─────────────────────────────────────────────
let _cached = null;
let _cachedUrl = null;

// ─────────────────────────────────────────────
// Message listener
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'GET_JOB_INFO') return;

  // Invalidate cache on URL change (SPA navigation)
  if (_cachedUrl !== location.href) {
    _cached = null;
    _cachedUrl = location.href;
  }

  if (!_cached) {
    _cached = extractJobInfo();
  }

  sendResponse(_cached);
});

// ─────────────────────────────────────────────
// Main extraction
// ─────────────────────────────────────────────
function extractJobInfo() {
  const title   = extractTitle();
  const company = extractCompany();
  const { text: jd, confidence } = extractJD();

  // Not a job detail page if we can't find a title or JD
  if (!title && confidence === 0) return null;

  return { title, company, jd, confidence };
}

// ─────────────────────────────────────────────
// Job title
// ─────────────────────────────────────────────
function extractTitle() {
  // 1. <h1> is the strongest signal on job detail pages
  const h1 = document.querySelector('h1');
  const h1Text = h1?.innerText?.trim();
  if (h1Text && h1Text.length < 60) return h1Text;

  // 2. Page <title> — format is usually "职位名 - 公司名 - 平台名"
  const titleParts = document.title.split(/\s*[-–|]\s*/);
  const candidate = titleParts[0]?.trim();
  if (candidate && candidate.length > 1 && candidate.length < 50) return candidate;

  return null;
}

// ─────────────────────────────────────────────
// Company name
// ─────────────────────────────────────────────
function extractCompany() {
  // 1. Scan elements near <h1> for company name patterns
  const h1 = document.querySelector('h1');
  if (h1) {
    const searchRoot = h1.closest('section, div, main') || h1.parentElement?.parentElement;
    if (searchRoot) {
      const nearby = [...searchRoot.querySelectorAll('a, span, p, h2, h3')];
      for (const el of nearby) {
        const text = el.innerText?.trim();
        if (
          text &&
          text.length >= 2 && text.length <= 40 &&
          text !== h1.innerText?.trim() &&
          COMPANY_SUFFIXES.some(s => text.includes(s)) &&
          !PLATFORM_NAV_KEYWORDS.some(k => text.includes(k))
        ) {
          return text;
        }
      }
    }
  }

  // 2. Broader scan for company name patterns across the page
  const all = [...document.querySelectorAll('a, span')];
  for (const el of all) {
    const text = el.innerText?.trim();
    if (
      text && text.length >= 4 && text.length <= 40 &&
      COMPANY_SUFFIXES.some(s => text.includes(s)) &&
      !PLATFORM_NAV_KEYWORDS.some(k => text.includes(k))
    ) {
      return text;
    }
  }

  // 3. Page title second segment
  const parts = document.title.split(/\s*[-–|]\s*/);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]?.trim();
    if (
      part && part.length >= 2 && part.length <= 40 &&
      !PLATFORM_NAV_KEYWORDS.some(k => part.includes(k))
    ) {
      return part;
    }
  }

  return null;
}

// ─────────────────────────────────────────────
// JD text extraction
// ─────────────────────────────────────────────
function extractJD() {

  const MAX_LEN = 10000;
  const MIN_LEN = 100;

  const scored = [...document.querySelectorAll('div, section, article')]
    .filter(el => {
      const text = el.innerText || '';
      return text.length >= MIN_LEN && text.length <= MAX_LEN;
    })
    .map(el => {
      const text    = el.innerText.trim();
      const kwScore = JD_KEYWORDS.filter(k => text.includes(k)).length;
      const blockChildren = el.querySelectorAll('div, section, article, ul > li').length;
      return { text, kwScore, blockChildren, len: text.length };
    })
    .filter(item => item.kwScore >= 2);

  if (!scored.length) return { text: null, confidence: 0 };

  // Prefer elements with fewer nested blocks; fall back to any high-scoring element
  const tight = scored.filter(c => c.blockChildren < 40);
  const pool  = tight.length ? tight : scored;
  pool.sort((a, b) => b.kwScore - a.kwScore || a.blockChildren - b.blockChildren || b.len - a.len);

  return { text: pool[0].text, confidence: pool[0].kwScore };
}

if (typeof module !== 'undefined') {
  module.exports = { extractJobInfo, extractTitle, extractCompany, extractJD, JD_KEYWORDS };
}
