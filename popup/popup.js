'use strict';

// Firefox does not support chrome.identity (no Google OAuth in extensions)
const HAS_IDENTITY_API = !!(typeof chrome !== 'undefined' && chrome.identity);

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let currentJob     = null;   // { company, title, jd }
let currentCacheKey = null;
let parsedProfile  = null;   // temp storage during onboarding confirm

const resumeOptions = {
  sections: ['summary', 'work_experience', 'projects'],
  workExpMode: 'full',
  partialKeywords: [],
  missingKeywords: [],
};

// ─────────────────────────────────────────────
// Screen management
// ─────────────────────────────────────────────
const ALL_SCREENS = [
  'login',
  'onboarding', 'parsing', 'confirm',
  'home', 'no-job', 'analyzing', 'results', 'limit', 'settings',
  'resume-diff', 'resume-align', 'resume-loading', 'resume-view'
];

function showScreen(name) {
  ALL_SCREENS.forEach(s => {
    document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
  });
}

// ─────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────
async function load(...keys) {
  return chrome.storage.local.get(keys);
}

async function save(obj) {
  return chrome.storage.local.set(obj);
}

// ─────────────────────────────────────────────
// Sync storage helpers (for usage counter)
// ─────────────────────────────────────────────
function loadSync(key) {
  return new Promise(resolve => chrome.storage.sync.get(key, resolve));
}

function saveSync(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

// ─────────────────────────────────────────────
// Google auth
// Setup: create an OAuth2 client ID in Google Cloud Console
//   → APIs & Services → Credentials → Create → OAuth client ID → Chrome App
//   → enter your extension's ID → copy the client_id into manifest.json "oauth2"
// ─────────────────────────────────────────────
async function signIn() {
  if (!HAS_IDENTITY_API) throw new Error('当前浏览器不支持 Google 登录');

  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, tok => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(tok);
    });
  });

  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error('获取 Google 账号信息失败');

  const info = await resp.json();
  await save({ user: { sub: info.sub, email: info.email, name: info.name || info.email } });
  return info;
}

