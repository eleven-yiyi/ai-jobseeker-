'use strict';

// Load API key from config.js (gitignored — never hardcode keys here)
importScripts('./config.js');

// ─────────────────────────────────────────────
// Supabase
// ─────────────────────────────────────────────
async function recordFeedback(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase 错误 ${res.status}: ${body}`);
  }
}

async function recordEvent(payload) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/user_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase 错误 ${res.status}: ${body}`);
  }
}

// ─────────────────────────────────────────────
// Side Panel — open on toolbar icon click
// ─────────────────────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ─────────────────────────────────────────────
// DeepSeek API
// ─────────────────────────────────────────────
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

async function callDeepSeek(systemPrompt, userPrompt, { temperature = 0.2, max_tokens = 2500 } = {}) {
  const apiKey = DEEPSEEK_API_KEY;

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature,
      max_tokens,
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

// 将 experiences/projects highlights 切片，生成带 source_id 的语义片段
function buildSegments(profile) {
  const segments = [];
  (profile.experiences || []).forEach((exp, ei) => {
    (exp.highlights || []).forEach((h, hi) => {
      segments.push({
        source_id: `exp_${ei}_h_${hi}`,
        company: exp.company || null,
        role: exp.role || null,
        text: typeof h === 'string' ? h : h.text,
      });
    });
  });
  (profile.projects || []).forEach((proj, pi) => {
    (proj.highlights || []).forEach((h, hi) => {
      segments.push({
        source_id: `project_${pi}_h_${hi}`,
        project: proj.name || null,
        text: typeof h === 'string' ? h : h.text,
      });
    });
  });
  return segments.filter(s => s.text && s.text.trim());
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
  const score = calcScore(matches);
  const tone = score >= 80 ? 'strong' : score >= 60 ? 'balanced' : 'conservative';

  const system = '你是一个求职沟通文案专家，擅长为候选人生成简洁、自然、有针对性的职场开场白。必须严格输出合法 JSON。禁止输出 Markdown、代码块、解释文字或额外说明。不得编造候选人没有的经历、成果或数据。';

  const user = `根据以下信息，生成 2 条打招呼语，输出 JSON：
{
  "greetings": [
    { "style": "专业简洁", "text": "..." },
    { "style": "热情积极", "text": "..." }
  ]
}

硬性要求：
- 每条 80-120 个中文字符
- 禁止以"您好"/"我对贵公司很感兴趣"/"看到贵司岗位"开头
- 必须提及职位名称
- 必须提及 1-2 个与 JD must_have 匹配或部分匹配的技能点
- 优先引用候选人档案中的具体数字、成果或项目；如无数字，引用具体项目名、行业场景或工具，不得编造数字
- 语气自然，不要油腻，不要过度恭维
- 不要出现"贵公司平台广阔""希望给我一个机会"等空泛表达

生成语气策略：${tone}
规则：
- strong：可以突出高度匹配，但仍不得编造。
- balanced：强调已有相关经验，避免过度承诺。
- conservative：表达求职意愿和可迁移经验，不要包装成完全匹配。

候选人匹配情况：
${JSON.stringify(matches, null, 2)}

职位信息：公司 ${company}，职位 ${title}

候选人基本信息：
${JSON.stringify(profile?.basic || {}, null, 2)}`;

  const result = await callDeepSeek(system, user, { temperature: 0.35, max_tokens: 800 });
  return result.greetings || [];
}

// ─────────────────────────────────────────────
// Step 4 · 简历改写
// ─────────────────────────────────────────────
async function rewriteResume({ profile, jdParsed, sections, workExpMode, partialKeywords, missingKeywords }) {
  const activeSections = sections && sections.length ? sections : ['summary', 'work_experience', 'projects'];
  const partial = partialKeywords || [];
  const missing = missingKeywords || [];

  const promptSegments = profile.segments || [];

  // Dynamic output schema: only include selected sections
  const outputSchema = {};
  if (activeSections.includes('summary')) {
    outputSchema.strengths = [{ text: '个人优势亮点（3-4条）', source_id: 'exp_0_h_0' }];
  }
  if (activeSections.includes('work_experience')) {
    outputSchema.experiences = [{
      company: '公司名', role: '职位', period: '时间',
      highlights: [{ text: '改写后的亮点', source_id: 'exp_0_h_1' }],
    }];
  }
  if (activeSections.includes('projects')) {
    outputSchema.projects = [{
      name: '项目名',
      highlights: [{ text: '改写后的亮点', source_id: 'proj_0_h_0' }],
    }];
  }

  const sectionLabels = { summary: '概括', work_experience: '工作经验', projects: '项目' };
  const sectionNames = activeSections.map(s => sectionLabels[s] || s).join('、');

  const keywordsNote = [
    partial.length > 0
      ? `- 强化以下已有技能的表述，结合现有经历突出相关成果（可用数据量化）：${partial.join('、')}`
      : '',
    missing.length > 0
      ? `- 若简历片段中存在支持依据，自然融入以下关键词；无依据则不强行添加：${missing.join('、')}`
      : '',
  ].filter(Boolean).join('\n');

  const system = `你是一个严谨的简历优化专家。根据职位需求，对候选人简历进行措辞优化，突出与 JD 的匹配点。
必须严格输出合法 JSON。禁止输出 Markdown、代码块、解释文字或额外说明。

严格约束：
- 只改写已有内容的表达方式，禁止添加候选人档案中不存在的经历、技能或数据
- 每条改写内容必须标注来源片段 ID（source_id）
- 如无合适来源，保留原文，source_id 标注为 "original"
- 不得把 partial 或 missing 的能力包装成完全匹配
- 如原文有数字可强化表达；原文无数字禁止新增数字
- missingKeywords 无依据时禁止添加

改写规范：
- strengths 输出 3-4 条
- 每段工作经历输出 2-4 条 highlights
- 每个项目输出 2-4 条 highlights
- 处理全部工作经历
- 优先突出与 JD must_have 匹配的内容
- 使用动作导向表达：负责、主导、优化、搭建、推动、协同
- 不要生成过度营销或夸张的表述`;

  const user = `改写模块：${sectionNames}
关键词要求：
${keywordsNote || '（无）'}

按以下 JSON 结构输出，仅包含所列字段：
${JSON.stringify(outputSchema, null, 2)}

JD must_have 要求：
${JSON.stringify(jdParsed.must_have || [], null, 2)}

候选人简历语义片段（带 ID）：
${JSON.stringify(promptSegments, null, 2)}`;

  return callDeepSeek(system, user, { max_tokens: 3500 });
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

    case 'RECORD_FEEDBACK':
      return recordFeedback(msg.payload);

    case 'RECORD_EVENT':
      return recordEvent(msg.payload);

    default:
      throw new Error(`未知消息类型: ${msg.type}`);
  }
}

if (typeof module !== 'undefined') {
  module.exports = { buildSegments, calcScore, handleMessage };
}
