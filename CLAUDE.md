# 招聘助手插件 · 开发指南

## 项目概述

Chrome 浏览器扩展，面向主动求职用户，在招聘平台职位详情页嵌入 AI 分析面板。
核心流程：上传简历 → JD 解析 → 匹配评分 → 打招呼语 → 定制简历下载。

支持平台：BOSS直聘 / 智联招聘 / 猎聘 / 拉勾

---

## 技术栈

- Chrome Extension Manifest V3
- 原生 HTML / CSS / JavaScript，**不引入任何前端框架**
- AI：DeepSeek API（deepseek-chat）
- PDF 读取：pdf.js（CDN 或本地）
- PDF 导出：html2pdf.js（本地引入）
- 数据持久化：chrome.storage.local
- 图标库：Font Awesome 6（Kit 脚本引入，CSP 已在 manifest.json 中放开）

---

## 目录结构

```
/
├── manifest.json
├── CLAUDE.md
│
├── popup/                  # 插件弹窗（主界面）
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
│
├── content/                # 注入招聘平台页面的脚本
│   ├── content.js          # JD 启发式提取 + 浮动按钮注入
│   └── content.css
│
├── background/
│   └── background.js       # Service Worker，处理 API 调用
│
├── resume/                 # 定制简历（备用/独立页，主流程已内联至 popup）
│   ├── resume.html
│   ├── resume.css
│   └── resume.js
│
├── lib/
│   ├── pdf.min.js          # pdf.js worker
│   └── html2pdf.bundle.min.js
│
└── assets/
    └── icons/              # SVG 线性图标
        ├── icon-16.png
        ├── icon-48.png
        └── icon-128.png
```

---

## 运行与调试

1. 打开 Chrome，地址栏输入 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目根目录
4. 修改代码后点击扩展卡片上的刷新图标

**调试弹窗**：右键插件图标 → 检查弹出内容
**调试 content script**：打开招聘平台页面 → F12 → Console（选择对应扩展上下文）
**调试 background**：chrome://extensions → 点击 Service Worker 链接

---

## 设计系统

> 严格遵守，不得引入阴影、渐变、模糊等效果。风格参见 `设计参考图.png`。

### 色彩 Token

```css
:root {
  --color-primary: #B0CC5D;    /* 哑光橄榄绿：CTA、高亮、badge、激活态 */
  --color-dark:    #191D20;    /* 近黑：背景块、主按钮、强调文字 */
  --color-white:   #FFFFFF;    /* 白：卡片背景、主文字区 */
  --color-gray:    #F2F2F2;    /* 浅灰：次级背景、分割线 */
  --color-muted:   #888888;    /* 中灰：辅助文字、时间戳 */

  /* 语义色 */
  --color-match:   #B0CC5D;    /* 技能匹配 ✅ */
  --color-partial: #FFD600;    /* 技能部分匹配 ⚡ */
  --color-missing: #FF4D4D;    /* 技能缺失 ❌ */
}
```

### 字体

```css
:root {
  --font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;

  --font-size-xl:  20px;   /* 页面标题 */
  --font-size-lg:  16px;   /* 卡片标题、公司名 */
  --font-size-md:  14px;   /* 正文、技能列表 */
  --font-size-sm:  12px;   /* 辅助文字、时间戳 */

  --font-weight-bold:    700;
  --font-weight-regular: 400;
}
```

### 间距与圆角

```css
:root {
  --radius-card:   14px;   /* 卡片圆角 */
  --radius-pill:   999px;  /* 按钮、badge */
  --radius-sm:     8px;    /* 输入框、小元素 */

  --space-xs:  4px;
  --space-sm:  8px;
  --space-md:  16px;
  --space-lg:  24px;
}
```

### 组件规范

**主按钮（黑底绿字）**
```css
.btn-primary {
  background: var(--color-dark);
  color: var(--color-primary);
  border-radius: var(--radius-pill);
  padding: 10px 20px;
  font-weight: var(--font-weight-bold);
  font-size: var(--font-size-md);
  border: none;
  cursor: pointer;
}
```

**次级按钮（绿底黑字）**
```css
.btn-secondary {
  background: var(--color-primary);
  color: var(--color-dark);
  border-radius: var(--radius-pill);
  padding: 10px 20px;
  font-weight: var(--font-weight-bold);
  font-size: var(--font-size-md);
  border: none;
  cursor: pointer;
}
```

**卡片**
```css
.card {
  background: var(--color-white);
  border-radius: var(--radius-card);
  padding: var(--space-md);
  /* 无阴影，无边框——靠背景色区分层级 */
}

.card-dark {
  background: var(--color-dark);
  color: var(--color-white);
  border-radius: var(--radius-card);
  padding: var(--space-md);
}
```

