# DeepSeek Prompt 设计文档 v2

所有 Prompt 均由 `background.js` 调用，以 `system` + `user` 双角色结构发送。

核心原则：

1. LLM 只负责解析、判断、改写和生成文案。
2. 匹配分数由代码计算，不由 LLM 直接打分。
3. 所有输出必须是合法 JSON。
4. 不允许编造候选人不存在的经历、技能、项目、数据或成果。
5. 简历改写必须基于 `source_id` 溯源。
6. API 调用失败或 JSON 解析失败时，前端仅展示行内错误提示，不弹出 `alert`，不跳转页面。

---

## 全局 Prompt 约束

建议在每个 Step 的 system prompt 中加入以下通用约束，提升结构化输出稳定性。

```text
你必须严格输出合法 JSON。
禁止输出 Markdown、代码块、解释文字或额外说明。
所有字段必须存在；无法提取的信息使用 null、空字符串 "" 或空数组 []。
不得编造输入材料中不存在的信息。
不得推测候选人没有明确体现的经历、技能、成果、数据或项目。
涉及候选人能力判断时，必须基于候选人档案中的明确证据。
中文输出，除非原文中的职位、公司、技术栈、工具或专有名词为英文。
```

---

# Step 0 · 简历解析

**触发时机**：Onboarding 上传 PDF 并完成文本抽取后执行一次。
**输出结果**：存入 `profile`。
**主要目标**：提取候选人基础信息、教育经历、工作经历、项目经历、技能和可追溯语义片段。

```text
[system]
你是一个严谨的简历结构化解析器。
你的任务是从候选人简历原文中提取结构化信息，并严格输出合法 JSON。
禁止输出 Markdown、代码块、解释文字或额外说明。
不得补充、推测或美化原文中没有的信息。
如果信息缺失，请使用 null、空字符串 "" 或空数组 []。

[user]
请解析以下简历原文，并输出符合以下 schema 的 JSON：

{
  "basic": {
    "name": string | null,
    "target_role": string | null,
    "years": number | null,
    "salary": string | null,
    "contact": string | null,
    "location": string | null
  },
  "education": [
    {
      "school": string,
      "degree": string | null,
      "major": string | null,
      "period": string | null
    }
  ],
  "experiences": [
    {
      "company": string,
      "role": string | null,
      "period": string | null,
      "highlights": [
        {
          "source_id": string,
          "text": string
        }
      ]
    }
  ],
  "projects": [
    {
      "name": string | null,
      "role": string | null,
      "period": string | null,
      "highlights": [
        {
          "source_id": string,
          "text": string
        }
      ]
    }
  ],
  "skills": {
    "technical": string[],
    "business": string[],
    "tools": string[],
    "soft_skills": string[]
  },
  "raw_segments": [
    {
      "source_id": string,
      "type": "basic | education | experience | project | skill | certification | other",
      "text": string
    }
  ]
}

解析规则：
1. years 必须是数字；如果原文无法明确判断工作年限，输出 null。
2. salary 保留原文表达，例如 "20-30K"、"面议"、"期望 30K"。
3. experiences.highlights 必须来自原文，不得改写成更强的结果。
4. projects 仅在简历中存在明确项目经历时输出；否则输出 []。
5. skills 只提取简历明确出现的技能、工具、业务能力或软技能。
6. raw_segments 用于后续匹配和简历改写，必须尽量覆盖主要简历内容。
7. source_id 必须稳定、唯一，建议格式：
   - exp_0_h_0
   - exp_0_h_1
   - project_0_h_0
   - edu_0
   - skill_technical_0
   - segment_0
8. 不要省略 schema 中的任何字段。

> **注意**：`raw_segments` 中的 `source_id` 必须与 `experiences.highlights` 和 `projects.highlights` 里的 `source_id` 保持一致。推荐由代码（`buildSegments`）统一从 `profile` 派生 segments，LLM 只需生成 `experiences/projects.highlights`，`source_id` 由代码赋予，可保证 ID 稳定。详见「推荐 segments_json 生成方式」一节。

简历原文：
{{raw_text}}
```

---

# Step 1 · JD 解析

