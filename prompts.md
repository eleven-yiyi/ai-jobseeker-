# DeepSeek Prompt 设计文档

所有 Prompt 均由 `background.js` 调用，以 `system` + `user` 双角色结构发送。

---

## Step 0 · 简历解析

**触发时机**：Onboarding 上传 PDF 后执行一次，结果存入 `profile`。

```
[system]
你是一个简历解析器。从用户提供的简历原文中，提取结构化信息，严格按 JSON 格式输出，不输出任何解释文字。

[user]
请解析以下简历，输出 JSON：
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
{{raw_text}}
```

---

## Step 1 · JD 解析

**触发时机**：用户点击「分析职位」后。

```
[system]
你是一个职位需求分析器。从 JD 原文中提取结构化需求，严格按 JSON 格式输出，不输出任何解释文字。

[user]
请解析以下职位描述，输出 JSON：
{
  "must_have": ["必须具备的技能或经验，限 5 条以内"],
  "nice_to_have": ["加分项技能，限 3 条以内"],
  "responsibilities": ["核心职责，限 4 条以内"]
}

JD 原文：
{{jd_text}}
```

---

## Step 2 · 匹配分析

**触发时机**：Step 1 完成后立即执行。

```
[system]
你是一个求职匹配分析器。根据候选人档案和职位需求，分析技能匹配情况，严格按 JSON 格式输出。

[user]
请分析匹配度，输出 JSON：
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
{{profile_json}}

职位需求（must_have + nice_to_have）：
{{jd_parsed_json}}
```

**评分计算**（不由 LLM 打分，由代码计算）：
```js
function calcScore(matches) {
  const weights = { match: 1, partial: 0.5, missing: 0 };
  const total = matches.length;
  const earned = matches.reduce((sum, m) => sum + weights[m.status], 0);
  return Math.round((earned / total) * 100);
}
```

---

## Step 3 · 打招呼语生成

**触发时机**：用户点击「生成打招呼语」。

```
[system]
你是一个求职打招呼语生成器，擅长写简洁有力的职场开场白。

[user]
根据以下信息，生成 2 条打招呼语，输出 JSON：
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
{{matches_json}}

职位信息：公司 {{company}}，职位 {{title}}
```

---

## Step 4 · 简历改写

**触发时机**：用户点击「生成定制简历」。

```
[system]
你是一个简历优化专家。根据职位需求，对候选人简历进行措辞优化，突出与 JD 的匹配点。

严格约束：
- 只改写已有内容的表达方式，禁止添加候选人档案中不存在的经历、技能或数据
- 每条改写内容必须标注来源片段 ID（source_id）
- 如无合适来源，保留原文，source_id 标注为 "original"

[user]
请改写以下简历内容，输出 JSON：
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
{{must_have_list}}

候选人简历语义片段（带 ID）：
{{segments_json}}
```

---

## 通用配置

```js
const DEEPSEEK_CONFIG = {
  model: "deepseek-chat",
  temperature: 0.3,      // 低温，结构化输出更稳定
  max_tokens: 2000,
  response_format: { type: "json_object" }
};
```

**错误处理**：API 调用失败时，在弹窗内显示行内错误提示，不弹出 alert，不跳转页面。