async function signOut() {
  if (HAS_IDENTITY_API) {
    try {
      const token = await new Promise(resolve => {
        chrome.identity.getAuthToken({ interactive: false }, tok => {
          resolve(chrome.runtime.lastError ? null : tok);
        });
      });
      if (token) {
        chrome.identity.removeCachedAuthToken({ token }, () => {});
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`).catch(() => {});
      }
    } catch {}
  }
  await chrome.storage.local.remove('user');
}

// ─────────────────────────────────────────────
// Daily usage
// ─────────────────────────────────────────────
const DAILY_LIMIT = 30;

async function getUsageCount() {
  const { user } = await load('user');
  if (!user) return 0;
  const key = `u_${user.sub}`;
  const today = todayStr();
  const data = await loadSync(key);
  const usage = data[key];
  return (usage?.date === today) ? usage.count : 0;
}

async function tryIncrementUsage() {
  const { user } = await load('user');
  if (!user) return false;
  const key = `u_${user.sub}`;
  const today = todayStr();
  const data = await loadSync(key);
  const usage = data[key];
  const count = (usage?.date === today) ? usage.count : 0;
  if (count >= DAILY_LIMIT) return false;
  await saveSync({ [key]: { date: today, count: count + 1 } });
  return true;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────
// Background messaging
// ─────────────────────────────────────────────
function ask(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (response?.error) return reject(new Error(response.error));
      resolve(response?.data);
    });
  });
}

// ─────────────────────────────────────────────
// Content script: get job info from current tab
// ─────────────────────────────────────────────
const SUPPORTED_DOMAINS = ['zhipin.com', 'zhaopin.com', 'liepin.com', 'lagou.com'];

async function getJobFromTab() {
  const tabs = await chrome.tabs.query({ active: true });
  const tab  = tabs.find(t => t.url && SUPPORTED_DOMAINS.some(d => t.url.includes(d)));
  if (!tab) return null;

  const tryMessage = () => new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_JOB_INFO' }, res => {
      resolve(chrome.runtime.lastError ? { noScript: true } : { data: res ?? null });
    });
  });

  let attempt = await tryMessage();
  if (!attempt.noScript) return attempt.data;

  // Content script not loaded yet — inject the file (just registers a listener, no DOM access)
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
  } catch {
    return null;
  }

  attempt = await tryMessage();
  return attempt.noScript ? null : attempt.data;
}

// ─────────────────────────────────────────────
// PDF text extraction (pdf.js, popup context)
// ─────────────────────────────────────────────
async function extractPdfText(uint8Array) {
  const lib = window.pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

  const pdf = await lib.getDocument({ data: uint8Array }).promise;
  const parts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map(item => item.str).join(' '));
  }

  return parts.join('\n');
}

// ─────────────────────────────────────────────
// Cache key
// ─────────────────────────────────────────────
function makeCacheKey(company, title) {
  const s = `${company}::${title}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = Math.imul(31, h) + s.charCodeAt(i) | 0; }
  return `job_${Math.abs(h)}`;
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  bindStaticListeners();

  const { user } = await load('user');
  if (!user) {
    if (!HAS_IDENTITY_API) {
      // Firefox: skip Google login, go directly to onboarding / main
      const { setup_done } = await load('setup_done');
      if (!setup_done) { showScreen('onboarding'); } else { await initMainFlow(); }
      return;
    }
    showScreen('login');
    return;
  }

  const { setup_done } = await load('setup_done');
  if (!setup_done) {
    showScreen('onboarding');
  } else {
    await initMainFlow();
  }
});

// ─────────────────────────────────────────────
// Bind all static listeners once
// ─────────────────────────────────────────────
function bindStaticListeners() {

  // ── Login ──
  document.getElementById('btn-google-login').addEventListener('click', async () => {
    const btn   = document.getElementById('btn-google-login');
    const errEl = document.getElementById('login-error');
    btn.disabled  = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 登录中…';
    errEl.classList.add('hidden');

    try {
      await signIn();
      const { setup_done } = await load('setup_done');
      if (!setup_done) {
        showScreen('onboarding');
      } else {
        await initMainFlow();
      }
    } catch (err) {
      console.error(err);
      errEl.textContent = '登录失败，请重试';
      errEl.classList.remove('hidden');
      btn.disabled  = false;
      btn.innerHTML = '<i class="fa-brands fa-google"></i> 使用 Google 账号登录';
    }
  });

  // ── Logout ──
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await signOut();
    const btn   = document.getElementById('btn-google-login');
    btn.disabled  = false;
    btn.innerHTML = '<i class="fa-brands fa-google"></i> 使用 Google 账号登录';
    document.getElementById('login-error').classList.add('hidden');
    showScreen('login');
  });

  // ── Onboarding ──
  document.getElementById('input-resume').addEventListener('change', (e) => {
    if (e.target.files[0]) handleResumeUpload(e.target.files[0]);
  });

  const uploadZone = document.getElementById('upload-zone');
  uploadZone.addEventListener('dragover',  (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', ()  => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') handleResumeUpload(file);
  });

  // ── Confirm ──
  document.getElementById('btn-confirm-done').addEventListener('click', async () => {
    if (!parsedProfile) return;
    await save({ profile: parsedProfile, setup_done: true });
    sendUserEvent('onboarding_completed', {});
    await initMainFlow();
  });

  document.getElementById('btn-reupload').addEventListener('click', () => {
    parsedProfile = null;
    document.getElementById('input-resume').value = '';
    showScreen('onboarding');
  });

  // ── Home ──
  document.getElementById('btn-analyze').addEventListener('click', async () => {
    const allowed = await tryIncrementUsage();
    if (!allowed) { showScreen('limit'); return; }
    await runAnalysis();
  });

  // ── Results: back ──
  document.getElementById('btn-back').addEventListener('click', async () => {
    document.getElementById('greetings-panel').classList.add('hidden');
    document.getElementById('greetings-loading').classList.add('hidden');
    document.getElementById('home-company').textContent = currentJob?.company || '—';
    document.getElementById('home-title').textContent   = currentJob?.title   || '—';
    await updateUsageDisplay();
    showScreen('home');
  });

  // ── Results: greeting ──
  document.getElementById('btn-greeting').addEventListener('click', handleGenerateGreeting);

  // ── Results: resume ──
  document.getElementById('btn-resume').addEventListener('click', async () => {
    if (!currentCacheKey) return;
    await initResumeDiff();
  });

  // ── Resume: diff back ──
  document.getElementById('btn-resume-diff-back').addEventListener('click', () => showScreen('results'));

  // ── Resume: loading back ──
  document.getElementById('btn-resume-loading-back').addEventListener('click', () => showScreen('resume-align'));

  // ── Resume: align back ──
  document.getElementById('btn-resume-align-back').addEventListener('click', () => showScreen('resume-diff'));

  // ── Resume: align next → generate ──
  document.getElementById('btn-resume-align-next').addEventListener('click', startResumeGeneration);

  // ── Resume: view back ──
  document.getElementById('btn-resume-view-back').addEventListener('click', () => {
    if (resumeEditMode) setResumeEditMode(false);
    showScreen('resume-diff');
  });

  // ── Resume: generate ──
  document.getElementById('btn-resume-generate').addEventListener('click', initResumeAlign);

  // ── Resume: download ──
  document.getElementById('btn-resume-download').addEventListener('click', downloadResumePdf);

  // ── Resume: edit toggle ──
  document.getElementById('btn-resume-edit').addEventListener('click', () => {
    setResumeEditMode(!resumeEditMode);
  });

  // ── Results: copy buttons ──
  document.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx  = btn.dataset.index;
      const text = document.getElementById(`greeting-text-${idx}`)?.textContent;
      if (!text || text === '—') return;
      await navigator.clipboard.writeText(text);
      sendUserEvent('greeting_copied', { greeting_index: Number(idx), content: text });
      const original = btn.textContent;
      btn.textContent = '已复制 ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 2000);
    });
  });

  // ── Results: feedback ──
  document.getElementById('btn-applied').addEventListener('click', () =>
    handleFeedback('applied')
  );
  document.getElementById('btn-not-applied').addEventListener('click', () =>
    handleFeedback('not_applied')
  );

  // ── Settings screen ──
  document.getElementById('btn-settings-back').addEventListener('click', async () => {
    await initMainFlow();
  });
  document.getElementById('btn-reupload-settings').addEventListener('click', () => {
    document.getElementById('input-resume').value = '';
    parsedProfile = null;
    showScreen('onboarding');
  });

  // ── Refresh detection on no-job screen ──
  document.getElementById('btn-refresh-no-job').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-no-job');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> 检测中…';
    await initMainFlow(true);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 重新检测';
  });

  // ── Refresh detection on home screen ──
  document.getElementById('btn-refresh-home').addEventListener('click', async () => {
    const btn = document.getElementById('btn-refresh-home');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> 检测中…';
    await initMainFlow(true);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 换了职位？重新检测';
  });

  // ── Confirm: edit basic info ──
  document.querySelector('.btn-edit[data-target="basic"]').addEventListener('click', function () {
    toggleBasicEdit(this);
  });

  // ── Confirm: edit experience ──
  document.querySelector('.btn-edit[data-target="exp"]').addEventListener('click', function () {
    toggleExpEdit(this);
  });

  // ── "我的档案" from home / no-job ──
  document.getElementById('btn-goto-profile').addEventListener('click', () =>
    openSettings()
  );
  document.getElementById('btn-goto-profile2').addEventListener('click', () =>
    openSettings()
  );
  document.getElementById('btn-home-resume-entry')?.addEventListener('click', () =>
    openSettings()
  );

  initGreetingFeedback();
  initResumeFeedback();
}

// ─────────────────────────────────────────────
// Main flow: detect job, route to screen
// ─────────────────────────────────────────────
async function initMainFlow(showDetectFeedback = false) {
  currentJob     = await getJobFromTab();
  currentCacheKey = currentJob ? makeCacheKey(currentJob.company, currentJob.title) : null;

  if (!currentJob) {
    showScreen('no-job');
    if (showDetectFeedback) showError('未检测到职位信息，请确认已打开职位详情页');
    return;
  }

  // Show cached result immediately if available
  const { cache = {} } = await load('cache');
  if (cache[currentCacheKey]) {
    renderResults(cache[currentCacheKey]);
    await restoreFeedbackState();
    showScreen('results');
    return;
  }

  document.getElementById('home-company').textContent = currentJob.company || '—';
  document.getElementById('home-title').textContent   = currentJob.title   || '—';
  await updateUsageDisplay();
  showScreen('home');
}