**触发时机**：用户点击「分析职位」后。
**输出结果**：存入 `jd_parsed`。
**主要目标**：提取岗位核心要求、加分项和职责，为后续匹配做准备。

```text
[system]
你是一个严谨的职位需求结构化分析器。
你的任务是从职位描述中提取招聘方真正关注的要求，并严格输出合法 JSON。
禁止输出 Markdown、代码块、解释文字或额外说明。
不得添加 JD 中没有出现或无法合理归纳出的要求。

[user]
请解析以下职位描述，并输出符合以下 schema 的 JSON：

{
  "job_info": {
    "company": string | null,
    "title": string | null,
    "location": string | null,
    "salary": string | null,
    "seniority": string | null
  },
  "must_have": [
    {
      "requirement": string,
      "type": "skill | experience | education | tool | domain | soft_skill | other",
      "priority": "high | medium",
      "keywords": string[]
    }
  ],
  "nice_to_have": [
    {
      "requirement": string,
      "type": "skill | experience | education | tool | domain | soft_skill | other",
      "keywords": string[]
    }
  ],
  "responsibilities": string[],
  "jd_summary": string
}

解析规则：
1. must_have 限 5 条以内，只保留硬性要求或明显高优先级要求。
2. nice_to_have 限 3 条以内，只保留加分项、优先项或“有经验者优先”的内容。
3. responsibilities 限 4 条以内，只提取核心工作职责。
4. keywords 用于后续匹配，应包含技能、工具、行业、方法论、业务场景等关键词。
5. 不要把泛泛描述误判为硬性要求，例如“学习能力强”“积极主动”只有在 JD 明确强调时才提取。
6. 如果 JD 中没有公司名、职位、地点、薪资等信息，对应字段输出 null。
7. jd_summary 用 1 句话概括该岗位最核心的招聘诉求。
8. seniority 从 JD 中提取资历级别（如"3年以上"、"高级"、"P6"、"Senior"等）；如无，输出 null。

JD 原文：
{{jd_text}}
```

---

# Step 2 · 匹配分析

**触发时机**：Step 1 完成后立即执行。
**输出结果**：存入 `match_result`。
**注意**：LLM 只负责判断匹配状态和证据，不负责计算总分。

```text
[system]
你是一个严谨的求职匹配分析器。
你的任务是根据候选人档案和职位需求，逐条判断匹配情况。
必须严格输出合法 JSON。
禁止输出 Markdown、代码块、解释文字或额外说明。
不得编造候选人档案中不存在的证据。

[user]
请基于候选人档案和职位需求，分析匹配情况，并输出符合以下 schema 的 JSON：

{
  "matches": [
    {
      "category": "must_have | nice_to_have",
      "requirement": string,
      "type": "skill | experience | education | tool | domain | soft_skill | other",
      "status": "match | partial | missing",
      "evidence": string | null,
      "source_id": string | null,
      "reason": string
    }
  ],
  "partialKeywords": string[],
  "missingKeywords": string[],
  "top_strengths": [
    {
      "text": string,
      "source_id": string
    }
  ],
  "main_gaps": string[]
}

判断规则：
1. matches 必须覆盖 JD 中所有 must_have 和 nice_to_have。
2. match：候选人档案中有明确、直接对应的经历、技能、工具、行业经验或成果。
3. partial：候选人档案中有相关经验，但不完全等同于 JD 要求，或表达不够突出。
4. missing：候选人档案中没有相关证据。
5. evidence 必须引用候选人档案中的原文或接近原文的片段。
6. source_id 必须来自候选人档案中的 raw_segments、experiences.highlights 或 projects.highlights。
7. missing 时，evidence 和 source_id 必须为 null。
8. reason 用一句话说明判断依据，禁止夸大。
9. partialKeywords 只收录 status 为 partial 的关键词，用于 Step 4 加强表达。
10. missingKeywords 只收录 status 为 missing 的关键词，用于 Step 4 判断是否可自然融入；不得强行补充无依据内容。
11. top_strengths 限 3 条以内，必须来自候选人已有经历。
12. main_gaps 限 3 条以内，描述主要短板。

候选人档案：
{{profile_json}}

职位需求：
{{jd_parsed_json}}
```

---

## Step 2 · 评分计算

