'use strict';

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let isEditMode  = false;
let currentStep = 0;
let appData     = null;   // { cache, cached, profile, cacheKey }

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  bindStaticListeners();

  const cacheKey = new URLSearchParams(location.search).get('key');
  if (!cacheKey) {
    showError('缺少职位参数，请从插件重新打开此页面');
    return;
  }

  const { cache = {}, profile } = await load('cache', 'profile');
  const cached = cache[cacheKey];

  if (!cached || !profile) {
    showError('找不到职位数据，请重新分析后再试');
    return;
  }

  appData = { cache, cached, profile, cacheKey };
  setSubtitle(cached.company, cached.title);
  renderDiff(cached);

  if (cached.rewritten) {
    // Already generated before — skip straight to review
    render(profile, cached.rewritten);
    applyHighlights(cached.jd_parsed);
    goToStep(3);
  } else {
    goToStep(1);
  }
});

// ─────────────────────────────────────────────
// Step management
// ─────────────────────────────────────────────
function goToStep(n) {
  currentStep = n;

  // Update step circles + lines
  [1, 2, 3].forEach(i => {
    const el = document.getElementById(`step-${i}`);
    el.classList.toggle('active', i <= n);
    el.classList.toggle('completed', i < n);
  });
  [1, 2].forEach(i => {
    const line = document.getElementById(`step-line-${i}`);
    line.classList.toggle('active', i < n);
  });

  // Show / hide content panels
  document.getElementById('state-diff').classList.toggle('hidden',    n !== 1);
  document.getElementById('state-loading').classList.toggle('hidden', n !== 2);
  document.getElementById('state-error').classList.toggle('hidden',   true);
  document.getElementById('state-resume').classList.toggle('hidden',  n !== 3);

  // Update bottom bar button
  const btn    = document.getElementById('btn-bottom-action');
  const editBtn = document.getElementById('btn-edit-toggle');

  if (n === 1) {
    btn.innerHTML = '生成定制简历 <i class="fa-solid fa-arrow-right"></i>';
    btn.disabled  = false;
    editBtn.classList.add('hidden');
  } else if (n === 2) {
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中…';
    btn.disabled  = true;
    editBtn.classList.add('hidden');
  } else if (n === 3) {
    btn.innerHTML = '<i class="fa-solid fa-file-arrow-down"></i> 下载简历';
    btn.disabled  = false;
    editBtn.classList.remove('hidden');
  }
}

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  ['state-diff', 'state-loading', 'state-resume'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById('state-error').classList.remove('hidden');
}

// ─────────────────────────────────────────────
// Step 1 · Render differences
// ─────────────────────────────────────────────
function renderDiff(cached) {
  document.getElementById('diff-job-name').textContent =
    `${cached.company || ''} · ${cached.title || ''}`;

  const matches = cached.matches || [];
  const grid    = document.getElementById('diff-grid');
  grid.innerHTML = '';

  const iconMap = {
    match:   'fa-circle-check',
    partial: 'fa-bolt',
    missing: 'fa-circle-xmark',
  };

  matches.forEach(m => {
    const pill = document.createElement('div');
    pill.className = `diff-pill ${m.status}`;
    pill.innerHTML = `<i class="fa-solid ${iconMap[m.status] || 'fa-circle'}"></i><span>${m.skill}</span>`;
    grid.appendChild(pill);
  });

  const matchCount   = matches.filter(m => m.status === 'match').length;
  const partialCount = matches.filter(m => m.status === 'partial').length;
  const missingCount = matches.filter(m => m.status === 'missing').length;
  document.getElementById('diff-summary').textContent =
    `${matchCount} 项完全匹配 · ${partialCount} 项待加强 · ${missingCount} 项需补充`;
}

// ─────────────────────────────────────────────
// Step 2 · Generate
// ─────────────────────────────────────────────
async function startGeneration() {
  goToStep(2);

  const { cached, cache, profile } = appData;
  try {
    const rewritten = await ask('REWRITE_RESUME', {
      profile,
      jdParsed: cached.jd_parsed,
    });

    cached.rewritten = rewritten;
    await save({ cache });

    render(profile, rewritten);
    applyHighlights(cached.jd_parsed);
    goToStep(3);
  } catch (err) {
    showError(err.message);
  }
}