async function updateUsageDisplay() {
  const { profile, cache = {} } = await load('profile', 'cache');

  const resumeEl = document.getElementById('home-resume-status');
  if (resumeEl) {
    const b = profile?.basic || {};
    const parts = [
      profile ? '已上传' : '未上传',
      b.target_role,
      b.years ? `${b.years} 年经验` : null,
    ].filter(Boolean);
    resumeEl.textContent = parts.join(' · ');
  }

  renderRecentJobs(cache);
}

function renderRecentJobs(cache = {}) {
  const list = document.getElementById('home-recent-list');
  if (!list) return;

  const entries = Object.values(cache)
    .filter(item => item && (item.company || item.title))
    .sort((a, b) => (b.analyzed_at || 0) - (a.analyzed_at || 0))
    .slice(0, 3);

  list.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'recent-empty';
    empty.textContent = '分析职位后会显示最近记录';
    list.appendChild(empty);
    return;
  }

  entries.forEach(item => {
    const row = document.createElement('div');
    row.className = 'recent-item';

    const main = document.createElement('div');
    main.className = 'recent-main';

    const title = document.createElement('span');
    title.className = 'recent-title';
    title.textContent = item.title || '—';

    const company = document.createElement('span');
    company.className = 'recent-company';
    company.textContent = item.company || '—';

    const score = document.createElement('span');
    score.className = 'recent-score';
    score.textContent = item.score != null ? `${item.score}%` : '—';

    main.append(title, company);
    row.append(main, score);
    list.appendChild(row);
  });
}

// ─────────────────────────────────────────────
// Onboarding: upload → parse → confirm
// ─────────────────────────────────────────────
async function handleResumeUpload(file) {
  showScreen('parsing');

  try {
    const buf      = await file.arrayBuffer();
    const rawText  = await extractPdfText(new Uint8Array(buf));
    const profile  = await ask('PARSE_RESUME', { rawText });

    parsedProfile = profile;
    renderConfirmScreen(profile);
    showScreen('confirm');
  } catch (err) {
    showScreen('onboarding');
    showError('简历解析失败，请重试');
    console.error(err);
  }
}

function renderConfirmScreen(profile) {
  const b = profile.basic || {};
  document.getElementById('cf-name').textContent    = b.name        || '—';
  document.getElementById('cf-role').textContent    = b.target_role || '—';
  document.getElementById('cf-years').textContent   = b.years ? `${b.years} 年` : '—';
  document.getElementById('cf-salary').textContent  = b.salary      || '—';
  document.getElementById('cf-contact').textContent = b.contact     || '—';

  // Work experiences — all entries, with highlights
  const expContainer = document.getElementById('confirm-exp');
  expContainer.innerHTML = '';
  (profile.experiences || []).forEach(exp => {
    const div = document.createElement('div');
    div.className = 'exp-item';

    const header = document.createElement('div');
    header.innerHTML = `
      <span class="exp-company">${exp.company || '—'}</span>
      <span class="exp-role-period">${[exp.role, exp.period].filter(Boolean).join(' · ')}</span>
    `;
    div.appendChild(header);

    if (exp.highlights?.length) {
      const ul = document.createElement('ul');
      ul.className = 'exp-highlights';
      exp.highlights.forEach(h => {
        const li = document.createElement('li');
        li.textContent = h;
        ul.appendChild(li);
      });
      div.appendChild(ul);
    }

    expContainer.appendChild(div);
  });

  // Education
  const eduContainer = document.getElementById('confirm-edu');
  const eduBlock = document.getElementById('confirm-edu-block');
  const edus = profile.education || [];
  eduBlock.style.display = edus.length ? '' : 'none';
  eduContainer.innerHTML = '';
  edus.forEach(edu => {
    const div = document.createElement('div');
    div.className = 'edu-item';
    div.innerHTML = `
      <span class="edu-school">${edu.school || '—'}</span>
      <span class="edu-detail">${[edu.degree, edu.major].filter(Boolean).join(' · ')}</span>
      <span class="edu-period">${edu.period || ''}</span>
    `;
    eduContainer.appendChild(div);
  });
}

// ─────────────────────────────────────────────
// Confirm screen: inline editing
// ─────────────────────────────────────────────
function toggleBasicEdit(btn) {
  const saving = btn.textContent.trim() === '保存';
  const fieldDefs = [
    { id: 'cf-name',    key: 'name',        parse: v => v },
    { id: 'cf-role',    key: 'target_role', parse: v => v },
    { id: 'cf-years',   key: 'years',       parse: v => parseInt(v) || v },
    { id: 'cf-salary',  key: 'salary',      parse: v => v },
    { id: 'cf-contact', key: 'contact',     parse: v => v },
  ];

  if (!saving) {
    fieldDefs.forEach(({ id }) => {
      const el = document.getElementById(id);
      el.contentEditable = 'true';
      el.classList.add('editable-field');
    });
    document.getElementById('cf-role').focus();
    btn.textContent = '保存';
  } else {
    parsedProfile.basic = parsedProfile.basic || {};
    fieldDefs.forEach(({ id, key, parse }) => {
      const el = document.getElementById(id);
      parsedProfile.basic[key] = parse(el.textContent.trim());
      el.contentEditable = 'false';
      el.classList.remove('editable-field');
    });
    btn.textContent = '编辑';
  }
}

function toggleExpEdit(btn) {
  const saving = btn.textContent.trim() === '保存';
  const items = document.querySelectorAll('#confirm-exp .exp-item');

  if (!saving) {
    items.forEach(item => {
      item.querySelectorAll('span').forEach(span => {
        span.contentEditable = 'true';
        span.classList.add('editable-field');
      });
    });
    btn.textContent = '保存';
  } else {
    parsedProfile.experiences = parsedProfile.experiences || [];
    items.forEach((item, i) => {
      const spans = item.querySelectorAll('span');
      spans.forEach(span => {
        span.contentEditable = 'false';
        span.classList.remove('editable-field');
      });
      if (!parsedProfile.experiences[i]) parsedProfile.experiences[i] = {};
      if (spans[0]) parsedProfile.experiences[i].company = spans[0].textContent.trim();
      if (spans[1]) {
        const parts = spans[1].textContent.trim().split(' · ');
        parsedProfile.experiences[i].role   = parts[0] || '';
        parsedProfile.experiences[i].period = parts[1] || '';
      }
    });
    btn.textContent = '编辑';
  }
}