**匹配评分圆形 Badge**
```css
.score-badge {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary);
  color: var(--color-dark);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**技能标签**
```css
.skill-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
}
.skill-tag.match   { background: var(--color-primary); color: var(--color-dark); }
.skill-tag.partial { background: #FFD600; color: var(--color-dark); }
.skill-tag.missing { background: #FFE5E5; color: #FF4D4D; }
```

**加载动画（✦ 旋转）**
```css
.loading-star::after {
  content: "✦";
  display: inline-block;
  animation: spin 1.2s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

---

## 图标使用规范（Font Awesome 6 Free）

所有 HTML 页面在 `<head>` 引入本地 FA CSS：
```html
<link rel="stylesheet" href="../lib/fontawesome/css/all.min.css">
```
MV3 的 `script-src` 不允许外部域名，Font Awesome Kit（JS 方式）无法在扩展页面使用，改用本地 CSS + webfonts。

**图标用法**：使用 `<i>` 标签，不手写内联 SVG。
```html
<i class="fa-solid fa-chevron-left"></i>
<i class="fa-regular fa-file-lines"></i>
```

**本项目图标映射表**：

| 用途 | 图标类 |
|------|--------|
| 上传文件 | `fa-solid fa-file-arrow-up` |
| 隐私/安全 | `fa-solid fa-shield-halved` |
| 返回 | `fa-solid fa-chevron-left` |
| 职位/文档 | `fa-regular fa-file-lines` |
| 技能匹配 ✅ | `fa-solid fa-circle-check` |
| 技能部分匹配 ⚡ | `fa-solid fa-bolt` |
| 技能缺失 ❌ | `fa-solid fa-circle-xmark` |
| 复制 | `fa-regular fa-copy` |
| 编辑 | `fa-solid fa-pen` |
| 设置/档案 | `fa-regular fa-user` |

---

## 侧边栏尺寸

插件以 **Chrome Side Panel**（侧边栏）模式运行，点击工具栏图标后在浏览器右侧打开全高面板。
`manifest.json` 注册 `side_panel`，`background.js` 调用 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`。

```css
body {
  width: 100%;
  height: 100vh;
  overflow-y: auto;
  font-family: var(--font-family);
}
```

侧边栏宽度由用户拖拽调整，默认约 400px，最小 200px。

---

## 数据结构（chrome.storage.local）

```js
{
  // 用户档案（Onboarding 完成后写入）
  profile: {
    basic: { name, target_role, years, salary, contact },
    education: [{ school, degree, major, period }],
    experiences: [{ company, role, period, highlights: [] }],
    raw_text: "...",          // 原始简历文本，改写底稿
    segments: [               // 语义片段，改写溯源用
      { id: "exp_0_h_0", text: "..." }
    ]
  },

  // 每日使用计数
  usage: {
    date: "2026-06-24",       // 当日日期，跨天自动重置
    count: 0                  // 当日已分析次数，上限 30
  },

  // 职位分析缓存（key = 平台+职位URL hash）
  cache: {
    "[hash]": {
      company, title, analyzed_at,
      score,
      matches: [{ skill, status, evidence }],
      greetings: ["...", "..."],
      jd_parsed: { must_have, nice_to_have, responsibilities }
    }
  },

  // 投递记录
  applications: [
    { hash, company, title, applied_at, feedback: null | "replied" | "no_reply" }
  ],

  // 插件状态
  setup_done: true | false
}
```

---

## API 调用规范

所有 DeepSeek API 请求统一在 `background.js` 中发起，popup/content 通过 `chrome.runtime.sendMessage` 触发。

```js
// popup.js 发送
chrome.runtime.sendMessage({ type: "ANALYZE_JD", payload: { jd, profile } }, (response) => {
  if (response.error) { /* 处理错误 */ }
  else { /* response.data */ }
});

// background.js 接收
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ANALYZE_JD") {
    callDeepSeek(msg.payload).then(data => sendResponse({ data }))
                              .catch(err => sendResponse({ error: err.message }));
    return true; // 保持异步通道
  }
});
```

**API Key 存储**：直接硬编码在 `background.js` 顶部常量中。

---

## JD 提取（content.js）

启发式规则，不依赖平台 class name：

```js
function extractJD() {
  const candidates = [...document.querySelectorAll("div, section, article")];
  const JD_KEYWORDS = ["职责", "要求", "技能", "经验", "岗位", "任职"];

  return candidates
    .filter(el => el.innerText.length > 200)
    .map(el => ({
      el,
      score: JD_KEYWORDS.filter(k => el.innerText.includes(k)).length,
      len: el.innerText.length
    }))
    .sort((a, b) => b.score - a.score || b.len - a.len)[0]?.el.innerText ?? null;
}
```

提取置信度不足时（关键词命中 < 2），弹出手动输入框，用户粘贴 JD 后保存结果。

---

## 每日限额逻辑

```js
async function checkUsageLimit() {
  const today = new Date().toISOString().slice(0, 10);
  const { usage } = await chrome.storage.local.get("usage");

  if (!usage || usage.date !== today) {
    await chrome.storage.local.set({ usage: { date: today, count: 0 } });
    return true;
  }
  return usage.count < 30;
}

async function incrementUsage() {
  const today = new Date().toISOString().slice(0, 10);
  const { usage } = await chrome.storage.local.get("usage");
  await chrome.storage.local.set({
    usage: { date: today, count: (usage?.count ?? 0) + 1 }
  });
}
```

达到上限时，展示提示："今日分析次数已用完，明天再来继续分析吧 ✦"，不跳转任何外部页面。

---

## 隐私合规

- 发送至 DeepSeek 前，用正则脱敏姓名/手机/邮箱：
  ```js
  text.replace(/[一-龥]{2,4}(?=\s|$)/g, "[姓名]")
      .replace(/1[3-9]\d{9}/g, "[手机]")
      .replace(/[\w.-]+@[\w.-]+\.\w+/g, "[邮箱]")
  ```
- Onboarding 第一步展示授权说明，用户确认后方可继续
- 所有数据仅存 `chrome.storage.local`，不上传任何服务器

---

## 禁止事项

- 不引入任何 CSS 框架（Tailwind、Bootstrap 等）
- 不使用 emoji（图标一律用 Font Awesome 或 Material Icons，不手写内联 SVG）
- 不添加 box-shadow、text-shadow、backdrop-filter
- 不使用渐变背景（linear-gradient）
- 不在代码中硬编码 API Key（以下情况除外：`background.js` 中的 DeepSeek Key 可直接写死）
- 不捏造简历内容（改写必须通过 source_id 溯源验证）
