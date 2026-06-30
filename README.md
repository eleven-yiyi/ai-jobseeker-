# 招聘助手 · AI Job Assistant

> Chrome 侧边栏插件，在招聘平台职位详情页嵌入 AI 分析面板，帮助求职者快速评估岗位匹配度、生成个性化打招呼语、一键导出定制简历。

**支持平台**：BOSS直聘 / 智联招聘 / 猎聘 / 拉勾

---

## 核心流程

```
上传简历 → JD 解析 → 技能匹配评分 → 打招呼语生成 → 定制简历下载
```

## 功能亮点

- **技能匹配评分** — 逐项对比 JD 要求与简历技能，按权重公式计算匹配分（不依赖模型直接打分，保证可解释性）
- **打招呼语生成** — 结合岗位亮点与个人背景，生成 2 条差异化开场白
- **定制简历改写** — 针对目标岗位重新表述工作亮点；所有改写内容强制溯源至原始简历，不捏造内容
- **投递记录追踪** — 记录每次投递并标记 HR 回复状态
- **每日限额保护** — 免费版每日 30 次分析，防止滥用

## 产品设计思路

本项目按 AI-native 产品标准设计，而非在普通软件上叠加 AI 功能：

- **输入门控前置**：图片型 PDF、过短 JD、超 Token 上限等异常在数据入口处拦截，不让用户等待 15 秒后看到"分析失败"
- **输出强制校验**：每步 API 调用结果均做 JSON 格式、字段完整性、数值范围、改写溯源的硬校验
- **分步控温**：结构化输出（解析 / 匹配）用 temperature=0，创意输出（打招呼语 0.7、改写 0.5）分别配置
- **评分可解释**：匹配分由代码按权重公式计算，模型只输出 matches 列表，每分有来源

详细设计决策见 [`招聘助手插件-产品设计.md`](招聘助手插件-产品设计.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 扩展框架 | Chrome Extension Manifest V3 |
| 前端 | 原生 HTML / CSS / JavaScript（无框架） |
| AI 主模型 | DeepSeek API（deepseek-chat） |
| AI 向量化 | 阿里云百炼 Embedding API（text-embedding-v3） |
| PDF 解析 | pdf.js |
| PDF 导出 | html2pdf.js |
| 图标 | Font Awesome 6（本地引入） |
| 数据存储 | chrome.storage.local |

## 快速开始

**1. 克隆仓库**

```bash
git clone https://github.com/eleven-yiyi/ai-jobseeker-.git
cd jianli
```

**2. 配置 API Key**

```bash
cp background/config.example.js background/config.js
# 编辑 config.js，填入 DeepSeek 和百炼的 API Key
```

**3. 加载插件**

1. 打开 Chrome，进入 `chrome://extensions`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目根目录

**4. 使用**

打开任意支持平台的职位详情页，点击浏览器工具栏图标即可打开侧边栏。

## 设计系统

采用哑光橄榄绿（`#B0CC5D`）+ 近黑（`#191D20`）的双色系，无阴影、无渐变，风格克制。

```css
--color-primary: #B0CC5D;   /* CTA、高亮、激活态 */
--color-dark:    #191D20;   /* 背景块、强调文字 */
--color-white:   #FFFFFF;   /* 卡片背景 */
--color-gray:    #F2F2F2;   /* 次级背景、分割线 */
```

---

# AI Job Assistant · Chrome Extension

> A Chrome Side Panel extension that embeds an AI analysis panel on job listing pages, helping job seekers evaluate role fit, generate personalized openers, and export tailored resumes.

**Supported platforms**: BOSS直聘 / 智联招聘 / 猎聘 / 拉勾

---

## Core Flow

```
Upload Resume → Parse JD → Skill Match Score → Generate Opener → Export Custom Resume
```

## Features

- **Skill Match Scoring** — Compares JD requirements against your resume item by item, calculates a weighted score in code (not by asking the LLM to rate directly — keeps scores explainable)
- **Opener Generation** — Generates 2 differentiated personalized openers based on the role and your background
- **Resume Rewriting** — Rewrites work highlights for the target role; all rewritten content is traced back to your original resume — no fabrication
- **Application Tracking** — Logs each application with HR response status
- **Daily Usage Limit** — Free tier capped at 30 analyses per day

## Product Design Philosophy

Built as an AI-native product rather than a conventional app with AI bolted on:

- **Input gating at the source** — Image-only PDFs, overly short JDs, and token overflows are caught at the data entry point, not after a 15-second wait
- **Mandatory output validation** — Every API response is hard-validated for JSON format, required fields, value ranges, and rewrite source traceability
- **Per-step temperature control** — Structured outputs (parsing / matching) use temperature=0; creative outputs (openers 0.7, rewriting 0.5) are configured separately
- **Explainable scoring** — Match scores are computed by a weighted formula in code; the model only outputs a matches list, so every point has a traceable source

Full design rationale in [`招聘助手插件-产品设计.md`](招聘助手插件-产品设计.md).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Chrome Extension Manifest V3 |
| Frontend | Vanilla HTML / CSS / JavaScript |
| AI Model | DeepSeek API (deepseek-chat) |
| Embeddings | Alibaba Bailian API (text-embedding-v3) |
| PDF Parsing | pdf.js |
| PDF Export | html2pdf.js |
| Icons | Font Awesome 6 (self-hosted) |
| Storage | chrome.storage.local |

## Getting Started

**1. Clone the repo**

```bash
git clone https://github.com/eleven-yiyi/ai-jobseeker-.git
cd jianli
```

**2. Configure API keys**

```bash
cp background/config.example.js background/config.js
# Edit config.js and fill in your DeepSeek and Bailian API keys
```

**3. Load the extension**

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the project root directory

**4. Use it**

Open any job listing on a supported platform, then click the extension icon in the toolbar to open the side panel.

## Design System

Matte olive green (`#B0CC5D`) paired with near-black (`#191D20`) — no shadows, no gradients, deliberately restrained.

```css
--color-primary: #B0CC5D;   /* CTA, highlights, active states */
--color-dark:    #191D20;   /* background blocks, emphasis text */
--color-white:   #FFFFFF;   /* card backgrounds */
--color-gray:    #F2F2F2;   /* secondary backgrounds, dividers */
```

---

*Built with [DeepSeek](https://platform.deepseek.com/) · [Alibaba Bailian](https://bailian.aliyun.com/)*