// ─────────────────────────────────────────────
// Analysis
// ─────────────────────────────────────────────
async function runAnalysis() {
  showScreen('analyzing');

  try {
    const { profile } = await load('profile');
    const result = await ask('ANALYZE_JD', {
      jd:      currentJob.jd,
      profile,
      company: currentJob.company,
      title:   currentJob.title,
    });

    const entry = {
      ...result,
      company:     currentJob.company,
      title:       currentJob.title,
      analyzed_at: Date.now(),
    };

    const { cache = {} } = await load('cache');
    cache[currentCacheKey] = entry;
    await save({ cache });

    renderResults(entry);
    await restoreFeedbackState();
    showScreen('results');
    const matched = (entry.matches || []).filter(m => m.status === 'match').length;
    const missing = (entry.matches || []).filter(m => m.status === 'missing').length;
    sendUserEvent('jd_analyzed', { score: entry.score, matched_count: matched, missing_count: missing });
  } catch (err) {
    showScreen('home');
    showError('分析失败，请检查网络后重试');
    console.error(err);
  }
}

// ─────────────────────────────────────────────
// Render results
// ─────────────────────────────────────────────
const STATUS_ICON = {
  match:   '<i class="fa-solid fa-circle-check"></i>',
  partial: '<i class="fa-solid fa-bolt"></i>',
  missing: '<i class="fa-solid fa-circle-xmark"></i>',
};

function renderResults(data) {
  document.getElementById('result-company').textContent = data.company || '—';
  document.getElementById('result-title').textContent   = data.title   || '—';
  document.getElementById('result-score').textContent   = data.score != null ? `${data.score}%` : '—';

  const score = Number(data.score);
  const fill = document.getElementById('result-score-fill');
  const note = document.getElementById('result-score-note');
  if (fill) fill.style.width = Number.isFinite(score) ? `${Math.max(0, Math.min(100, score))}%` : '0%';
  if (note) note.textContent = getScoreNote(score);

  const timeEl = document.getElementById('result-time');
  if (data.analyzed_at) {
    const mins = Math.floor((Date.now() - data.analyzed_at) / 60000);
    timeEl.textContent = mins < 1 ? '刚刚分析' : `${mins} 分钟前分析`;
  }

  renderSkillGroups(data.matches || []);
  renderResultInsight(data.matches || [], score);
}

function getScoreNote(score) {
  if (!Number.isFinite(score)) return '等待分析';
  if (score < 50) return '匹配度偏低';
  if (score < 75) return '有提升空间';
  return '匹配度较高';
}

function renderResultInsight(matches, score) {
  const el = document.getElementById('result-insight');
  if (!el) return;

  const missing = matches.filter(m => m.status === 'missing');
  const partial = matches.filter(m => m.status === 'partial');
  const focus = missing[0]?.skill || partial[0]?.skill;

  if (Number.isFinite(score) && score < 50 && focus) {
    el.textContent = `有明显岗位差距，建议优先补齐「${focus}」相关经历。`;
  } else if (partial.length && focus) {
    el.textContent = `基础匹配可用，建议强化「${focus}」来提升简历说服力。`;
  } else {
    el.textContent = '整体匹配度较好，可直接生成打招呼语或定制简历。';
  }
}

function renderSkillGroups(matches) {
  const list = document.getElementById('skills-list');
  list.innerHTML = '';

  const groups = [
    { key: 'missing', label: '待补齐', items: matches.filter(m => m.status === 'missing') },
    { key: 'partial', label: '可强化', items: matches.filter(m => m.status === 'partial') },
    { key: 'match', label: '已匹配', items: matches.filter(m => m.status === 'match') },
  ];

  groups.forEach(group => {
    if (!group.items.length) return;
    const block = document.createElement('div');
    block.className = `skill-group skill-group-${group.key}`;

    const title = document.createElement('div');
    title.className = 'skill-group-title';
    title.textContent = group.label;

    const tags = document.createElement('div');
    tags.className = 'skill-group-tags';

    group.items.forEach(m => {
      const pill = document.createElement('span');
      pill.className = `skill-pill ${m.status}`;
      pill.title = m.evidence || '';
      pill.innerHTML = STATUS_ICON[m.status] || '';

      const text = document.createElement('span');
      text.textContent = m.skill;
      pill.appendChild(text);
      tags.appendChild(pill);
    });

    block.append(title, tags);
    list.appendChild(block);
  });
}

// ─────────────────────────────────────────────
// Greetings
// ─────────────────────────────────────────────
async function handleGenerateGreeting() {
  const panel   = document.getElementById('greetings-panel');
  const loading = document.getElementById('greetings-loading');

  // Toggle off
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    return;
  }

  // Serve from cache
  const { cache = {} } = await load('cache');
  if (cache[currentCacheKey]?.greetings?.length) {
    renderGreetings(cache[currentCacheKey].greetings);
    return;
  }

  loading.classList.remove('hidden');

  try {
    const { profile } = await load('profile');
    const greetings = await ask('GENERATE_GREETING', {
      matches: cache[currentCacheKey]?.matches || [],
      company: currentJob.company,
      title:   currentJob.title,
      profile,
    });

    cache[currentCacheKey].greetings = greetings;
    await save({ cache });

    loading.classList.add('hidden');
    renderGreetings(greetings);
  } catch (err) {
    loading.classList.add('hidden');
    showError('生成失败，请重试');
    console.error(err);
  }
}

function renderGreetings(greetings) {
  greetings.forEach((g, i) => {
    const el = document.getElementById(`greeting-text-${i}`);
    if (el) el.textContent = g.text ?? g;
  });
  resetGreetingFeedbackState();
  document.getElementById('greetings-panel').classList.remove('hidden');
}