// ─────────────────────────────────────────────
// Step 3 · Keyword highlighting
// ─────────────────────────────────────────────
function applyHighlights(jdParsed) {
  if (!jdParsed) return;

  const keywords = [
    ...(jdParsed.must_have     || []),
    ...(jdParsed.nice_to_have  || []),
  ].filter(Boolean);

  if (!keywords.length) return;

  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  const container = document.getElementById('resume-page');
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
        mark.className   = 'highlight-kw';
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

// ─────────────────────────────────────────────
// Render resume (unchanged logic)
// ─────────────────────────────────────────────
function render(profile, rewritten) {
  renderHeader(profile);
  renderStrengths(rewritten.strengths   || []);
  renderExperiences(rewritten.experiences || [], profile.experiences || []);
  renderEducation(profile.education     || []);
}

function renderHeader(profile) {
  const b = profile.basic || {};
  document.getElementById('r-name').textContent = b.name || '—';
  const taglineParts = [
    b.target_role,
    b.years ? `${b.years} 年经验` : null,
    b.salary,
  ].filter(Boolean);
  document.getElementById('r-tagline').textContent = taglineParts.join(' · ');
  document.getElementById('r-contact').textContent = b.contact || '';
}

function renderStrengths(strengths) {
  const ul = document.getElementById('r-strengths');
  ul.innerHTML = '';
  strengths.forEach(s => {
    const li = document.createElement('li');
    li.textContent    = s.text ?? s;
    li.dataset.source = s.source_id ?? 'original';
    li.contentEditable = 'false';
    ul.appendChild(li);
  });
}

function renderExperiences(rewrittenExps, originalExps) {
  const container = document.getElementById('r-experiences');
  container.innerHTML = '';

  const merged = originalExps.map((orig, i) => {
    const rw = rewrittenExps[i];
    return {
      company:    orig.company,
      role:       orig.role,
      period:     orig.period,
      highlights: rw?.highlights ??
        (orig.highlights || []).map(h => ({ text: h, source_id: 'original' })),
    };
  });

  merged.forEach(exp => {
    const block = document.createElement('div');
    block.className = 'r-exp-block';

    const header = document.createElement('div');
    header.className = 'r-exp-header';
    header.innerHTML = `
      <span class="r-exp-company" contenteditable="false">${exp.company || ''}</span>
      <span class="r-exp-period"  contenteditable="false">${exp.period  || ''}</span>
    `;

    const role = document.createElement('p');
    role.className       = 'r-exp-role';
    role.textContent     = exp.role || '';
    role.contentEditable = 'false';

    const ul = document.createElement('ul');
    ul.className = 'r-exp-highlights';
    exp.highlights.forEach(h => {
      const li = document.createElement('li');
      li.textContent     = h.text ?? h;
      li.dataset.source  = h.source_id ?? 'original';
      li.contentEditable = 'false';
      ul.appendChild(li);
    });

    block.append(header, role, ul);
    container.appendChild(block);
  });
}

function renderEducation(education) {
  const container = document.getElementById('r-education');
  container.innerHTML = '';
  education.forEach(edu => {
    const block = document.createElement('div');
    block.className = 'r-edu-block';
    block.innerHTML = `
      <div class="r-edu-left">
        <p class="r-edu-school" contenteditable="false">${edu.school || ''}</p>
        <p class="r-edu-detail" contenteditable="false">${[edu.degree, edu.major].filter(Boolean).join(' · ')}</p>
      </div>
      <span class="r-edu-period" contenteditable="false">${edu.period || ''}</span>
    `;
    container.appendChild(block);
  });
}

// ─────────────────────────────────────────────
// Edit mode
// ─────────────────────────────────────────────
function setEditMode(on) {
  isEditMode = on;
  document.getElementById('resume-page').classList.toggle('edit-mode', on);

  const btn = document.getElementById('btn-edit-toggle');
  btn.classList.toggle('active', on);
  btn.innerHTML = on
    ? '<i class="fa-solid fa-check"></i> 完成'
    : '<i class="fa-solid fa-pen"></i> 编辑';

  document.querySelectorAll('#resume-page [contenteditable]').forEach(el => {
    el.contentEditable = on ? 'true' : 'false';
  });
}

// ─────────────────────────────────────────────
// PDF download
// ─────────────────────────────────────────────
async function downloadPdf() {
  const btn = document.getElementById('btn-bottom-action');
  btn.disabled  = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 生成中...';

  if (isEditMode) setEditMode(false);

  const { cached } = appData;
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
      .from(document.getElementById('resume-page'))
      .save();
  } finally {
    btn.disabled  = false;
    btn.innerHTML = '<i class="fa-solid fa-file-arrow-down"></i> 下载简历';
  }
}

// ─────────────────────────────────────────────
// Storage & messaging helpers
// ─────────────────────────────────────────────
async function load(...keys) {
  return chrome.storage.local.get(keys);
}

async function save(obj) {
  return chrome.storage.local.set(obj);
}

function ask(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.error)          return reject(new Error(response.error));
      resolve(response?.data);
    });
  });
}

// ─────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────
function setSubtitle(company, title) {
  const el = document.getElementById('toolbar-subtitle');
  if (el) el.textContent = `${company} · ${title}`;
}

// ─────────────────────────────────────────────
// Static listeners
// ─────────────────────────────────────────────
function bindStaticListeners() {
  document.getElementById('btn-bottom-back').addEventListener('click', () => {
    if (currentStep <= 1) {
      window.close();
    } else {
      goToStep(1);
    }
  });

  document.getElementById('btn-bottom-action').addEventListener('click', async () => {
    if (currentStep === 1) await startGeneration();
    else if (currentStep === 3) await downloadPdf();
  });

  document.getElementById('btn-edit-toggle').addEventListener('click', () => {
    setEditMode(!isEditMode);
  });
}