评分不由 LLM 输出，由代码计算。

### 简单评分版本

```js
function calcScore(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return 0;

  const weights = {
    match: 1,
    partial: 0.5,
    missing: 0
  };

  const earned = matches.reduce((sum, m) => {
    return sum + (weights[m.status] ?? 0);
  }, 0);

  return Math.round((earned / matches.length) * 100);
}
```

### 推荐：区分 must_have 和 nice_to_have 权重

```js
function calcWeightedScore(matches) {
  if (!Array.isArray(matches) || matches.length === 0) return 0;

  const statusWeights = {
    match: 1,
    partial: 0.5,
    missing: 0
  };

  const categoryWeights = {
    must_have: 1,
    nice_to_have: 0.5
  };

  let earned = 0;
  let total = 0;

  for (const item of matches) {
    const categoryWeight = categoryWeights[item.category] ?? 1;
    const statusWeight = statusWeights[item.status] ?? 0;

    earned += statusWeight * categoryWeight;
    total += categoryWeight;
  }

  return total === 0 ? 0 : Math.round((earned / total) * 100);
}
```

---

# Step 3 · 打招呼语生成

**触发时机**：用户点击「生成打招呼语」。
**输入依赖**：`profile_json`、`jd_parsed_json`、`match_result`。
**输出结果**：用于弹窗展示或复制。

```text
[system]
你是一个求职沟通文案专家，擅长为候选人生成简洁、自然、有针对性的职场开场白。
必须严格输出合法 JSON。
禁止输出 Markdown、代码块、解释文字或额外说明。
不得编造候选人没有的经历、成果或数据。

[user]
请根据候选人与职位的匹配情况，生成 2 条打招呼语，并输出符合以下 schema 的 JSON：

{
  "greetings": [
    {
      "style": "专业简洁",
      "text": string
    },
    {
      "style": "热情积极",
      "text": string
    }
  ]
}

硬性要求：
1. 每条 80-120 个中文字符。
2. 禁止以“您好”“我对贵公司很感兴趣”“看到贵司岗位”开头。
3. 必须提及职位名称。
4. 必须提及 1-2 个与 JD must_have 匹配或部分匹配的技能点。
5. 优先引用候选人档案中的具体数字、成果或项目；如果候选人档案中没有数字成果，则引用具体项目、行业、职责或工具，不得编造数字。
6. 语气自然，不要油腻，不要过度恭维。
7. 不要出现“贵公司平台广阔”“希望给我一个机会”等空泛表达。
8. 不要暴露 JSON、匹配分析、source_id 等内部信息。
9. 如果匹配度较低，应保持克制，不要包装成高度匹配。

职位信息：
公司：{{company}}
职位：{{title}}

候选人档案：
{{profile_json}}

职位需求：
{{jd_parsed_json}}

候选人匹配情况：
{{match_result_json}}

生成语气策略：
{{generationTone}}
规则：
- strong：可以突出高度匹配，但仍不得编造。
- balanced：强调已有相关经验，避免过度承诺。
- conservative：表达求职意愿和可迁移经验，不要包装成完全匹配。
```

---

# Step 4 · 简历改写

**触发时机**：用户点击「生成定制简历」。
**输入依赖**：`profile_json`、`segments_json`、`jd_parsed_json`、`match_result`。
**主要目标**：根据用户选中的模块，动态生成定制简历内容。

## 参数说明

* `sections`：用户选中的改写模块。

  * 可选值：`summary`、`work_experience`、`projects`
* `workExpMode`：固定为 `full`，改写全部工作经历。
* `partialKeywords`：

  * 待加强技能。
  * 来自 Step 2 中 status 为 `partial` 的要求。
  * 简历已有相关依据，但表达不够突出。
* `missingKeywords`：

  * 待补充关键词。
  * 来自 Step 2 中 status 为 `missing` 的要求。
  * 仅当候选人片段中存在间接支持依据时，才可自然融入。
  * 无依据时不得添加。

## 动态输出 schema 规则

根据 `sections` 动态生成 `outputSchema`：

* `summary` 选中 → 输出 `strengths`
* `work_experience` 选中 → 输出 `experiences`
* `projects` 选中 → 输出 `projects`