// ─────────────────────────────────────────────
// AI 反馈（点赞 / 点踩）
// ─────────────────────────────────────────────
async function sendAiFeedback(payload) {
  try {
    const { user }  = await load('user');
    const { cache } = await load('cache');
    const job = cache?.[currentCacheKey] || {};
    await ask('RECORD_FEEDBACK', {
      user_id:        user?.sub        || null,
      user_email:     user?.email      || null,
      company:        job.company      || null,
      title:          job.title        || null,
      ...payload,
    });
  } catch (err) {
    console.error('反馈记录失败', err);
  }
}

async function sendUserEvent(event_type, properties = {}) {
  try {
    const { user }  = await load('user');
    const { cache } = await load('cache');
    const job = cache?.[currentCacheKey] || {};
    await ask('RECORD_EVENT', {
      user_email: user?.email || null,
      event_type,
      company:    job.company || null,
      title:      job.title   || null,
      properties,
    });
  } catch (err) {
    console.error('事件记录失败', err);
  }
}

function showAiFeedbackThanks(anchorEl) {
  const thanks = document.createElement('span');
  thanks.className   = 'ai-feedback-thanks';
  thanks.textContent = '感谢反馈';
  anchorEl.appendChild(thanks);
  setTimeout(() => thanks.remove(), 1500);
}

function initGreetingFeedback() {
  [0, 1].forEach(i => {
    const likeBtn    = document.querySelector(`.btn-ai-like[data-index="${i}"]`);
    const dislikeBtn = document.querySelector(`.btn-ai-dislike[data-index="${i}"]`);
    const reasonsEl  = document.querySelector(`.dislike-reasons[data-index="${i}"]`);
    const confirmBtn = document.querySelector(`.btn-dislike-confirm[data-index="${i}"]`);
    if (!likeBtn || !dislikeBtn) return;

    likeBtn.addEventListener('click', async () => {
      const wasActive    = likeBtn.classList.contains('active');
      const wasCommitted = likeBtn.dataset.committed === 'true';
      const content      = document.getElementById(`greeting-text-${i}`)?.textContent || null;

      if (wasActive) {
        likeBtn.classList.remove('active');
        likeBtn.dataset.committed = 'false';
        if (wasCommitted) {
          await sendAiFeedback({ feature_type: 'greeting', greeting_index: i, feedback_type: 'like', cancelled: true, dislike_reasons: null, content });
        }
      } else {
        // Cancel committed dislike if switching
        if (dislikeBtn.classList.contains('active') && dislikeBtn.dataset.committed === 'true') {
          dislikeBtn.dataset.committed = 'false';
          await sendAiFeedback({ feature_type: 'greeting', greeting_index: i, feedback_type: 'dislike', cancelled: true, dislike_reasons: null, content });
        }
        dislikeBtn.classList.remove('active');
        reasonsEl?.classList.add('hidden');
        likeBtn.classList.add('active');
        likeBtn.dataset.committed = 'true';
        await sendAiFeedback({ feature_type: 'greeting', greeting_index: i, feedback_type: 'like', cancelled: false, dislike_reasons: null, content });
      }
    });

    dislikeBtn.addEventListener('click', async () => {
      const wasActive    = dislikeBtn.classList.contains('active');
      const wasCommitted = dislikeBtn.dataset.committed === 'true';
      const content      = document.getElementById(`greeting-text-${i}`)?.textContent || null;

      if (wasActive) {
        dislikeBtn.classList.remove('active');
        dislikeBtn.dataset.committed = 'false';
        reasonsEl?.classList.add('hidden');
        reasonsEl?.querySelectorAll('.dislike-reason-tag').forEach(t => t.classList.remove('selected'));
        confirmBtn?.classList.add('hidden');
        if (wasCommitted) {
          await sendAiFeedback({ feature_type: 'greeting', greeting_index: i, feedback_type: 'dislike', cancelled: true, dislike_reasons: null, content });
        }
      } else {
        // Cancel committed like if switching
        if (likeBtn.classList.contains('active') && likeBtn.dataset.committed === 'true') {
          likeBtn.dataset.committed = 'false';
          await sendAiFeedback({ feature_type: 'greeting', greeting_index: i, feedback_type: 'like', cancelled: true, dislike_reasons: null, content });
        }
        likeBtn.classList.remove('active');
        dislikeBtn.classList.add('active');
        reasonsEl?.classList.remove('hidden');
      }
    });

    reasonsEl?.querySelectorAll('.dislike-reason-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        tag.classList.toggle('selected');
        const hasSelected = reasonsEl.querySelectorAll('.dislike-reason-tag.selected').length > 0;
        confirmBtn?.classList.toggle('hidden', !hasSelected);
      });
    });

    confirmBtn?.addEventListener('click', async () => {
      const selected = [...reasonsEl.querySelectorAll('.dislike-reason-tag.selected')]
        .map(el => el.dataset.reason);
      if (!selected.length) return;
      const content = document.getElementById(`greeting-text-${i}`)?.textContent || null;
      dislikeBtn.dataset.committed = 'true';
      await sendAiFeedback({ feature_type: 'greeting', greeting_index: i, feedback_type: 'dislike', cancelled: false, dislike_reasons: selected, content });
      reasonsEl.classList.add('hidden');
      reasonsEl.querySelectorAll('.dislike-reason-tag').forEach(t => t.classList.remove('selected'));
      confirmBtn.classList.add('hidden');
      const row = document.querySelector(`.ai-feedback-row[data-index="${i}"]`);
      showAiFeedbackThanks(row);
    });
  });
}

function resetGreetingFeedbackState() {
  [0, 1].forEach(i => {
    const like    = document.querySelector(`.btn-ai-like[data-index="${i}"]`);
    const dislike = document.querySelector(`.btn-ai-dislike[data-index="${i}"]`);
    if (like)    { like.classList.remove('active');    like.dataset.committed    = 'false'; }
    if (dislike) { dislike.classList.remove('active'); dislike.dataset.committed = 'false'; }
    const reasonsEl = document.querySelector(`.dislike-reasons[data-index="${i}"]`);
    reasonsEl?.classList.add('hidden');
    reasonsEl?.querySelectorAll('.dislike-reason-tag').forEach(t => t.classList.remove('selected'));
    document.querySelector(`.btn-dislike-confirm[data-index="${i}"]`)?.classList.add('hidden');
  });
}

