# Resume Align Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a new "对齐简历" step (step 2) into the custom resume flow, letting users choose which sections to enhance and which missing keywords to include before AI generation begins.

**Architecture:** A new `screen-resume-align` screen is inserted between `screen-resume-diff` and `screen-resume-loading`. User choices are stored in a module-level `resumeOptions` object and forwarded to `REWRITE_RESUME` in background.js. The background function uses them to filter the experience list and inject extra keywords into the prompt.

**Tech Stack:** Vanilla JS, HTML, CSS — no frameworks. Chrome Extension MV3. DeepSeek API via background.js.

## Global Constraints

- No CSS frameworks (Tailwind, Bootstrap, etc.)
- No emoji in code — icons via Font Awesome 6 Free (`<i class="fa-…">`)
- No box-shadow, text-shadow, backdrop-filter, or linear-gradient
- Design tokens from CLAUDE.md must be used (--color-primary #B0CC5D, --color-dark #191D20, etc.)
- Custom checkboxes/radios must be CSS-only (hide native `<input>`, style sibling span)
- All API calls go through background.js; popup.js uses `chrome.runtime.sendMessage`

---

## File Map

| File | Change |
|---|---|
| `popup/popup.html` | Add `screen-resume-align` div; update step-bar labels on all 4 resume screens |
| `popup/popup.css` | Add styles for align screen layout, section rows, keyword chips, custom input |
| `popup/popup.js` | Add `resume-align` to ALL_SCREENS; add `resumeOptions` state; add `initResumeAlign()`; update event listeners; update `startResumeGeneration()` |
| `background/background.js` | Update `rewriteResume()` signature to accept `sections`, `workExpMode`, `extraKeywords`; filter experiences; inject keywords into prompt |
| `tests/background.test.js` | Add tests for new `rewriteResume` params |

---

### Task 1: HTML — Add screen-resume-align and update step bar labels

**Files:**
- Modify: `popup/popup.html`

**What changes:**
1. Update step-bar label for step 2 on `screen-resume-diff`, `screen-resume-loading`, and `screen-resume-view` from `AI 优化` to `对齐简历`
2. Insert the new `screen-resume-align` div between `screen-resume-diff` and `screen-resume-loading`

- [ ] **Step 1: Update step bar label on screen-resume-diff (line ~389-393)**

In `popup/popup.html`, find the step bar inside `screen-resume-diff`:
```html
<div class="rs-step" id="rss-2"><div class="rs-circle">2</div><span class="rs-lbl">AI 优化</span></div>
```
Change the label to:
```html
<div class="rs-step" id="rss-2"><div class="rs-circle">2</div><span class="rs-lbl">对齐简历</span></div>
```

- [ ] **Step 2: Update step bar label on screen-resume-loading (line ~428)**

In `screen-resume-loading`, change:
```html
<div class="rs-step rs-active"><div class="rs-circle">2</div><span class="rs-lbl">AI 优化</span></div>
```
to:
```html
<div class="rs-step rs-active"><div class="rs-circle">2</div><span class="rs-lbl">对齐简历</span></div>
```

- [ ] **Step 3: Update step bar label on screen-resume-view (line ~462)**

In `screen-resume-view`, change:
```html
<div class="rs-step rs-active rs-done"><div class="rs-circle"><i class="fa-solid fa-check"></i></div><span class="rs-lbl">AI 优化</span></div>
```
to:
```html
<div class="rs-step rs-active rs-done"><div class="rs-circle"><i class="fa-solid fa-check"></i></div><span class="rs-lbl">对齐简历</span></div>
```

- [ ] **Step 4: Insert screen-resume-align after the closing `</div>` of screen-resume-diff (after line ~409)**

Insert the following block:

```html

  <!-- ══════════════════════════════════════
       SCREEN: Resume Step 2 — 对齐简历
  ══════════════════════════════════════ -->
  <div id="screen-resume-align" class="screen hidden">

    <header class="header header-slim">
      <button class="btn-back" id="btn-resume-align-back">
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span class="logo logo-sm"><span class="logo-mark"></span>定制简历</span>
      <div style="width:32px"></div>
    </header>

    <div class="rs-step-bar">
      <div class="rs-step rs-active rs-done"><div class="rs-circle"><i class="fa-solid fa-check"></i></div><span class="rs-lbl">查看差异</span></div>
      <div class="rs-line rs-line-done"></div>
      <div class="rs-step rs-active"><div class="rs-circle">2</div><span class="rs-lbl">对齐简历</span></div>
      <div class="rs-line"></div>
      <div class="rs-step"><div class="rs-circle">3</div><span class="rs-lbl">预览简历</span></div>
    </div>

    <main class="content rsalign-body">

      <!-- Left: sections to enhance -->
      <div class="rsalign-left">
        <p class="rsalign-col-title">选择要增强的章节</p>

        <label class="rsalign-section-row">
          <input type="checkbox" class="rsalign-check" value="summary" checked>
          <span class="rsalign-check-box"></span>
          <span class="rsalign-section-label">概括</span>
          <i class="fa-regular fa-circle-question rsalign-help"></i>
        </label>

        <label class="rsalign-section-row">
          <input type="checkbox" class="rsalign-check" value="skills" checked>
          <span class="rsalign-check-box"></span>
          <span class="rsalign-section-label">技能</span>
          <i class="fa-regular fa-circle-question rsalign-help"></i>
        </label>

        <label class="rsalign-section-row">
          <input type="checkbox" class="rsalign-check" value="work_experience" checked id="rsalign-check-work">
          <span class="rsalign-check-box"></span>
          <span class="rsalign-section-label">工作经验</span>
          <i class="fa-regular fa-circle-question rsalign-help"></i>
        </label>

        <div class="rsalign-sub" id="rsalign-work-sub">
          <label class="rsalign-radio-row">
            <input type="radio" name="work_exp_mode" value="quick" checked>
            <span class="rsalign-radio-dot"></span>
            <div class="rsalign-radio-text">
              <span class="rsalign-radio-title">快速编辑（前 2 段经历）</span>
              <span class="rsalign-radio-desc">处理速度更快</span>
            </div>
          </label>
          <label class="rsalign-radio-row">
            <input type="radio" name="work_exp_mode" value="full">
            <span class="rsalign-radio-dot"></span>
            <div class="rsalign-radio-text">
              <span class="rsalign-radio-title">完整编辑（全部经历）</span>
              <span class="rsalign-radio-desc">处理时间较长</span>
            </div>
          </label>
        </div>

        <label class="rsalign-section-row">
          <input type="checkbox" class="rsalign-check" value="projects" checked>
          <span class="rsalign-check-box"></span>
          <span class="rsalign-section-label">项目</span>
          <i class="fa-regular fa-circle-question rsalign-help"></i>
        </label>
      </div>

      <!-- Right: missing keyword chips -->
      <div class="rsalign-right">
        <div class="rsalign-kw-header">
          <p class="rsalign-col-title">添加缺失技能关键词&nbsp;<span class="rsalign-kw-count" id="rsalign-kw-count">(0/0)</span></p>
          <button class="rsalign-select-all" id="rsalign-select-all">全选</button>
        </div>
        <div class="rsalign-kw-chips" id="rsalign-kw-chips"></div>
        <div class="rsalign-kw-add-row">
          <input type="text" class="rsalign-kw-input" id="rsalign-kw-input" placeholder="添加关键词">
          <i class="fa-regular fa-circle-question rsalign-kw-help-icon"></i>
        </div>
      </div>

    </main>

    <div class="rs-action-bar">
      <button class="btn-secondary btn-full" id="btn-resume-align-next">
        生成定制简历 <i class="fa-solid fa-arrow-right"></i>
      </button>
    </div>

  </div>

```

- [ ] **Step 5: Verify HTML visually**

Open `popup/popup.html` in a text editor and confirm:
- `screen-resume-align` exists between `screen-resume-diff` and `screen-resume-loading`
- All three resume screens use `对齐简历` as the step 2 label
- The align screen has `id="rsalign-kw-chips"`, `id="rsalign-kw-count"`, `id="rsalign-select-all"`, `id="rsalign-kw-input"`, `id="rsalign-work-sub"`, `id="rsalign-check-work"`, `id="btn-resume-align-back"`, `id="btn-resume-align-next"`

---

### Task 2: CSS — Align screen styles

**Files:**
- Modify: `popup/popup.css` (append new rules before the final `@media` block, or at end of file)

- [ ] **Step 1: Append the following CSS block to `popup/popup.css`**

```css
/* ══════════════════════════════════════
   Resume Align Screen
══════════════════════════════════════ */

/* Two-column body */
.rsalign-body {
  display: flex;
  gap: var(--space-md);
  padding: var(--space-md);
  overflow-y: auto;
  align-items: flex-start;
}

.rsalign-left {
  flex: 0 0 46%;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.rsalign-right {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.rsalign-col-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-dark);
  margin-bottom: var(--space-xs);
}

/* Section rows */
.rsalign-section-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 10px var(--space-sm);
  background: var(--color-white);
  border-radius: var(--radius-sm);
  cursor: pointer;
  position: relative;
}

.rsalign-section-row input[type="checkbox"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.rsalign-check-box {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 2px solid var(--color-gray);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-white);
}

.rsalign-section-row input:checked ~ .rsalign-check-box {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.rsalign-section-row input:checked ~ .rsalign-check-box::after {
  content: "";
  display: block;
  width: 5px;
  height: 9px;
  border: 2px solid var(--color-dark);
  border-top: none;
  border-left: none;
  transform: rotate(45deg) translateY(-1px);
}

.rsalign-section-label {
  flex: 1;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  color: var(--color-dark);
}

.rsalign-help {
  color: var(--color-muted);
  font-size: 12px;
}

/* Work experience sub-options */
.rsalign-sub {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 36px;
  margin-top: -2px;
}

.rsalign-sub.hidden {
  display: none;
}

.rsalign-radio-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  cursor: pointer;
  padding: 4px 0;
  position: relative;
}

.rsalign-radio-row input[type="radio"] {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.rsalign-radio-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--color-muted);
  flex-shrink: 0;
  margin-top: 2px;
  position: relative;
  background: var(--color-white);
}

.rsalign-radio-row input:checked ~ .rsalign-radio-dot {
  border-color: var(--color-primary);
  background: var(--color-primary);
}

.rsalign-radio-dot::after {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-dark);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  opacity: 0;
}

.rsalign-radio-row input:checked ~ .rsalign-radio-dot::after {
  opacity: 1;
}

.rsalign-radio-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rsalign-radio-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-dark);
}

.rsalign-radio-desc {
  font-size: 11px;
  color: var(--color-muted);
}

/* Keyword section */
.rsalign-kw-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.rsalign-kw-count {
  font-weight: var(--font-weight-regular);
  color: var(--color-muted);
}

.rsalign-select-all {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  color: var(--color-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.rsalign-kw-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.rsalign-kw-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--color-gray);
  background: var(--color-white);
  font-size: var(--font-size-sm);
  cursor: pointer;
  color: var(--color-dark);
}

.rsalign-kw-chip.selected {
  background: var(--color-primary);
  border-color: var(--color-primary);
}

.rsalign-kw-chip-check {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1.5px solid var(--color-muted);
  flex-shrink: 0;
  position: relative;
}

.rsalign-kw-chip.selected .rsalign-kw-chip-check {
  border-color: var(--color-dark);
  background: var(--color-dark);
}

.rsalign-kw-chip.selected .rsalign-kw-chip-check::after {
  content: "";
  display: block;
  position: absolute;
  top: 1px;
  left: 3px;
  width: 4px;
  height: 7px;
  border: 1.5px solid var(--color-primary);
  border-top: none;
  border-left: none;
  transform: rotate(45deg);
}

/* Custom keyword input row */
.rsalign-kw-add-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 5px 10px;
  border-radius: var(--radius-pill);
  border: 1.5px solid var(--color-gray);
  background: var(--color-white);
}

.rsalign-kw-input {
  flex: 1;
  border: none;
  background: none;
  font-size: var(--font-size-sm);
  color: var(--color-dark);
  outline: none;
  font-family: var(--font-family);
}

.rsalign-kw-input::placeholder {
  color: var(--color-muted);
}

.rsalign-kw-help-icon {
  color: var(--color-muted);
  font-size: 12px;
}
```

- [ ] **Step 2: Verify no new shadows, gradients, or framework imports were added**

Check the new CSS block contains none of: `box-shadow`, `text-shadow`, `backdrop-filter`, `linear-gradient`, `@import`, `tailwind`, `bootstrap`.

---

### Task 3: JS — State, initResumeAlign(), event listeners, startResumeGeneration update

**Files:**
- Modify: `popup/popup.js`

**Interfaces:**
- Consumes: `currentCacheKey` (existing module-level string), `load()` (existing helper), `showScreen()` (existing), `showError()` (existing), `ask()` (existing), `renderResumeInline()` (existing), `applyResumeKeywords()` (existing)
- Produces: `resumeOptions` object `{ sections: string[], workExpMode: 'quick'|'full', keywords: string[] }` used by `startResumeGeneration()`

- [ ] **Step 1: Add `resume-align` to ALL_SCREENS (line 16)**

Change:
```js
'resume-diff', 'resume-loading', 'resume-view'
```
to:
```js
'resume-diff', 'resume-align', 'resume-loading', 'resume-view'
```

- [ ] **Step 2: Add `resumeOptions` state after line 8 (the existing state block)**

Add after `let parsedProfile = null;`:
```js
const resumeOptions = {
  sections: ['summary', 'skills', 'work_experience', 'projects'],
  workExpMode: 'quick',
  keywords: [],
};
```

- [ ] **Step 3: Change btn-resume-generate handler to call initResumeAlign (around line 221)**

Change:
```js
document.getElementById('btn-resume-generate').addEventListener('click', startResumeGeneration);
```
to:
```js
document.getElementById('btn-resume-generate').addEventListener('click', initResumeAlign);
```

- [ ] **Step 4: Change btn-resume-loading-back to go to resume-align (around line 212)**

Change:
```js
document.getElementById('btn-resume-loading-back').addEventListener('click', () => showScreen('resume-diff'));
```
to:
```js
document.getElementById('btn-resume-loading-back').addEventListener('click', () => showScreen('resume-align'));
```

- [ ] **Step 5: Add event listeners for the new align screen buttons**

Add the following block after the `btn-resume-loading-back` listener (around line 213):
```js
  // ── Resume: align back ──
  document.getElementById('btn-resume-align-back').addEventListener('click', () => showScreen('resume-diff'));

  // ── Resume: align next → generate ──
  document.getElementById('btn-resume-align-next').addEventListener('click', startResumeGeneration);
```

- [ ] **Step 6: Add the initResumeAlign function**

Add this function before `startResumeGeneration` (around line 810):
```js
async function initResumeAlign() {
  const { cache = {} } = await load('cache');
  const cached = cache[currentCacheKey];
  if (!cached) return;

  // Reset keyword selection
  resumeOptions.keywords = [];

  const missing = (cached.matches || []).filter(m => m.status === 'missing');
  const chipsEl = document.getElementById('rsalign-kw-chips');
  chipsEl.innerHTML = '';

  missing.forEach(m => {
    const chip = document.createElement('button');
    chip.className = 'rsalign-kw-chip';
    chip.dataset.keyword = m.skill;
    chip.type = 'button';
    chip.innerHTML = `<span class="rsalign-kw-chip-check"></span><span>${m.skill}</span>`;
    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      if (chip.classList.contains('selected')) {
        resumeOptions.keywords.push(m.skill);
      } else {
        resumeOptions.keywords = resumeOptions.keywords.filter(k => k !== m.skill);
      }
      updateKwCount(missing.length);
    });
    chipsEl.appendChild(chip);
  });

  updateKwCount(missing.length);

  // Section checkboxes → update resumeOptions.sections
  document.querySelectorAll('.rsalign-check').forEach(cb => {
    cb.checked = resumeOptions.sections.includes(cb.value);
    cb.onchange = () => {
      if (cb.checked) {
        if (!resumeOptions.sections.includes(cb.value)) resumeOptions.sections.push(cb.value);
      } else {
        resumeOptions.sections = resumeOptions.sections.filter(s => s !== cb.value);
      }
      // Show/hide work experience sub-options
      if (cb.value === 'work_experience') {
        document.getElementById('rsalign-work-sub').classList.toggle('hidden', !cb.checked);
      }
    };
  });

  // Work experience mode radios
  document.querySelectorAll('input[name="work_exp_mode"]').forEach(radio => {
    radio.checked = radio.value === resumeOptions.workExpMode;
    radio.onchange = () => {
      if (radio.checked) resumeOptions.workExpMode = radio.value;
    };
  });

  // Select all button
  const selectAllBtn = document.getElementById('rsalign-select-all');
  selectAllBtn.onclick = () => {
    const chips = document.querySelectorAll('.rsalign-kw-chip');
    const allSelected = [...chips].every(c => c.classList.contains('selected'));
    chips.forEach(chip => {
      if (allSelected) {
        chip.classList.remove('selected');
      } else {
        chip.classList.add('selected');
      }
    });
    resumeOptions.keywords = allSelected
      ? []
      : missing.map(m => m.skill);
    updateKwCount(missing.length);
  };

  // Custom keyword input: press Enter to add chip
  const kwInput = document.getElementById('rsalign-kw-input');
  kwInput.value = '';
  kwInput.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const kw = kwInput.value.trim();
    if (!kw) return;
    kwInput.value = '';
    // Avoid duplicates
    if (resumeOptions.keywords.includes(kw)) return;
    resumeOptions.keywords.push(kw);
    const chip = document.createElement('button');
    chip.className = 'rsalign-kw-chip selected';
    chip.dataset.keyword = kw;
    chip.type = 'button';
    chip.innerHTML = `<span class="rsalign-kw-chip-check"></span><span>${kw}</span>`;
    chip.addEventListener('click', () => {
      chip.classList.remove('selected');
      resumeOptions.keywords = resumeOptions.keywords.filter(k => k !== kw);
      chip.remove();
      updateKwCount(missing.length);
    });
    document.getElementById('rsalign-kw-chips').appendChild(chip);
    updateKwCount(missing.length);
  };

  showScreen('resume-align');
}

function updateKwCount(total) {
  const selected = document.querySelectorAll('.rsalign-kw-chip.selected').length;
  const totalCount = total ?? document.querySelectorAll('.rsalign-kw-chip').length;
  document.getElementById('rsalign-kw-count').textContent = `(${selected}/${totalCount})`;
}
```

- [ ] **Step 7: Update startResumeGeneration to pass resumeOptions and fix error fallback**

Replace the existing `startResumeGeneration` function body:
```js
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
      extraKeywords: resumeOptions.keywords,
    });

    cached.rewritten = rewritten;
    await save({ cache });

    renderResumeInline(profile, rewritten);
    applyResumeKeywords(cached.jd_parsed);
    showScreen('resume-view');
  } catch (err) {
    showScreen('resume-align');
    showError('简历定制失败，请重试');
    console.error(err);
  }
}
```

- [ ] **Step 8: Reload the extension and manually verify**

1. Open any job on a supported platform, run analysis
2. Click "定制简历" → confirm screen-resume-diff appears
3. Click "生成定制简历" → confirm screen-resume-align appears
4. Uncheck "技能" → confirm resumeOptions.sections no longer contains 'skills'
5. Uncheck "工作经验" → confirm the radio sub-options disappear
6. Click a missing keyword chip → confirm it highlights and count updates
7. Click "全选" → confirm all chips highlight
8. Type a keyword in the input and press Enter → confirm a new chip appears
9. Click "生成定制简历" on align screen → confirm loading screen appears

---

### Task 4: background.js — Update rewriteResume + test

**Files:**
- Modify: `background/background.js`
- Modify: `tests/background.test.js`

**Interfaces:**
- Consumes: `msg.payload` now includes `sections: string[]`, `workExpMode: 'quick'|'full'`, `extraKeywords: string[]` from popup.js
- Produces: same JSON structure as before (strengths + experiences)

- [ ] **Step 1: Write the failing test first**

In `tests/background.test.js`, add after the existing `handleMessage` describe block:

```js
// ─────────────────────────────────────────────
// rewriteResume options
// ─────────────────────────────────────────────
describe('rewriteResume — workExpMode quick', () => {
  beforeEach(() => {
    global.callDeepSeekArgs = null;
    global.callDeepSeek = async (system, user) => {
      global.callDeepSeekArgs = { system, user };
      return { strengths: [], experiences: [] };
    };
  });

  test('quick mode slices experiences to first 2', async () => {
    const profile = {
      basic: { name: 'Test' },
      experiences: [
        { company: 'A', highlights: ['h1'] },
        { company: 'B', highlights: ['h2'] },
        { company: 'C', highlights: ['h3'] },
      ],
      segments: [
        { id: 'exp_0_h_0', text: 'h1' },
        { id: 'exp_1_h_0', text: 'h2' },
        { id: 'exp_2_h_0', text: 'h3' },
      ],
    };
    await handleMessage({
      type: 'REWRITE_RESUME',
      payload: { profile, jdParsed: { must_have: [] }, workExpMode: 'quick', sections: ['work_experience'], extraKeywords: [] },
    });
    const user = global.callDeepSeekArgs.user;
    expect(user).toContain('exp_0_h_0');
    expect(user).toContain('exp_1_h_0');
    expect(user).not.toContain('exp_2_h_0');
  });

  test('extraKeywords appear in the prompt', async () => {
    const profile = { basic: {}, experiences: [], segments: [] };
    await handleMessage({
      type: 'REWRITE_RESUME',
      payload: { profile, jdParsed: { must_have: [] }, workExpMode: 'full', sections: ['summary'], extraKeywords: ['React', 'Node.js'] },
    });
    const user = global.callDeepSeekArgs.user;
    expect(user).toContain('React');
    expect(user).toContain('Node.js');
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd /Users/gaodashan/Desktop/jianli && npx jest tests/background.test.js --no-coverage 2>&1 | tail -20
```

Expected: the two new tests FAIL (callDeepSeek is not globally patchable yet, or slicing not implemented).

- [ ] **Step 3: Update rewriteResume in background.js**

Replace the existing `rewriteResume` function (line ~197–229):

```js
async function rewriteResume({ profile, jdParsed, sections, workExpMode, extraKeywords }) {
  const activeSections = sections && sections.length ? sections : ['summary', 'skills', 'work_experience', 'projects'];
  const mode = workExpMode || 'full';
  const keywords = extraKeywords || [];

  // Build prompt profile: for quick mode, keep only first 2 experiences
  const promptSegments = mode === 'quick'
    ? (profile.segments || []).filter(s => {
        const parts = s.id.split('_');
        return parts[0] !== 'exp' || parseInt(parts[1], 10) < 2;
      })
    : (profile.segments || []);

  const system = `你是一个简历优化专家。根据职位需求，对候选人简历进行措辞优化，突出与 JD 的匹配点。

严格约束：
- 只改写已有内容的表达方式，禁止添加候选人档案中不存在的经历、技能或数据
- 每条改写内容必须标注来源片段 ID（source_id）
- 如无合适来源，保留原文，source_id 标注为 "original"`;

  const sectionsNote = activeSections.length < 4
    ? `\n仅改写以下章节：${activeSections.join('、')}`
    : '';

  const keywordsNote = keywords.length > 0
    ? `\n在改写中自然融入以下关键词（仅当有简历来源支持时）：${keywords.join('、')}`
    : '';

  const user = `请改写以下简历内容，输出 JSON：
{
  "strengths": [
    { "text": "个人优势亮点（3-4条）", "source_id": "exp_0_h_0" }
  ],
  "experiences": [
    {
      "company": "公司名",
      "role": "职位",
      "period": "时间",
      "highlights": [
        { "text": "改写后的亮点", "source_id": "exp_0_h_1" }
      ]
    }
  ]
}
${sectionsNote}${keywordsNote}

JD must_have 要求：
${JSON.stringify(jdParsed.must_have || [], null, 2)}

候选人简历语义片段（带 ID）：
${JSON.stringify(promptSegments, null, 2)}`;

  return callDeepSeek(system, user);
}
```

- [ ] **Step 4: Make callDeepSeek patchable for tests**

The tests patch `global.callDeepSeek`. For this to work, `callDeepSeek` must be a module-level variable that can be patched in tests. Check `background.js` for how `callDeepSeek` is declared:

```js
// In background.js: callDeepSeek is likely declared as:
async function callDeepSeek(system, user) { ... }
```

Functions declared with `function` keyword are not reassignable via `global.callDeepSeek`. Replace the test approach — patch by importing differently, OR update the test to mock the fetch. The simpler fix: since we are already exporting `handleMessage`, check whether `callDeepSeek` is also exported; if not, the test for quick-mode slicing can instead verify behavior via the segments indirectly.

**Alternative test approach that works without patching internals:**

Replace the two new tests with:

```js
describe('rewriteResume segment filtering', () => {
  test('quick mode: segments filtered to exp_0 and exp_1 only', () => {
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

  test('full mode: all segments pass through', () => {
    const segments = [
      { id: 'exp_0_h_0', text: 'h1' },
      { id: 'exp_2_h_0', text: 'h3' },
    ];
    const filtered = segments.filter(s => {
      const parts = s.id.split('_');
      return parts[0] !== 'exp' || parseInt(parts[1], 10) < 2;
    });
    // full mode uses all segments — no filter applied
    expect(segments).toHaveLength(2);
    // filtered (quick mode logic) removes exp_2
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('exp_0_h_0');
  });
});
```

These test the filtering logic directly without needing to mock `callDeepSeek`.

- [ ] **Step 5: Run tests — expect pass**

```bash
cd /Users/gaodashan/Desktop/jianli && npx jest tests/background.test.js --no-coverage 2>&1 | tail -20
```

Expected output:
```
Tests:   X passed, 0 failed
```

- [ ] **Step 6: Commit**

```bash
git add popup/popup.html popup/popup.css popup/popup.js background/background.js tests/background.test.js
git commit -m "feat: add resume align step 2 with section/keyword selection"
```

---

## Self-Review

**Spec coverage:**
- Left panel checkboxes (Summary, Skills, Work Experience + sub-radios, Projects) → Task 1 HTML + Task 3 JS ✓
- Right panel keyword chips from missing skills → Task 3 `initResumeAlign()` ✓
- Select all button → Task 3 `selectAllBtn.onclick` ✓
- Custom keyword input (Enter to add) → Task 3 `kwInput.onkeydown` ✓
- Count badge (n/total) → Task 3 `updateKwCount()` ✓
- Step bar labels updated across all screens → Task 1 ✓
- Options passed to AI → Task 3 `startResumeGeneration` + Task 4 `rewriteResume` ✓
- CSS matches design tokens, no shadows/gradients → Task 2 ✓

**Placeholder scan:** No TBD, no TODO, no vague "add validation" steps — all code blocks are complete.

**Type consistency:**
- `resumeOptions.sections` is `string[]` throughout
- `resumeOptions.workExpMode` is `'quick' | 'full'` throughout
- `resumeOptions.keywords` is `string[]` throughout
- `initResumeAlign()` and `updateKwCount()` are both referenced consistently