最终 JSON 只允许包含被选中模块对应的字段，不要输出未选中的字段。

---

## Step 4 Prompt

```text
[system]
你是一个严谨的简历优化专家。
你的任务是根据 JD 要求，对候选人已有简历内容进行措辞优化，使其更突出匹配点。
必须严格输出合法 JSON。
禁止输出 Markdown、代码块、解释文字或额外说明。

严格约束：
1. 只能改写已有内容的表达方式，禁止新增候选人档案中不存在的经历、技能、工具、行业、项目、数据或成果。
2. 每条改写内容必须标注 source_id。
3. source_id 必须来自输入的候选人简历语义片段。
4. 如果没有合适来源，不得生成该亮点；必要时保留原文，并将 source_id 标注为 “original”。
5. 不得把 partial 或 missing 的能力包装成 match。
6. 不得虚构量化指标。
7. “可用数据量化”仅表示：如果原始片段中已有数字或结果，可以强化表达；如果原文没有数字，不得新增数字。
8. missingKeywords 只有在候选人简历片段中存在明确或间接依据时才可自然融入；没有依据时必须忽略。
9. 保留公司名、职位名、时间等事实信息。
10. 输出 JSON 只能包含用户选中的模块字段。

改写规范：
- strengths 输出 3-4 条。
- 每段工作经历输出 2-4 条 highlights。
- 每个项目输出 2-4 条 highlights。
- 处理全部工作经历。
- 优先突出与 JD must_have 匹配或部分匹配的内容。
- 使用动作导向表达，例如”负责””主导””参与””优化””搭建””推动””协同”。
- 如果原文有成果数据，可以强化为更清晰的表达。
- 如果原文没有成果数据，可以描述职责、范围、方法、工具、协作对象或业务场景，但不得创造数字。
- 对于缺少依据的 missingKeywords，不要强行塞入简历。
- 不要生成过度营销、夸张或不符合简历事实的表述。

[user]
改写模块：
{{sectionNames}}

关键词要求：
- 强化以下已有但表达不突出的技能或经验：
{{partialKeywords}}

- 若简历片段中存在支持依据，可自然融入以下关键词；无依据则不要添加：
{{missingKeywords}}

请按以下 JSON 结构输出，仅包含所列字段：
{{outputSchema}}

JD must_have 要求：
{{must_have_list}}

JD nice_to_have 要求：
{{nice_to_have_list}}

候选人匹配情况：
{{match_result_json}}

候选人简历语义片段，带 source_id：
{{segments_json}}
```

---

## Step 4 · 推荐动态 outputSchema

### 1. 仅选择 summary

```json
{
  "strengths": [
    {
      "text": "个人优势亮点，建议 3-4 条",
      "source_id": "对应来源片段 ID"
    }
  ]
}
```

### 2. 仅选择 work_experience

```json
{
  "experiences": [
    {
      "company": "公司名",
      "role": "职位",
      "period": "时间",
      "highlights": [
        {
          "text": "改写后的经历亮点",
          "source_id": "对应来源片段 ID"
        }
      ]
    }
  ]
}
```

### 3. 仅选择 projects

```json
{
  "projects": [
    {
      "name": "项目名",
      "role": "角色",
      "period": "时间",
      "highlights": [
        {
          "text": "改写后的项目亮点",
          "source_id": "对应来源片段 ID"
        }
      ]
    }
  ]
}
```

### 4. 同时选择 summary + work_experience + projects

```json
{
  "strengths": [
    {
      "text": "个人优势亮点",
      "source_id": "对应来源片段 ID"
    }
  ],
  "experiences": [
    {
      "company": "公司名",
      "role": "职位",
      "period": "时间",
      "highlights": [
        {
          "text": "改写后的经历亮点",
          "source_id": "对应来源片段 ID"
        }
      ]
    }
  ],
  "projects": [
    {
      "name": "项目名",
      "role": "角色",
      "period": "时间",
      "highlights": [
        {
          "text": "改写后的项目亮点",
          "source_id": "对应来源片段 ID"
        }
      ]
    }
  ]
}
```

---

# 推荐 segments_json 生成方式

建议由代码统一从 `profile` 中生成 `segments_json`，不要完全依赖模型生成，以保证 source_id 稳定。