function initResumeFeedback() {
  const likeBtn    = document.getElementById('btn-resume-like');
  const dislikeBtn = document.getElementById('btn-resume-dislike');
  const reasonsEl  = document.getElementById('resume-dislike-reasons');
  const confirmBtn = document.getElementById('btn-resume-dislike-confirm');
  if (!likeBtn || !dislikeBtn) return;

  likeBtn.addEventListener('click', async () => {
    const wasActive    = likeBtn.classList.contains('active');
    const wasCommitted = likeBtn.dataset.committed === 'true';

    if (wasActive) {
      likeBtn.classList.remove('active');
      likeBtn.dataset.committed = 'false';
      if (wasCommitted) {
        await sendAiFeedback({ feature_type: 'resume', greeting_index: null, feedback_type: 'like', cancelled: true, dislike_reasons: null, content: null });
      }
    } else {
      if (dislikeBtn.classList.contains('active') && dislikeBtn.dataset.committed === 'true') {
        dislikeBtn.dataset.committed = 'false';
        await sendAiFeedback({ feature_type: 'resume', greeting_index: null, feedback_type: 'dislike', cancelled: true, dislike_reasons: null, content: null });
      }
      dislikeBtn.classList.remove('active');
      reasonsEl?.classList.add('hidden');
      likeBtn.classList.add('active');
      likeBtn.dataset.committed = 'true';
      await sendAiFeedback({ feature_type: 'resume', greeting_index: null, feedback_type: 'like', cancelled: false, dislike_reasons: null, content: null });
    }
  });

  dislikeBtn.addEventListener('click', async () => {
    const wasActive    = dislikeBtn.classList.contains('active');
    const wasCommitted = dislikeBtn.dataset.committed === 'true';

    if (wasActive) {
      dislikeBtn.classList.remove('active');
      dislikeBtn.dataset.committed = 'false';
      reasonsEl?.classList.add('hidden');
      reasonsEl?.querySelectorAll('.dislike-reason-tag').forEach(t => t.classList.remove('selected'));
      confirmBtn?.classList.add('hidden');
      if (wasCommitted) {
        await sendAiFeedback({ feature_type: 'resume', greeting_index: null, feedback_type: 'dislike', cancelled: true, dislike_reasons: null, content: null });
      }
    } else {
      if (likeBtn.classList.contains('active') && likeBtn.dataset.committed === 'true') {
        likeBtn.dataset.committed = 'false';
        await sendAiFeedback({ feature_type: 'resume', greeting_index: null, feedback_type: 'like', cancelled: true, dislike_reasons: null, content: null });
      }
      likeBtn.classList.remove('active');
      dislikeBtn.classList.add('active');
      reasonsEl?.classList.remove('hidden');
    }
  });

  reasonsEl?.querySelectorAll('.dislike-reason-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('selected');
      const hasSelected = reasonsEl.querySelectorAll('.dislike-reason-tag.selected').length > 0;
      confirmBtn?.classList.toggle('hidden', !hasSelected);
    });
  });

  confirmBtn?.addEventListener('click', async () => {
    const selected = [...reasonsEl.querySelectorAll('.dislike-reason-tag.selected')]
      .map(el => el.dataset.reason);
    if (!selected.length) return;
    dislikeBtn.dataset.committed = 'true';
    await sendAiFeedback({ feature_type: 'resume', greeting_index: null, feedback_type: 'dislike', cancelled: false, dislike_reasons: selected, content: null });
    reasonsEl.classList.add('hidden');
    reasonsEl.querySelectorAll('.dislike-reason-tag').forEach(t => t.classList.remove('selected'));
    confirmBtn.classList.add('hidden');
    showAiFeedbackThanks(document.getElementById('resume-feedback-row'));
  });
}

function resetResumeFeedbackState() {
  const like    = document.getElementById('btn-resume-like');
  const dislike = document.getElementById('btn-resume-dislike');
  if (like)    { like.classList.remove('active');    like.dataset.committed    = 'false'; }
  if (dislike) { dislike.classList.remove('active'); dislike.dataset.committed = 'false'; }
  const reasonsEl = document.getElementById('resume-dislike-reasons');
  reasonsEl?.classList.add('hidden');
  reasonsEl?.querySelectorAll('.dislike-reason-tag').forEach(t => t.classList.remove('selected'));
  document.getElementById('btn-resume-dislike-confirm')?.classList.add('hidden');
}

// ─────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────
async function handleFeedback(status) {
  document.getElementById('btn-applied').classList.toggle('active',     status === 'applied');
  document.getElementById('btn-not-applied').classList.toggle('active', status === 'not_applied');

  const { applications = [] } = await load('applications');
  const { cache = {} }        = await load('cache');
  const idx = applications.findIndex(a => a.hash === currentCacheKey);

  const record = {
    hash:       currentCacheKey,
    company:    cache[currentCacheKey]?.company,
    title:      cache[currentCacheKey]?.title,
    applied_at: Date.now(),
    feedback:   status,
  };

  if (idx >= 0) applications[idx] = record;
  else          applications.push(record);

  await save({ applications });

  await sendAiFeedback({
    feature_type:    'application',
    greeting_index:  null,
    feedback_type:   status,
    cancelled:       false,
    dislike_reasons: null,
    content:         null,
  });
}

async function restoreFeedbackState() {
  if (!currentCacheKey) return;
  const { applications = [] } = await load('applications');
  const record = applications.find(a => a.hash === currentCacheKey);
  if (!record) return;
  document.getElementById('btn-applied').classList.toggle('active',     record.feedback === 'applied');
  document.getElementById('btn-not-applied').classList.toggle('active', record.feedback === 'not_applied');
}

// ─────────────────────────────────────────────
// Inline error toast
// ─────────────────────────────────────────────
let errorTimer = null;

