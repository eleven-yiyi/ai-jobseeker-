'use strict';

// Load API key from config.js (gitignored — never hardcode keys here)
importScripts('./config.js');

// ─────────────────────────────────────────────
// Side Panel — open on toolbar icon click
// ─────────────────────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ─────────────────────────────────────────────
// DeepSeek API
// ─────────────────────────────────────────────
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

async function callDeepSeek(systemPrompt, userPrompt) {
  const apiKey = DEEPSEEK_API_KEY;

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`DeepSeek API 错误 ${response.status}: ${body}`);
  }

  const json = await response.json();
  const raw  = json.choices?.[0]?.message?.content;
  if (!raw) throw new Error('DeepSeek 返回为空');

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('DeepSeek 返回了非 JSON 内容');
  }
}

// ─────────────────────────────────────────────
// Step 0 · 简历解析
// ─────────────────────────────────────────────
async function parseResume(rawText) {
  const system = '你是一个简历解析器。从用户提供的简历原文中，提取结构化信息，严格按 JSON 格式输出，不输出任何解释文字。';

  const user = `请解析以下简历，输出 JSON：
{
  "basic": {
    "name": "姓名",
    "target_role": "目标岗位",
    "years": 工作年限数字,
    "salary": "期望薪资",
    "contact": "联系方式"
  },
  "education": [
    { "school": "学校", "degree": "学历", "major": "专业", "period": "起止时间" }
  ],
  "experiences": [
    {
      "company": "公司名",
      "role": "职位",
      "period": "起止时间",
      "highlights": ["亮点1", "亮点2"]
    }
  ]
}

简历原文：
${rawText}`;

  const result = await callDeepSeek(system, user);

  // 附加语义片段索引，供简历改写溯源
  result.segments = buildSegments(result);
  return result;
}

// 将 experiences highlights 切片，生成带 ID 的语义片段
function buildSegments(profile) {
  const segments = [];
  (profile.experiences || []).forEach((exp, ei) => {
    (exp.highlights || []).forEach((h, hi) => {
      segments.push({ id: `exp_${ei}_h_${hi}`, text: h });
    });
  });
  return segments;
}

// ─────────────────────────────────────────────
// Step 1 · JD 解析
// ─────────────────────────────────────────────
async function parseJd(jdText) {
  const system = '你是一个职位需求分析器。从 JD 原文中提取结构化需求，严格按 JSON 格式输出，不输出任何解释文字。';

  const user = `请解析以下职位描述，输出 JSON：
{
  "must_have": ["必须具备的技能或经验，限 5 条以内"],
  "nice_to_have": ["加分项技能，限 3 条以内"],
  "responsibilities": ["核心职责，限 4 条以内"]
}

JD 原文：
${jdText}`;

  return callDeepSeek(system, user);
}

// ─────────────────────────────────────────────
// Step 2 · 匹配分析
// ─────────────────────────────────────────────
async function analyzeMatch(profile, jdParsed) {
  const system = '你是一个求职匹配分析器。根据候选人档案和职位需求，分析技能匹配情况，严格按 JSON 格式输出。';

  const user = `请分析匹配度，输出 JSON：
{
  "matches": [
    {
      "skill": "技能名称",
      "status": "match | partial | missing",
      "evidence": "档案中对应的原文依据，missing 时为 null"
    }
  ]
}

规则：
- match：档案中有明确对应经历或技能
- partial：档案中有相关但非直接匹配的经历
- missing：档案中完全没有提及

候选人档案：
${JSON.stringify(profile, null, 2)}

职位需求（must_have + nice_to_have）：
${JSON.stringify({
  must_have:    jdParsed.must_have    || [],
  nice_to_have: jdParsed.nice_to_have || [],
}, null, 2)}`;

  const result = await callDeepSeek(system, user);
  result.score = calcScore(result.matches || []);
  return result;
}

function calcScore(matches) {
  if (!matches.length) return 0;
  const weights = { match: 1, partial: 0.5, missing: 0 };
  const earned  = matches.reduce((sum, m) => sum + (weights[m.status] ?? 0), 0);
  return Math.round((earned / matches.length) * 100);
}

// ─────────────────────────────────────────────
// Step 3 · 打招呼语生成
// ─────────────────────────────────────────────
async function generateGreeting({ matches, company, title, profile }) {
  const system = '你是一个求职打招呼语生成器，擅长写简洁有力的职场开场白。';

  const user = `根据以下信息，生成 2 条打招呼语，输出 JSON：
{
  "greetings": [
    { "style": "专业简洁", "text": "..." },
    { "style": "热情积极", "text": "..." }
  ]
}

硬性要求：
- 每条 80-120 字
- 禁止以"您好"/"我对贵公司很感兴趣"开头
- 必须引用至少一个来自候选人档案的具体数字或成果
- 必须提及 1-2 个与 JD must_have 匹配的技能点

候选人匹配情况：
${JSON.stringify(matches, null, 2)}

职位信息：公司 ${company}，职位 ${title}

候选人基本信息：
${JSON.stringify(profile?.basic || {}, null, 2)}`;

  const result = await callDeepSeek(system, user);
  return result.greetings || [];
}

// ─────────────────────────────────────────────
// Step 4 · 简历改写
// ─────────────────────────────────────────────
async function rewriteResume({ profile, jdParsed }) {
  const system = `你是一个简历优化专家。根据职位需求，对候选人简历进行措辞优化，突出与 JD 的匹配点。

严格约束：
- 只改写已有内容的表达方式，禁止添加候选人档案中不存在的经历、技能或数据
- 每条改写内容必须标注来源片段 ID（source_id）
- 如无合适来源，保留原文，source_id 标注为 "original"`;

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

JD must_have 要求：
${JSON.stringify(jdParsed.must_have || [], null, 2)}

候选人简历语义片段（带 ID）：
${JSON.stringify(profile.segments || [], null, 2)}`;

  return callDeepSeek(system, user);
}

// ─────────────────────────────────────────────
// Message router
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(data  => sendResponse({ data }))
    .catch(err  => sendResponse({ error: err.message }));
  return true; // keep async channel open
});

async function handleMessage(msg) {
  switch (msg.type) {

    case 'PARSE_RESUME':
      return parseResume(msg.payload.rawText);

    case 'ANALYZE_JD': {
      const { jd, profile, company, title } = msg.payload;
      const jdParsed = await parseJd(jd);
      const match    = await analyzeMatch(profile, jdParsed);
      return { ...match, jd_parsed: jdParsed, company, title };
    }

    case 'GENERATE_GREETING':
      return generateGreeting(msg.payload);

    case 'REWRITE_RESUME':
      return rewriteResume(msg.payload);

    default:
      throw new Error(`未知消息类型: ${msg.type}`);
  }
}

if (typeof module !== 'undefined') {
  module.exports = { buildSegments, calcScore, handleMessage };
}