```js
function buildSegments(profile) {
  const segments = [];

  profile.experiences?.forEach((exp, expIndex) => {
    exp.highlights?.forEach((highlight, hIndex) => {
      segments.push({
        source_id: `exp_${expIndex}_h_${hIndex}`,
        type: "experience",
        company: exp.company || null,
        role: exp.role || null,
        period: exp.period || null,
        text: typeof highlight === "string" ? highlight : highlight.text
      });
    });
  });

  profile.projects?.forEach((project, projectIndex) => {
    project.highlights?.forEach((highlight, hIndex) => {
      segments.push({
        source_id: `project_${projectIndex}_h_${hIndex}`,
        type: "project",
        project: project.name || null,
        role: project.role || null,
        period: project.period || null,
        text: typeof highlight === "string" ? highlight : highlight.text
      });
    });
  });

  profile.education?.forEach((edu, eduIndex) => {
    segments.push({
      source_id: `edu_${eduIndex}`,
      type: "education",
      text: [edu.school, edu.degree, edu.major, edu.period].filter(Boolean).join("，")
    });
  });

  profile.skills?.technical?.forEach((skill, index) => {
    segments.push({
      source_id: `skill_technical_${index}`,
      type: "skill",
      text: skill
    });
  });

  profile.skills?.business?.forEach((skill, index) => {
    segments.push({
      source_id: `skill_business_${index}`,
      type: "skill",
      text: skill
    });
  });

  profile.skills?.tools?.forEach((tool, index) => {
    segments.push({
      source_id: `skill_tool_${index}`,
      type: "skill",
      text: tool
    });
  });

  profile.skills?.soft_skills?.forEach((skill, index) => {
    segments.push({
      source_id: `skill_soft_${index}`,
      type: "skill",
      text: skill
    });
  });

  return segments.filter(item => item.text && item.text.trim());
}
```

---

# 推荐 outputSchema 生成方式

```js
function buildOutputSchema(sections) {
  const schema = {};

  if (sections.includes("summary")) {
    schema.strengths = [
      {
        text: "个人优势亮点，建议 3-4 条",
        source_id: "对应来源片段 ID"
      }
    ];
  }

  if (sections.includes("work_experience")) {
    schema.experiences = [
      {
        company: "公司名",
        role: "职位",
        period: "时间",
        highlights: [
          {
            text: "改写后的经历亮点",
            source_id: "对应来源片段 ID"
          }
        ]
      }
    ];
  }

  if (sections.includes("projects")) {
    schema.projects = [
      {
        name: "项目名",
        role: "角色",
        period: "时间",
        highlights: [
          {
            text: "改写后的项目亮点",
            source_id: "对应来源片段 ID"
          }
        ]
      }
    ];
  }

  return schema;
}
```

---

# 通用配置

建议将温度进一步降低，增强 JSON 和结构化任务稳定性。

```js
const DEEPSEEK_CONFIG = {
  model: "deepseek-chat",
  temperature: 0.2,
  max_tokens: 2500,
  response_format: { type: "json_object" }
};
```

如果 Step 4 需要生成完整工作经历，可单独提高 `max_tokens`：

```js
const DEEPSEEK_REWRITE_CONFIG = {
  model: "deepseek-chat",
  temperature: 0.25,
  max_tokens: 3500,
  response_format: { type: "json_object" }
};
```

Step 3 是文案生成任务，允许略高温度以避免两条打招呼语措辞雷同：

```js
const DEEPSEEK_GREETING_CONFIG = {
  model: "deepseek-chat",
  temperature: 0.35,
  max_tokens: 800,
  response_format: { type: "json_object" }
};
```

---

# JSON 解析失败修复 Prompt

当 API 返回内容不是合法 JSON，但文本主体接近 JSON 时，可进行一次修复重试。

**使用前检查**：若返回内容末尾缺少 `}` 或 `]`（JSON 被截断），应直接重试请求并增大 `max_tokens`，而不是走修复路径——修复 Prompt 仅适用于语法错误（多余逗号、引号不匹配等），无法修复结构截断。