function showError(msg) {
  let bar = document.getElementById('error-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'error-bar';
    bar.style.cssText = [
      'position:fixed', 'bottom:12px', 'left:12px', 'right:12px',
      'background:#191D20', 'color:#FF6B6B', 'font-size:13px',
      'font-weight:700', 'padding:10px 14px', 'border-radius:10px',
      'z-index:999', 'transition:opacity .2s',
    ].join(';');
    document.body.appendChild(bar);
  }
  bar.textContent = msg;
  bar.style.opacity = '1';
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { bar.style.opacity = '0'; }, 3500);
}

// ─────────────────────────────────────────────
// Settings screen
// ─────────────────────────────────────────────
async function openSettings() {
  const { profile, user } = await load('profile', 'user');

  document.getElementById('s-google-email').textContent = user?.email || '—';

  const b = profile?.basic || {};
  document.getElementById('s-name').textContent = b.name || '—';
  const meta = [b.target_role, b.years ? `${b.years} 年` : null, b.salary]
    .filter(Boolean).join(' · ');
  document.getElementById('s-meta').textContent = meta || '—';

  document.getElementById('s-usage').textContent = await getUsageCount();
  document.getElementById('s-resume-hint').textContent = profile ? '已上传' : '未上传';

  showScreen('settings');
}

// ─────────────────────────────────────────────
// Inline resume flow
// ─────────────────────────────────────────────
let resumeEditMode = false;

async function initResumeDiff() {
  const { cache = {} } = await load('cache');
  const cached = cache[currentCacheKey];
  if (!cached) return;

  // Fill diff screen
  document.getElementById('rsdiff-job').textContent =
    `${cached.company || ''} · ${cached.title || ''}`;

  const matches = cached.matches || [];
  const iconMap = { match: 'fa-circle-check', partial: 'fa-bolt', missing: 'fa-circle-xmark' };

  ['match', 'partial', 'missing'].forEach(status => {
    const group = matches.filter(m => m.status === status);
    document.getElementById(`rsdiff-group-${status}`).style.display = group.length ? '' : 'none';
    document.getElementById(`rsdiff-cnt-${status}`).textContent = `${group.length} 项`;
    const tagsEl = document.getElementById(`rsdiff-tags-${status}`);
    tagsEl.innerHTML = '';
    group.forEach(m => {
      const pill = document.createElement('div');
      pill.className = `rsdiff-pill ${status}`;
      pill.innerHTML = `<i class="fa-solid ${iconMap[status]}"></i><span>${m.skill}</span>`;
      tagsEl.appendChild(pill);
    });
  });

  // If already generated, jump straight to view
  if (cached.rewritten) {
    const { profile } = await load('profile');
    renderResumeInline(profile, cached.rewritten);
    applyResumeKeywords(cached.jd_parsed);
    showScreen('resume-view');
  } else {
    showScreen('resume-diff');
  }
}

async function initResumeAlign() {
  const { cache = {} } = await load('cache');
  const cached = cache[currentCacheKey];
  if (!cached) return;

  // Reset keyword selection
  resumeOptions.partialKeywords = [];
  resumeOptions.missingKeywords = [];
  resumeOptions.sections = ['summary', 'work_experience', 'projects'];
  resumeOptions.workExpMode = 'quick';

  const improvable = (cached.matches || []).filter(m => m.status === 'missing' || m.status === 'partial');
  const chipsEl = document.getElementById('rsalign-kw-chips');
  chipsEl.innerHTML = '';

  improvable.forEach(m => {
    const chip = document.createElement('button');
    chip.className = 'rsalign-kw-chip';
    chip.dataset.keyword = m.skill;
    chip.dataset.status = m.status;
    chip.type = 'button';
    chip.innerHTML = `<span class="rsalign-kw-chip-check"></span><span>${m.skill}</span>`;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      const arr = m.status === 'partial' ? resumeOptions.partialKeywords : resumeOptions.missingKeywords;
      if (chip.classList.contains('selected')) {
        arr.push(m.skill);
      } else {
        const idx = arr.indexOf(m.skill);
        if (idx > -1) arr.splice(idx, 1);
      }
      updateKwCount(improvable.length);
    });
    chipsEl.appendChild(chip);
  });

  updateKwCount(improvable.length);

  // Section checkboxes → update resumeOptions.sections
  document.querySelectorAll('.rsalign-check').forEach(cb => {
    cb.checked = resumeOptions.sections.includes(cb.value);
    cb.onchange = () => {
      if (cb.checked) {
        if (!resumeOptions.sections.includes(cb.value)) resumeOptions.sections.push(cb.value);
      } else {
        resumeOptions.sections = resumeOptions.sections.filter(s => s !== cb.value);
      }
    };
  });

  // Select all button
  const selectAllBtn = document.getElementById('rsalign-select-all');
  selectAllBtn.onclick = () => {
    const chips = [...document.querySelectorAll('.rsalign-kw-chip')];
    const allSelected = chips.every(c => c.classList.contains('selected'));
    resumeOptions.partialKeywords = [];
    resumeOptions.missingKeywords = [];
    chips.forEach(chip => {
      chip.classList.toggle('selected', !allSelected);
      if (!allSelected) {
        if (chip.dataset.status === 'partial') resumeOptions.partialKeywords.push(chip.dataset.keyword);
        else resumeOptions.missingKeywords.push(chip.dataset.keyword);
      }
    });
    updateKwCount(chips.length);
  };

  // Custom keyword input: press Enter to add chip (归入 missingKeywords)
  const kwInput = document.getElementById('rsalign-kw-input');
  kwInput.value = '';
  kwInput.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const kw = kwInput.value.trim();
    if (!kw) return;
    kwInput.value = '';
    // Avoid duplicates
    if (resumeOptions.missingKeywords.includes(kw) || resumeOptions.partialKeywords.includes(kw)) return;
    resumeOptions.missingKeywords.push(kw);
    const chip = document.createElement('button');
    chip.className = 'rsalign-kw-chip selected';
    chip.dataset.keyword = kw;
    chip.dataset.status = 'missing';
    chip.type = 'button';
    chip.innerHTML = `<span class="rsalign-kw-chip-check"></span><span>${kw}</span>`;
    chip.addEventListener('click', () => {
      chip.classList.remove('selected');
      resumeOptions.missingKeywords = resumeOptions.missingKeywords.filter(k => k !== kw);
      chip.remove();
      updateKwCount(improvable.length);
    });
    document.getElementById('rsalign-kw-chips').appendChild(chip);
    updateKwCount(improvable.length);
  };

  showScreen('resume-align');
}