```text
[system]
你是 JSON 修复器。
你的任务是将输入内容修复为合法 JSON。
禁止改变字段含义。
禁止添加解释文字。
只输出修复后的 JSON。

[user]
以下内容不是合法 JSON，请修复为合法 JSON：

{{invalid_json}}
```

---

# 错误处理建议

API 调用失败时：

1. 在当前弹窗内显示行内错误提示。
2. 不使用 `alert`。
3. 不跳转页面。
4. 保留用户当前输入和已解析结果。
5. 提供“重试”按钮。
6. 对不同错误类型显示不同提示。

推荐错误文案：

```js
const ERROR_MESSAGES = {
  NETWORK_ERROR: "网络连接异常，请稍后重试。",
  API_ERROR: "AI 服务暂时不可用，请稍后重试。",
  JSON_PARSE_ERROR: "AI 返回格式异常，请点击重试。",
  EMPTY_RESUME: "未能识别到有效简历内容，请重新上传 PDF。",
  EMPTY_JD: "未能识别到职位描述，请刷新页面后重试。",
  LOW_EVIDENCE: "当前简历与岗位匹配依据较少，生成内容可能较保守。"
};
```

---

# 推荐数据流

```text
PDF 简历
  ↓ 文本抽取
raw_text
  ↓ Step 0
profile_json
  ↓ 代码生成
segments_json

职位页面
  ↓ 提取 JD 文本
jd_text
  ↓ Step 1
jd_parsed_json
  ↓ Step 2
match_result_json
  ↓ 代码计算
score / partialKeywords / missingKeywords

用户点击生成
  ├─ Step 3：打招呼语
  └─ Step 4：定制简历
```

---

# 推荐兜底逻辑

## 1. 防止 matches 为空

```js
function safeCalcScore(matches) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return {
      score: 0,
      level: "unknown"
    };
  }

  const score = calcWeightedScore(matches);

  let level = "low";
  if (score >= 80) level = "high";
  else if (score >= 60) level = "medium";

  return { score, level };
}
```

## 2. 根据匹配度控制生成语气

```js
function getGenerationTone(score) {
  if (score >= 80) {
    return "strong";
  }

  if (score >= 60) {
    return "balanced";
  }

  return "conservative";
}
```

可将该结果传入 Step 3 和 Step 4：

```text
生成语气策略：
{{generationTone}}

规则：
- strong：可以突出高度匹配，但仍不得编造。
- balanced：强调已有相关经验，避免过度承诺。
- conservative：表达求职意愿和可迁移经验，不要包装成完全匹配。
```

## 3. 检查 source_id 是否有效

```js
function validateSourceIds(result, segments) {
  const validIds = new Set(segments.map(s => s.source_id));
  validIds.add("original");

  const invalidIds = [];

  function walk(value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (value && typeof value === "object") {
      if (value.source_id && !validIds.has(value.source_id)) {
        invalidIds.push(value.source_id);
      }

      Object.values(value).forEach(walk);
    }
  }

  walk(result);

  return invalidIds;
}
```

## 4. 检查是否出现虚构数字

```js
function extractNumbers(text) {
  // 只匹配量化指标（百分比、万元、K薪资），不匹配年份和工龄等时间表达
  return String(text || "").match(/\d+(\.\d+)?%|\d+万[+元]?|\d+[kK][+元]?/g) || [];
}

function detectNewNumbers(generatedText, sourceText) {
  const generatedNums = new Set(extractNumbers(generatedText));
  const sourceNums = new Set(extractNumbers(sourceText));

  return [...generatedNums].filter(num => !sourceNums.has(num));
}
```

---

# 最终建议

当前这套 Prompt 最关键的优化方向是：

1. Step 0 增加 `raw_segments` 和稳定 `source_id`。
2. Step 1 把 JD 要求拆成结构化对象，而不是纯字符串数组。
3. Step 2 输出 `category`、`source_id`、`partialKeywords`、`missingKeywords`，方便 Step 4 使用。
4. Step 4 明确“可量化”的边界：只能强化已有数字，不能新增数字。
5. 动态 `outputSchema` 必须由代码生成，Prompt 中强约束“只输出所列字段”。
6. 前端必须做 JSON schema 校验、source_id 校验和虚构数字检测。