function updateKwCount(total) {
  const selected = document.querySelectorAll('.rsalign-kw-chip.selected').length;
  const totalCount = total ?? document.querySelectorAll('.rsalign-kw-chip').length;
  document.getElementById('rsalign-kw-count').textContent = `(${selected}/${totalCount})`;
}

async function startResumeGeneration() {
  showScreen('resume-loading');

  const { cache = {}, profile } = await load('cache', 'profile');
  const cached = cache[currentCacheKey];

  try {
    const rewritten = await ask('REWRITE_RESUME', {
      profile,
      jdParsed: cached.jd_parsed,
      sections: resumeOptions.sections,
      workExpMode: resumeOptions.workExpMode,
      partialKeywords: resumeOptions.partialKeywords,
      missingKeywords: resumeOptions.missingKeywords,
    });

    cached.rewritten = rewritten;
    await save({ cache });

    renderResumeInline(profile, rewritten);
    applyResumeKeywords(cached.jd_parsed);
    resetResumeFeedbackState();
    showScreen('resume-view');
  } catch (err) {
    showScreen('resume-align');
    showError('简历定制失败，请重试');
    console.error(err);
  }
}

function renderResumeInline(profile, rewritten) {
  const b = profile?.basic || {};
  document.getElementById('rs-r-name').textContent = b.name || '—';
  const tagline = [b.target_role, b.years ? `${b.years} 年经验` : null, b.salary]
    .filter(Boolean).join(' · ');
  document.getElementById('rs-r-tagline').textContent = tagline;
  document.getElementById('rs-r-contact').textContent = b.contact || '';

  // Strengths
  const ul = document.getElementById('rs-r-strengths');
  ul.innerHTML = '';
  (rewritten.strengths || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent    = s.text ?? s;
    li.contentEditable = 'false';
    ul.appendChild(li);
  });

  // Experiences
  const expEl = document.getElementById('rs-r-experiences');
  expEl.innerHTML = '';
  const origExps    = profile.experiences || [];
  const rewrittenExps = rewritten.experiences || [];
  origExps.forEach((orig, i) => {
    const rw = rewrittenExps[i];
    const highlights = rw?.highlights ??
      (orig.highlights || []).map(h => ({ text: h }));

    const block = document.createElement('div');
    block.className = 'rs-r-exp-block';
    block.innerHTML = `
      <div class="rs-r-exp-header">
        <span class="rs-r-exp-company" contenteditable="false">${orig.company || ''}</span>
        <span class="rs-r-exp-period" contenteditable="false">${orig.period || ''}</span>
      </div>
      <p class="rs-r-exp-role" contenteditable="false">${orig.role || ''}</p>
    `;
    const hl = document.createElement('ul');
    hl.className = 'rs-r-exp-highlights';
    highlights.forEach(h => {
      const li = document.createElement('li');
      li.textContent     = h.text ?? h;
      li.contentEditable = 'false';
      hl.appendChild(li);
    });
    block.appendChild(hl);
    expEl.appendChild(block);
  });

  // Education
  const eduEl = document.getElementById('rs-r-education');
  eduEl.innerHTML = '';
  (profile.education || []).forEach(edu => {
    const block = document.createElement('div');
    block.className = 'rs-r-edu-block';
    block.innerHTML = `
      <div class="rs-r-edu-left">
        <p class="rs-r-edu-school" contenteditable="false">${edu.school || ''}</p>
        <p class="rs-r-edu-detail" contenteditable="false">${[edu.degree, edu.major].filter(Boolean).join(' · ')}</p>
      </div>
      <span class="rs-r-edu-period" contenteditable="false">${edu.period || ''}</span>
    `;
    eduEl.appendChild(block);
  });
}

function applyResumeKeywords(jdParsed) {
  if (!jdParsed) return;
  const keywords = [
    ...(jdParsed.must_have    || []),
    ...(jdParsed.nice_to_have || []),
  ].filter(Boolean);
  if (!keywords.length) return;

  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  const container = document.getElementById('rs-resume-page');
  const textNodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const tag = node.parentNode?.tagName?.toUpperCase();
      if (['MARK', 'SCRIPT', 'STYLE'].includes(tag)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(node => {
    if (!pattern.test(node.textContent)) return;
    pattern.lastIndex = 0;
    const parts = node.textContent.split(pattern);
    if (parts.length <= 1) return;
    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      if (!part) return;
      if (i % 2 === 1) {
        const mark = document.createElement('mark');
        mark.className   = 'rs-kw';
        mark.textContent = part;
        frag.appendChild(mark);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    node.parentNode.replaceChild(frag, node);
    pattern.lastIndex = 0;
  });
}

function setResumeEditMode(on) {
  resumeEditMode = on;
  const page = document.getElementById('rs-resume-page');
  page.classList.toggle('edit-mode', on);
  const btn = document.getElementById('btn-resume-edit');
  btn.innerHTML = on
    ? '<i class="fa-solid fa-check"></i> 完成'
    : '<i class="fa-solid fa-pen"></i> 编辑';
  page.querySelectorAll('[contenteditable]').forEach(el => {
    el.contentEditable = on ? 'true' : 'false';
  });
}

async function downloadResumePdf() {
  const btn = document.getElementById('btn-resume-download');
  btn.disabled  = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中…';
  if (resumeEditMode) setResumeEditMode(false);

  const { cache = {} } = await load('cache');
  const cached  = cache[currentCacheKey] || {};
  const filename = [cached.company, cached.title, '定制简历']
    .filter(Boolean).join('-').replace(/\s+/g, '_') + '.pdf';

  try {
    await html2pdf()
      .set({
        margin:      [10, 12],
        filename,
        image:       { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:   { mode: ['avoid-all', 'css'] },
      })
      .from(document.getElementById('rs-resume-page'))
      .save();
    sendUserEvent('resume_downloaded', {});
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="fa-solid fa-file-arrow-down"></i> 下载简历';
  }
}

if (typeof module !== 'undefined') {
  module.exports = { makeCacheKey, todayStr, getUsageCount, tryIncrementUsage, DAILY_LIMIT };
}
