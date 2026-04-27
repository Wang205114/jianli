const http = require("http");
const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const root = __dirname;
const port = process.env.PORT || 3000;
const envFilePath = path.join(root, ".env.local");
const deepseekBaseUrlDefault = "https://api.deepseek.com";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const runtimeNodeModulesPath = path.join(
  process.env.USERPROFILE || "",
  ".cache",
  "codex-runtimes",
  "codex-primary-runtime",
  "dependencies",
  "node",
  "node_modules"
);

function requireRuntimeNodeModule(moduleName) {
  try {
    return require(moduleName);
  } catch (error) {
    const absolutePath = path.join(runtimeNodeModulesPath, moduleName);
    if (fs.existsSync(absolutePath) || fs.existsSync(`${absolutePath}.js`)) {
      return require(absolutePath);
    }
    throw error;
  }
}

const { PDFDocument } = requireRuntimeNodeModule("pdf-lib");
const { createCanvas, loadImage } = requireRuntimeNodeModule("@napi-rs/canvas");

loadLocalEnv(envFilePath);
const deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL || deepseekBaseUrlDefault;
const deepseekModel = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const publicStaticFiles = new Set([
  "/index.html",
  "/styles.css",
  "/app.js"
]);

function sendFile(filePath, res) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function normalizeWhitespace(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const aiToneReplacementRules = [
  [/协同拉通/g, "协调"],
  [/高效协同/g, "配合"],
  [/赋能/g, "支持"],
  [/抓手/g, "重点"],
  [/打法/g, "做法"],
  [/闭环/g, "复盘"],
  [/全链路/g, "整个流程"],
  [/链路/g, "流程"],
  [/拉通/g, "协调"],
  [/方法论/g, "经验"],
  [/矩阵/g, "组合"],
  [/颗粒度/g, "细节"],
  [/从0到1/g, "从开始到落地"],
  [/深度参与/g, "参与"],
  [/沉淀方法论/g, "整理经验"],
  [/沉淀经验/g, "整理经验"],
  [/沉淀复盘/g, "整理复盘"]
];

function naturalizeAiText(text) {
  let normalized = normalizeWhitespace(text);
  if (!normalized) return "";
  aiToneReplacementRules.forEach(([pattern, replacement]) => {
    normalized = normalized.replace(pattern, replacement);
  });
  return normalized
    .replace(/([，。；！？])\1+/g, "$1")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function clampFloat(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const matched = String(text || "").match(/\{[\s\S]*\}/);
    if (!matched) throw new Error("模型返回的不是有效 JSON。");
    return JSON.parse(matched[0]);
  }
}

function normalizeString(value, fallback = "") {
  const text = normalizeWhitespace(typeof value === "string" ? value : value == null ? "" : String(value));
  return text || fallback;
}

function normalizeModuleType(type, title = "") {
  const normalizedTitle = String(title || "").toLowerCase();
  if (/概述|简介|自我评价|个人评价/.test(normalizedTitle)) return "summary";
  if (/校园|社团|学生会/.test(normalizedTitle)) return "campus";
  if (/项目/.test(normalizedTitle)) return "project";
  if (/技能|能力|工具/.test(normalizedTitle)) return "skills";
  if (/实习|工作|履历|经历/.test(normalizedTitle)) return "internship";
  const source = `${String(type || "")} ${normalizedTitle}`.toLowerCase();
  if (/summary|profile|overview|概述|简介|自我评价|个人评价/.test(source)) return "summary";
  if (/internship|experience|work|实习|工作|履历|经历/.test(source)) return "internship";
  if (/campus|school activity|校园|社团|学生会/.test(source)) return "campus";
  if (/project|项目/.test(source)) return "project";
  if (/skill|tool|能力|技能/.test(source)) return "skills";
  return "custom";
}

function defaultModuleTitle(type) {
  switch (type) {
    case "summary":
      return "个人概述";
    case "internship":
      return "实习经历";
    case "campus":
      return "校园经历";
    case "project":
      return "项目经历";
    case "skills":
      return "个人技能";
    default:
      return "自定义模块";
  }
}

function normalizeModuleContent(value) {
  if (Array.isArray(value)) {
    return normalizeWhitespace(value.map((item) => normalizeString(item)).filter(Boolean).join("\n"));
  }
  if (value && typeof value === "object") {
    const preferred = value.content ?? value.text ?? value.body ?? value.description ?? value.summary ?? "";
    return normalizeModuleContent(preferred);
  }
  return normalizeString(value);
}

function normalizeResumeBasics(raw) {
  if (!raw || typeof raw !== "object") {
    return {
      name: "",
      gender: "",
      phone: "",
      email: "",
      school: "",
      degree: "",
      major: "",
      headline: ""
    };
  }

  return {
    name: normalizeString(raw.name),
    gender: normalizeString(raw.gender),
    phone: normalizeString(raw.phone || raw.mobile),
    email: normalizeString(raw.email),
    school: normalizeString(raw.school || raw.university),
    degree: normalizeString(raw.degree || raw.education_level),
    major: normalizeString(raw.major || raw.specialty),
    headline: normalizeString(raw.headline || raw.target_role || raw.objective)
  };
}

function normalizeResumeModules(rawModules) {
  return (Array.isArray(rawModules) ? rawModules : []).map((item, index) => {
    const type = normalizeModuleType(item?.type, item?.title || item?.display_title);
    const title = normalizeString(item?.title || item?.display_title || defaultModuleTitle(type), `模块 ${index + 1}`);
    const content = normalizeModuleContent(item?.content ?? item?.rewritten ?? item?.text ?? item?.body ?? item?.description ?? item?.summary);
    if (!title && !content) return null;
    return { type, title, content };
  }).filter((item) => item && (item.title || item.content)).slice(0, 12);
}

function normalizeStructuredResume(raw) {
  if (!raw || typeof raw !== "object") return null;
  const modulesSource = Array.isArray(raw.modules) ? raw.modules : Array.isArray(raw.sections) ? raw.sections : [];
  return {
    basics: normalizeResumeBasics(raw.basics || raw.profile || raw),
    modules: normalizeResumeModules(modulesSource)
  };
}

function normalizeSectionRewrites(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const type = normalizeModuleType(item?.type, item?.title || item?.display_title);
    return {
      type,
      title: naturalizeAiText(normalizeString(item?.title || item?.display_title || defaultModuleTitle(type), `板块 ${index + 1}`)),
      original: normalizeModuleContent(item?.original ?? item?.before ?? item?.source),
      reason: naturalizeAiText(normalizeString(item?.reason || item?.why)),
      rewritten: naturalizeAiText(normalizeModuleContent(item?.rewritten ?? item?.after ?? item?.content))
    };
  }).filter((item) => item.original || item.rewritten).slice(0, 10);
}

function mergeStructuredResume(primary, secondary) {
  const source = primary || secondary;
  if (!source) return null;
  const fallback = secondary || { basics: {}, modules: [] };
  return {
    basics: {
      ...(fallback.basics || {}),
      ...(source.basics || {})
    },
    modules: Array.isArray(source.modules) && source.modules.length ? source.modules : (fallback.modules || [])
  };
}

function resumeFromSectionRewrites(sectionRewrites, fallbackBasics = {}) {
  if (!Array.isArray(sectionRewrites) || !sectionRewrites.length) return null;
  return {
    basics: normalizeResumeBasics(fallbackBasics),
    modules: sectionRewrites.map((item) => ({
      type: normalizeModuleType(item.type, item.title),
      title: normalizeString(item.title || defaultModuleTitle(item.type)),
      content: normalizeModuleContent(item.rewritten || item.original)
    })).filter((item) => item.content)
  };
}

function normalizeGeneratorSectionKind(kind) {
  const source = String(kind || "").toLowerCase();
  if (source === "summary") return "summary";
  if (source === "education") return "education";
  if (source === "experience") return "experience";
  if (source === "project") return "project";
  if (source === "skills") return "skills";
  if (source === "awards") return "awards";
  return "custom";
}

function defaultGeneratorSectionTitle(kind) {
  if (kind === "summary") return "个人概述";
  if (kind === "education") return "教育背景";
  if (kind === "experience") return "实习经历";
  if (kind === "project") return "项目经历";
  if (kind === "skills") return "个人技能";
  if (kind === "awards") return "荣誉奖项";
  return "自定义模块";
}

function createGeneratorDefaultItem(kind) {
  if (kind === "summary" || kind === "skills" || kind === "awards" || kind === "custom") {
    return { text: "" };
  }
  if (kind === "education") {
    return { time: "", text: "" };
  }
  if (kind === "experience") {
    return { company: "", role: "", time: "", summary: "", bullets: [""] };
  }
  return { projectName: "", role: "", time: "", summary: "", bullets: [""] };
}

function normalizeGeneratorBullets(value) {
  const normalized = (Array.isArray(value) ? value : [])
    .map((item) => normalizeString(item))
    .filter(Boolean);
  return normalized.length ? normalized : [""];
}

function normalizeGeneratorItem(kind, raw) {
  const item = raw && typeof raw === "object" ? raw : {};
  if (kind === "summary" || kind === "skills" || kind === "awards" || kind === "custom") {
    return {
      text: normalizeString(item.text)
    };
  }
  if (kind === "education") {
    return {
      time: normalizeString(item.time),
      text: normalizeString(item.text)
    };
  }
  if (kind === "experience") {
    return {
      company: normalizeString(item.company),
      role: normalizeString(item.role),
      time: normalizeString(item.time),
      summary: normalizeString(item.summary),
      bullets: normalizeGeneratorBullets(item.bullets)
    };
  }
  return {
    projectName: normalizeString(item.projectName),
    role: normalizeString(item.role),
    time: normalizeString(item.time),
    summary: normalizeString(item.summary),
    bullets: normalizeGeneratorBullets(item.bullets)
  };
}

function normalizeGeneratorSection(raw, index = 0) {
  if (!raw || typeof raw !== "object") return null;
  const kind = normalizeGeneratorSectionKind(raw.kind);
  const items = (Array.isArray(raw.items) ? raw.items : [])
    .map((item) => normalizeGeneratorItem(kind, item))
    .filter(Boolean);
  return {
    id: normalizeString(raw.id, `sec_${kind}_${index + 1}`),
    kind,
    title: normalizeString(raw.title, defaultGeneratorSectionTitle(kind)),
    visible: raw.visible !== false,
    collapsed: Boolean(raw.collapsed),
    items: items.length ? items : [createGeneratorDefaultItem(kind)]
  };
}

function naturalizeGeneratorSection(section) {
  if (!section || typeof section !== "object") return section;
  const items = Array.isArray(section.items) ? section.items : [];
  if (section.kind === "summary" || section.kind === "skills" || section.kind === "awards" || section.kind === "custom") {
    return {
      ...section,
      title: naturalizeAiText(section.title) || section.title,
      items: items.map((item) => ({
        ...item,
        text: naturalizeAiText(item?.text)
      }))
    };
  }
  if (section.kind === "education") {
    return {
      ...section,
      title: naturalizeAiText(section.title) || section.title,
      items: items.map((item) => ({
        ...item,
        text: naturalizeAiText(item?.text)
      }))
    };
  }
  if (section.kind === "experience" || section.kind === "project") {
    return {
      ...section,
      title: naturalizeAiText(section.title) || section.title,
      items: items.map((item) => ({
        ...item,
        summary: naturalizeAiText(item?.summary),
        bullets: (Array.isArray(item?.bullets) ? item.bullets : []).map((bullet) => naturalizeAiText(bullet))
      }))
    };
  }
  return section;
}

function naturalizeStructuredResumeOutput(resume) {
  if (!resume || typeof resume !== "object") return resume;
  return {
    ...resume,
    basics: {
      ...(resume.basics || {}),
      headline: naturalizeAiText(resume?.basics?.headline || "")
    },
    modules: (Array.isArray(resume.modules) ? resume.modules : []).map((module) => ({
      ...module,
      title: naturalizeAiText(module?.title) || normalizeString(module?.title),
      content: naturalizeAiText(module?.content)
    }))
  };
}

function normalizeGeneratorResumeDocument(raw) {
  if (!raw || typeof raw !== "object") return null;
  const basics = raw.basics && typeof raw.basics === "object" ? raw.basics : {};
  const theme = raw.theme && typeof raw.theme === "object" ? raw.theme : {};
  const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((section, index) => normalizeGeneratorSection(section, index))
    .filter(Boolean);
  return {
    basics: {
      name: normalizeString(basics.name),
      targetRole: normalizeString(basics.targetRole),
      gender: normalizeString(basics.gender),
      phone: normalizeString(basics.phone),
      email: normalizeString(basics.email),
      city: normalizeString(basics.city),
      school: normalizeString(basics.school),
      major: normalizeString(basics.major),
      degree: normalizeString(basics.degree),
      photoUrl: normalizeString(basics.photoUrl)
    },
    sections,
    theme: {
      templateId: normalizeString(theme.templateId, "ref-01"),
      accentMode: normalizeString(theme.accentMode, "template"),
      accentColor: normalizeString(theme.accentColor),
      fontScale: clampFloat(theme.fontScale, 0.84, 1.16, 1)
    },
    meta: {
      version: clampNumber(meta.version, 1, 10, 1),
      lastSavedAt: Number(meta.lastSavedAt) || 0,
      lastAiDiff: meta.lastAiDiff || null
    }
  };
}

function buildGeneratorKeywords(jdText) {
  const base = ["增长", "转化", "留存", "数据分析", "活动策划", "用户分层", "渠道", "协同", "复盘", "指标"];
  const source = normalizeWhitespace(jdText).toLowerCase();
  return base.filter((item) => source.includes(item.toLowerCase())).slice(0, 5);
}

function tightenText(text, limit = 70) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return "";
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(12, limit - 1)).trim()}…`;
}

const generatorInstructionPatterns = [
  /补充你具体做了什么/,
  /把你具体做的事和结果/,
  /把原来偏空的表述/,
  /把和.+相关的内容写清楚/,
  /把.+写清楚/,
  /怎么做的/,
  /最后产出了什么/,
  /更贴近岗位关键词/,
  /结果导向/,
  /岗位关键词/,
  /围绕.+关键词/,
  /让表述更(具体|自然|正式)/,
  /动作和结果/,
  /空话/
];

function looksLikeGeneratorInstructionText(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  return generatorInstructionPatterns.some((pattern) => pattern.test(normalized));
}

function strengthenText(text, options = {}) {
  const normalized = naturalizeAiText(text);
  const goal = options.goal || "general";
  if (!normalized) {
    return "";
  }
  if (goal === "compress") {
    return tightenText(normalized, 56);
  }
  return normalized;
}

function optimizeGeneratorSectionLocally(section, options = {}) {
  const keywords = Array.isArray(options.keywords) ? options.keywords : [];
  const goal = options.goal || "general";
  const next = JSON.parse(JSON.stringify(section));

  if (section.kind === "summary" || section.kind === "skills" || section.kind === "awards" || section.kind === "custom") {
    next.items = section.items.map((item) => ({
      text: section.kind === "skills"
        ? normalizeWhitespace(String(item.text || "").split(/[\/、,，]/).map((entry) => entry.trim()).filter(Boolean).slice(0, goal === "compress" ? 6 : 10).join(" / "))
        : strengthenText(item.text, { keywords, goal })
    }));
    if (goal === "compress") {
      next.title = tightenText(next.title, 10);
    }
    return next;
  }

  if (section.kind === "education") {
    next.items = section.items.map((item) => ({
      time: normalizeString(item.time),
      text: goal === "compress" ? tightenText(item.text, 42) : strengthenText(item.text, { keywords, goal })
    }));
    return next;
  }

  if (section.kind === "experience" || section.kind === "project") {
    next.items = section.items.map((item) => {
      const primaryField = section.kind === "experience" ? "company" : "projectName";
      const bullets = normalizeGeneratorBullets(item.bullets).map((bullet) => strengthenText(bullet, { keywords, goal }));
      return {
        [primaryField]: normalizeString(item[primaryField]),
        role: normalizeString(item.role),
        time: normalizeString(item.time),
        summary: strengthenText(item.summary, { keywords, goal }),
        bullets: bullets.length ? bullets : [strengthenText("", { keywords, goal })]
      };
    });
    return next;
  }

  return next;
}

function generatorSectionsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildGeneratorDiffSummary(diffs, options = {}) {
  if (!diffs.length) {
    return options.goal === "compress"
      ? "当前内容已经比较紧凑，没有返回必须压缩的差异。"
      : "这次没有给出可靠的自动改写建议，先保留原文会更稳。";
  }
  if (options.goal === "compress") {
    return `这次压掉了 ${diffs.length} 个模块里的重复和空话，保留了更有用的信息。`;
  }
  if (options.scope === "section") {
    return "这次只改了当前卡片，把表述写得更具体一些。";
  }
  return `这次主要把 ${diffs.length} 个模块写得更具体，也顺手压掉了几句空话。`;
}

const generatorMetaExplanationPatterns = [
  /jd/i,
  /关键词/,
  /朴素/,
  /真实性/,
  /口语化/,
  /岗位匹配/,
  /更自然/,
  /原文已较好/,
  /动作边界/,
  /不新增/,
  /措辞/
];

function looksLikeGeneratorMetaExplanation(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return false;
  return generatorMetaExplanationPatterns.some((pattern) => pattern.test(normalized));
}

function buildSafeGeneratorSummary(options = {}, diffCount = 0) {
  if (!diffCount) {
    return buildGeneratorDiffSummary([], options);
  }
  if (options.goal === "compress") {
    return `这次压了 ${diffCount} 个模块，主要删掉了重复表述。`;
  }
  if (options.scope === "section") {
    return "这次只顺了一下当前模块的句子，没有改原来的事实。";
  }
  return `这次调整了 ${diffCount} 个模块，主要是把句子顺了一下，保留原来的经历信息。`;
}

function buildSafeGeneratorReason(kind) {
  if (kind === "summary") {
    return "这段主要顺了一下说法，读起来更自然。";
  }
  if (kind === "experience" || kind === "project") {
    return "这段保留了原来的经历信息，只微调了个别表达。";
  }
  if (kind === "skills") {
    return "这段主要整理了表述顺序，没有改原来的技能信息。";
  }
  return "这段只做了轻微改写，没有改原来的事实。";
}

function buildGeneratorDiffsLocally(resumeDocument, options = {}) {
  const document = normalizeGeneratorResumeDocument(resumeDocument);
  if ((options.goal || "general") !== "compress") {
    return {
      summary: buildGeneratorDiffSummary([], options),
      diffs: []
    };
  }

  const keywords = buildGeneratorKeywords(options.jdText || "");
  const targetSections = options.scope === "section"
    ? document.sections.filter((section) => section.id === options.sectionId)
    : document.sections.filter((section) => section.visible !== false);

  const diffs = targetSections.map((section) => {
    const after = optimizeGeneratorSectionLocally(section, {
      keywords,
      goal: options.goal || "general"
    });
    if (generatorSectionsEqual(section, after)) return null;
    return {
      sectionId: section.id,
      before: section,
      after,
      reason: options.goal === "compress"
        ? "删掉了重复表述，保留了更关键的信息。"
        : "这段只微调了表达，没有改原来的事实。"
    };
  }).filter(Boolean);

  return {
    summary: buildGeneratorDiffSummary(diffs, options),
    diffs
  };
}

function normalizeGeneratorAiDiffs(rawDiffs, resumeDocument, allowedSections) {
  const allowedIds = new Set((allowedSections || []).map((section) => section.id));
  return (Array.isArray(rawDiffs) ? rawDiffs : []).map((diff) => {
    const sectionId = normalizeString(diff?.sectionId);
    if (!allowedIds.has(sectionId)) return null;
    const before = resumeDocument.sections.find((section) => section.id === sectionId);
    if (!before) return null;
    const after = normalizeGeneratorSection({
      ...before,
      ...(diff?.after || {}),
      id: before.id,
      kind: before.kind,
      visible: before.visible,
      collapsed: before.collapsed
    });
    if (!after) return null;
    return {
      sectionId,
      before,
      after,
      reason: normalizeString(diff?.reason) || "这段只微调了表达，没有改原来的事实。"
    };
  }).filter(Boolean);
}

const jdActionKeywords = [
  "复盘",
  "撰写",
  "策划",
  "投放",
  "拉新",
  "转化",
  "分层",
  "调研",
  "建模",
  "谈判",
  "直播",
  "剪辑",
  "脚本",
  "采访",
  "拍摄",
  "拜访",
  "销售",
  "拓展"
];

function sanitizeGeneratorTextAgainstSource(beforeText, afterText, jdText) {
  const before = normalizeString(beforeText);
  const after = naturalizeAiText(afterText);
  const jd = normalizeWhitespace(jdText);
  if (!after) return "";
  if (looksLikeGeneratorInstructionText(after)) {
    return before;
  }
  for (const keyword of jdActionKeywords) {
    if (jd.includes(keyword) && !before.includes(keyword) && after.includes(keyword)) {
      return before;
    }
  }
  return after;
}

function sanitizeGeneratorSectionAgainstSource(before, after, jdText) {
  if (!before || !after || before.kind !== after.kind) return after;
  const next = JSON.parse(JSON.stringify(after));
  next.title = looksLikeGeneratorInstructionText(next.title) ? before.title : normalizeString(next.title, before.title);
  if (before.kind === "summary" || before.kind === "skills" || before.kind === "awards" || before.kind === "custom") {
    next.items = (Array.isArray(after.items) ? after.items : []).map((item, index) => ({
      ...item,
      text: sanitizeGeneratorTextAgainstSource(before.items?.[index]?.text, item?.text, jdText)
    }));
    return next;
  }
  if (before.kind === "education") {
    next.items = (Array.isArray(after.items) ? after.items : []).map((item, index) => ({
      ...item,
      time: before.items?.[index]?.time || "",
      text: sanitizeGeneratorTextAgainstSource(before.items?.[index]?.text, item?.text, jdText)
    }));
    return next;
  }
  if (before.kind === "experience" || before.kind === "project") {
    next.items = (Array.isArray(after.items) ? after.items : []).map((item, index) => {
      const sourceItem = before.items?.[index] || {};
      const cleanedBullets = (Array.isArray(item?.bullets) ? item.bullets : [])
        .map((bullet, bulletIndex) => sanitizeGeneratorTextAgainstSource(sourceItem?.bullets?.[bulletIndex], bullet, jdText))
        .filter(Boolean);
      return {
        ...item,
        company: before.kind === "experience" ? (sourceItem?.company || "") : undefined,
        projectName: before.kind === "project" ? (sourceItem?.projectName || "") : undefined,
        role: sourceItem?.role || "",
        time: sourceItem?.time || "",
        summary: sanitizeGeneratorTextAgainstSource(sourceItem?.summary, item?.summary, jdText),
        bullets: cleanedBullets.length ? cleanedBullets : (sourceItem?.bullets || [""])
      };
    });
    return next;
  }
  return next;
}

async function optimizeResumeDocumentWithDeepSeek(resumeDocument, options = {}) {
  const document = normalizeGeneratorResumeDocument(resumeDocument);
  if (!document) {
    throw new Error("resumeDocument 结构无效。");
  }

  const fallback = buildGeneratorDiffsLocally(document, options);
  const targetSections = options.scope === "section"
    ? document.sections.filter((section) => section.id === options.sectionId)
    : document.sections.filter((section) => section.visible !== false);

  if (!deepseekApiKey || !targetSections.length) {
    return fallback;
  }

  const schemaExample = {
    summary: "这次把概述和实习经历顺了一下，读起来更像正常投递简历。",
    diffs: [
      {
        sectionId: "sec_exp_1",
        reason: "把原句里偏硬的说法换成更自然的表述，也保留了原来的动作边界。",
        after: {
          id: "sec_exp_1",
          kind: "experience",
          title: "实习经历",
          visible: true,
          items: [
            {
              company: "某内容平台",
              role: "市场部实习生",
              time: "2024.07 - 2025.01",
              summary: "参与活动排期、物料整理和上线跟进，活动结束后整理数据和复盘要点。",
              bullets: [
                "协助整理活动需求，并跟进设计、文案和发布时间",
                "统计活动数据，记录主要表现和存在的问题"
              ]
            }
          ]
        }
      }
    ]
  };

  const systemPrompt = [
    "你是一名资深中文简历顾问兼招聘文案编辑，擅长把已有经历改写成更适合真实投递的版本。",
    "你的任务是在既有 resumeDocument 上输出 section diff，不允许新增复杂模块，不允许改模板，不允许改排版。",
    "必须遵守以下规则：",
    "1. 只能修改允许范围内的 sections，不能改 basics 中的姓名、学校、专业、学历、联系方式、城市、照片等事实字段。",
    "2. 不允许新增 section、删除 section 或修改 section 的 id / kind / visible 语义；after 必须返回完整 section 对象。",
    "3. 不得编造不存在的公司、学校、项目、头衔、时间、奖项、证书、工具、成果或具体数字。",
    "4. 如果原文缺少量化结果，就写清动作、场景和配合对象即可，不能虚构百分比、金额、人数或用户规模。",
    "5. 动词强度必须与证据匹配：如果原文只体现参与、协助、支持，就不要升级成主导、牵头、负责全盘。",
    "6. 语言必须像真实求职者会投出的简历，宁可朴素一点，也不要写得像培训课文案或 AI 润色稿。",
    "7. 优先使用常见简历动词，例如 负责、协助、整理、跟进、统计、撰写、沟通、执行、复盘。",
    "8. 尽量不要主动使用“赋能、抓手、打法、闭环、拉通、全链路、矩阵、颗粒度、方法论”等黑话；除非原文或 JD 明确出现。",
    "9. 不要把每条都写成同一种套路；没有结果时，不要硬补一句空泛的结果导向结尾。",
    "10. 如果提供了 JD，请优先提升关键词贴合度和职责相关性，但不要为了堆关键词牺牲真实性。",
    "11. JD 只能帮助你调整措辞、顺序和强调点，不能把 JD 里的新职责直接写成候选人已经做过的事。",
    "12. 如果原文没写做过某个动作，例如复盘、策划、撰写、投放、分层，就不要因为 JD 提到这些词而补写进经历。",
    "13. 如果目标是 compress，请优先删除重复话术、空洞形容词和低信息密度内容，尽量保留能证明能力的表达。",
    "14. experience / project 的要点不强制限制条数；如果内容过长，可以删掉重复要点，但不要机械截断。",
    "15. diffs 只返回确实需要修改的 section；没有必要修改时可以返回空数组。",
    "16. summary 请用一句中文概括本次到底改了哪里，像给候选人的正常说明，不要复述提示词要求，也不要写“更贴近JD关键词”“保留朴素感”“结果导向”这类套话。",
    "17. diff.reason 也要说人话，说明这条具体为什么改，不要写“岗位匹配度提升”“强化真实性”“优化表达力度”这类空泛说法。",
    "18. 你必须严格只输出 JSON，不要输出 markdown，不要输出解释，不要输出代码块。",
    `最终输出 JSON 必须严格符合这个结构：${JSON.stringify(schemaExample)}`
  ].join("\n");

  const userPrompt = [
    `优化范围：${options.scope === "section" ? "只优化当前 section" : "整份简历的可见 section"}`,
    `优化目标：${options.goal === "compress" ? "压缩到单页 A4" : "常规优化"}`,
    `当前 sectionId：${options.sectionId || "无"}`,
    "",
    "目标 JD：",
    normalizeWhitespace(options.jdText || "") || "无",
    "",
    "如果原文本身写得比较朴素，请保留这种朴素感，不要统一改成很像顾问或 AI 的口吻。",
    "不能把 JD 里的新动作直接补进经历里；原文没写做过复盘，就不能新增“撰写复盘”或“负责复盘”。",
    "",
    "完整 resumeDocument：",
    JSON.stringify(document, null, 2),
    "",
    "本次允许修改的 sections：",
    JSON.stringify(targetSections, null, 2)
  ].join("\n");

  try {
    const result = await requestDeepSeekJson({
      systemPrompt,
      userPrompt,
      temperature: 0.18,
      maxTokens: 2200
    });
    const diffs = normalizeGeneratorAiDiffs(result?.diffs, document, targetSections).map((diff) => ({
      ...diff,
      after: naturalizeGeneratorSection(sanitizeGeneratorSectionAgainstSource(diff.before, diff.after, options.jdText || "")),
      reason: looksLikeGeneratorMetaExplanation(diff.reason)
        ? buildSafeGeneratorReason(diff.after?.kind || diff.before?.kind)
        : naturalizeAiText(diff.reason)
    })).filter((diff) => !generatorSectionsEqual(diff.before, diff.after));
    const finalDiffs = diffs.length ? diffs : fallback.diffs;
    return {
      summary: finalDiffs.length
        ? (looksLikeGeneratorMetaExplanation(result?.summary)
            ? buildSafeGeneratorSummary(options, finalDiffs.length)
            : naturalizeAiText(normalizeString(result?.summary, fallback.summary)))
        : fallback.summary,
      diffs: finalDiffs
    };
  } catch (error) {
    console.warn("generator optimize fallback", error.message);
    return fallback;
  }
}

async function requestDeepSeekJson({ systemPrompt, userPrompt, temperature = 0.3, maxTokens = 1800 }) {
  if (!deepseekApiKey) {
    throw new Error("DeepSeek API Key 未配置。");
  }

  const response = await fetch(`${deepseekBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deepseekApiKey}`
    },
    body: JSON.stringify({
      model: deepseekModel,
      response_format: { type: "json_object" },
      temperature,
      max_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DeepSeek 请求失败：${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "";
  return safeJsonParse(content);
}

async function extractResumeTextFromPdf(fileBase64) {
  const buffer = Buffer.from(fileBase64, "base64");
  const parser = new PDFParse({ data: buffer });
  const parsed = await parser.getText();
  await parser.destroy();
  const text = normalizeWhitespace(parsed.text);
  if (!text) {
    throw new Error("PDF 里没有提取到可用文字，请换一份可复制文本的简历 PDF。");
  }
  return text.slice(0, 18000);
}

async function reviewResumeWithDeepSeek(resumeText, filename, jdText = "") {
  if (!deepseekApiKey) {
    throw new Error("DeepSeek API Key 未配置。");
  }

  const schemaExample = {
    overall_score: 78,
    one_line_roast: "经历方向对口，但写得还不够具体",
    strengths: ["目标岗位比较清楚", "有和市场岗位相关的经历基础"],
    rewrites: [
      {
        original: "负责用户增长相关工作，参与活动策划与执行。",
        problem: "只写了参与，没写清你具体做了什么。",
        optimized: "参与活动策划和执行，跟进物料准备、上线安排和活动后的数据整理。"
      }
    ],
    missing_keywords: ["用户分层", "转化率", "数据分析"],
    risk_flags: ["像团队成果，看不出你亲自做了哪些事", "缺少结果证据", "容易被追问这段经历的真实参与度"],
    interview_questions: [
      {
        question: "你在这段实习里亲自负责的核心动作是什么？",
        intent: "想确认这段经历里你自己具体做了什么。"
      }
    ]
  };

  const systemPrompt = [
    "你是一名资深招聘经理兼简历审校顾问，擅长判断一份中文简历是否真实、清晰、适合投递。",
    "请基于简历原文做专业诊断，语气直接但克制，输出必须让候选人可执行，也要像真人 HR 会说的话。",
    "必须遵守以下规则：",
    "1. 只评价简历原文里出现的信息；如果信息缺失，请表述为“没有体现”或“证据不足”，不要臆断候选人不会。",
    "2. strengths 返回 2 到 4 条当前简历已经具备的岗位匹配亮点，必须基于原文能证实的优点，不要空泛夸奖。",
    "3. rewrites 返回 3 到 6 条最值得修改的片段，每条都要包含 original、problem、optimized。",
    "4. problem 必须指出具体缺陷，例如动作模糊、缺少结果、看不出你具体做了什么、与 JD 关键词不对齐、像团队成果而不是个人贡献。",
    "5. optimized 必须保留事实方向，不得虚构具体数字、头衔、项目结果、工具经验或业务规模。",
    "6. 如果原文只体现参与或协助，请在 optimized 中保持这个强度，不要擅自改成主导、牵头或独立负责。",
    "7. 如果用户提供了 JD，missing_keywords 只返回 JD 中重要且简历没有明显体现的关键词；如果没有 JD，就返回空数组。",
    "8. risk_flags 最多 3 条，必须是真实面试中会被追问的风险点，例如个人贡献边界不清、时间线模糊、结果证据不足。",
    "9. interview_questions 返回 4 到 6 个真实面试官会继续追问的问题；问题和 intent 都要说人话，不要像培训课黑话。",
    "10. 语言必须自然、可信、像真实招聘反馈，宁可普通一点，也不要堆很多专业词。",
    "11. 尽量不要主动使用“赋能、抓手、打法、闭环、拉通、全链路、矩阵、颗粒度、方法论”等黑话；除非原文已经这样写。",
    "12. overall_score 取值 1 到 100；one_line_roast 字段虽然沿用旧名字，但内容请写成 12 到 24 个字的一句专业总评，不要写攻击性表达。",
    "13. 你必须严格只输出 JSON，不要输出 markdown，不要输出解释，不要输出代码块。",
    `最终输出 JSON 必须严格符合这个结构：${JSON.stringify(schemaExample)}`
  ].join("\n");

  const userPrompt = [
    `文件名：${filename || "resume.pdf"}`,
    "请分析以下简历；如果给出目标 JD，请优先判断岗位贴合度和关键词缺口。",
    "",
    "简历内容：",
    resumeText,
    "",
    "目标 JD：",
    jdText ? jdText : "无",
    "",
    "如果原文本身比较朴素，请保留这种朴素感，不要把建议统一写成很重的职业黑话。"
  ].join("\n");

  const result = await requestDeepSeekJson({
    systemPrompt,
    userPrompt,
    temperature: 0.22,
    maxTokens: 1800
  });

  return {
    overall_score: clampNumber(result.overall_score, 1, 100, 68),
    one_line_roast: naturalizeAiText(String(result.one_line_roast || "这份简历有经历基础，但写法还不够具体。")).slice(0, 24),
    strengths: Array.isArray(result.strengths)
      ? result.strengths.slice(0, 4).map((item) => naturalizeAiText(String(item)))
      : [],
    rewrites: Array.isArray(result.rewrites)
      ? result.rewrites.slice(0, 6).map((item) => ({
          original: String(item?.original || ""),
          problem: naturalizeAiText(String(item?.problem || "")),
          optimized: naturalizeAiText(String(item?.optimized || ""))
        }))
      : [],
    missing_keywords: Array.isArray(result.missing_keywords)
      ? result.missing_keywords.slice(0, 10).map((item) => String(item))
      : [],
    risk_flags: Array.isArray(result.risk_flags)
      ? result.risk_flags.slice(0, 5).map((item) => naturalizeAiText(String(item)))
      : [],
    interview_questions: Array.isArray(result.interview_questions)
      ? result.interview_questions.slice(0, 6).map((item) => ({
          question: naturalizeAiText(String(item?.question || item?.title || "")),
          intent: naturalizeAiText(String(item?.intent || item?.why || ""))
        }))
      : []
  };
}

async function rewriteResumeWithDeepSeek(resumeText, filename, structuredResume, jdText = "") {
  if (!deepseekApiKey) {
    throw new Error("DeepSeek API Key 未配置。");
  }

  const schemaExample = {
    rewrite: {
      original: "最危险的一段原文",
      reason: "为什么这段最危险",
      rewritten: "重写后的关键片段"
    },
    section_rewrites: [
      {
        type: "internship",
        title: "实习经历",
        original: "原始板块内容",
        reason: "问题原因",
        rewritten: "优化后的板块内容"
      }
    ],
    rewritten_resume: {
      basics: {
        name: "张三",
        gender: "",
        phone: "13800000000",
        email: "zhangsan@email.com",
        school: "复旦大学",
        degree: "本科",
        major: "市场营销",
        headline: "用户增长运营"
      },
      modules: [
        {
          type: "summary",
          title: "个人概述",
          content: "有市场相关实习和校园经历，做过活动执行、内容整理和数据统计，正在寻找市场方向岗位。"
        },
        {
          type: "internship",
          title: "实习经历",
          content: "可瓦科技有限公司｜市场部实习生\n参与客户关系维护、活动支持和数据整理，协助完成部门日常推广工作。"
        }
      ]
    }
  };

  const systemPrompt = [
    "你是一名资深中文简历主笔和招聘顾问，擅长把已有素材整理成可真实投递的正式简历。",
    "你的任务是：基于候选人原始简历事实，对整份简历做按板块重写，输出 section_rewrites 和 rewritten_resume。",
    "必须遵守以下规则：",
    "1. 板块 type 只允许使用以下枚举：summary、internship、campus、project、skills、custom。",
    "2. 只能基于原始简历文本和提供的 structuredResume 重写，不得新增不存在的公司、学校、项目、时间、职务、奖项、证书、工具、成果或具体数字。",
    "3. 如果原文没有明确公司名、时间、项目名或量化结果，请直接省略，不要写“XX公司”“某公司”“2023.06-2023.09”“500+”这类占位或推测值。",
    "4. 如果 structuredResume 存在，只能在它已有的模块范围内重写，禁止新增额外模块类型或凭空补出新项目。",
    "5. 如果原文没有明确量化结果，就写清动作、场景和配合对象，不要为了看起来厉害而硬补结果句。",
    "6. 如果提供了 JD，可以调整措辞、模块顺序和标题风格，让内容更贴近岗位，但不能为了匹配 JD 而虚构经历。",
    "7. 动词强度必须与证据匹配：原文只有参与、协助、支持时，不要改写成主导、牵头、独立负责。",
    "8. JD 只能帮助你调整强调顺序和措辞，不能把 JD 里的新职责直接写成候选人已经做过的事。",
    "9. 如果原文没写做过某个动作，例如复盘、策划、撰写、投放、分层，就不要因为 JD 提到这些词而补写进经历。",
    "10. 语言必须像真实求职者自己整理过的正式简历，干净、自然、可信，宁可普通一点，也不要像 AI 润色稿。",
    "11. 优先使用常见简历动词，例如 负责、协助、整理、跟进、沟通、执行、统计、分析、撰写、复盘。",
    "12. 尽量不要主动使用“赋能、抓手、打法、闭环、拉通、全链路、矩阵、颗粒度、方法论”等黑话；除非原文本来就是这种风格。",
    "13. 不要把每一句都润成同一套模板；允许保留一点朴素感，只要清楚、可信即可。",
    "14. section_rewrites 返回 3 到 6 个最值得重写的板块，每个板块都要写出原文、问题原因和优化版本。",
    "15. rewritten_resume.basics 只能保留或整理原文可确认的信息；无法确认就留空，不要猜测。",
    "16. rewritten_resume.modules 按素材多少决定，宁可少而准，也不要为了凑结构新增无依据内容；每个模块标题都要像正式简历栏目名。",
    "17. 如果原文事实不足，宁愿保守、简短，也不要补全看似漂亮但无证据支持的内容。",
    "18. 你必须严格只输出 JSON，不要输出 markdown，不要输出解释，不要输出代码块。",
    `最终输出 JSON 必须严格符合这个结构：${JSON.stringify(schemaExample)}`
  ].join("\n");

  const userPrompt = [
    `下面是用户上传的简历 PDF 文本。文件名：${filename || "resume.pdf"}`,
    "",
    "如果已经给出结构化简历，请优先在这个结构基础上重写，而不是重新发明板块。",
    "你输出的 rewritten_resume 必须可以直接被前端拿来生成一份更能投递的简历。",
    "未在原文出现的公司、时间、数字一律省略，不要使用占位编造。",
    "如果原文本身写得比较朴素，请保留这种朴素感，不要统一改成很重的职业黑话。",
    "不能把 JD 里的新动作直接补进经历里；原文没写做过复盘，就不能新增“撰写复盘”或“负责复盘”。",
    "",
    "目标 JD：",
    jdText ? jdText : "无",
    "",
    "当前结构化简历如下：",
    JSON.stringify(structuredResume || {}, null, 2),
    "",
    "原始简历文本如下：",
    resumeText
  ].join("\n");

  const result = await requestDeepSeekJson({
    systemPrompt,
    userPrompt,
    temperature: 0.08,
    maxTokens: 2200
  });
  const sectionRewrites = normalizeSectionRewrites(result.section_rewrites || result.sectionRewrites);
  const rewrittenResume = mergeStructuredResume(
    naturalizeStructuredResumeOutput(normalizeStructuredResume(result.rewritten_resume || result.rewrittenResume)),
    structuredResume || resumeFromSectionRewrites(sectionRewrites)
  );

  return {
    rewrite: {
      original: String(result?.rewrite?.original || sectionRewrites[0]?.original || "未提取到明显片段"),
      reason: naturalizeAiText(String(result?.rewrite?.reason || sectionRewrites[0]?.reason || "这段写得比较空，看不出你具体做了什么。")),
      rewritten: naturalizeAiText(String(result?.rewrite?.rewritten || sectionRewrites[0]?.rewritten || "请补充你做了什么、怎么做的，以及最后产出了什么。"))
    },
    section_rewrites: sectionRewrites,
    rewritten_resume: rewrittenResume
  };
}

const PDF_CANVAS_WIDTH = 1588;
const PDF_CANVAS_HEIGHT = 2246;
const PDF_PAGE_WIDTH_PT = 595.28;
const PDF_PAGE_HEIGHT_PT = 841.89;
const PDF_MARGIN_X = 56;
const PDF_MARGIN_TOP = 48;
const PDF_FONT_FAMILY = "\"Microsoft YaHei\", \"PingFang SC\", sans-serif";

function hexToRgb(value, fallback = { r: 54, g: 190, b: 216 }) {
  const source = String(value || "").trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(source)) return fallback;
  return {
    r: parseInt(source.slice(0, 2), 16),
    g: parseInt(source.slice(2, 4), 16),
    b: parseInt(source.slice(4, 6), 16)
  };
}

function rgbString(color, alpha = 1) {
  return alpha >= 1
    ? `rgb(${color.r}, ${color.g}, ${color.b})`
    : `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function mixRgb(base, target, ratio) {
  const mix = Math.max(0, Math.min(1, Number(ratio) || 0));
  return {
    r: Math.round(base.r + (target.r - base.r) * mix),
    g: Math.round(base.g + (target.g - base.g) * mix),
    b: Math.round(base.b + (target.b - base.b) * mix)
  };
}

function buildPdfPalette(accentHex) {
  const accent = hexToRgb(accentHex);
  return {
    accent: rgbString(accent),
    accentSoft: rgbString(mixRgb(accent, { r: 255, g: 255, b: 255 }, 0.72)),
    accentLine: rgbString(mixRgb(accent, { r: 255, g: 255, b: 255 }, 0.18)),
    accentInk: rgbString(mixRgb(accent, { r: 22, g: 100, b: 122 }, 0.22)),
    text: "#2f2f2f",
    muted: "#666666",
    lightText: "rgba(255,255,255,0.92)"
  };
}

function setCanvasFont(ctx, size, weight = 400) {
  const resolvedWeight = typeof weight === "number" ? String(weight) : weight;
  ctx.font = `${resolvedWeight} ${size}px ${PDF_FONT_FAMILY}`;
}

function sanitizePdfText(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function wrapCanvasText(ctx, text, maxWidth) {
  const safeWidth = Math.max(24, Number(maxWidth) || 24);
  const paragraphs = String(text || "").replace(/\r/g, "").split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const char of Array.from(paragraph)) {
      const next = current + char;
      if (!current || ctx.measureText(next).width <= safeWidth) {
        current = next;
        continue;
      }
      lines.push(current);
      current = char;
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

function drawWrappedText(ctx, text, x, y, maxWidth, options = {}) {
  const {
    fontSize = 26,
    lineHeight = fontSize * 1.62,
    color = "#333333",
    weight = 400,
    align = "left"
  } = options;
  setCanvasFont(ctx, fontSize, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "top";

  const lines = wrapCanvasText(ctx, sanitizePdfText(text), maxWidth);
  let currentY = y;
  for (const line of lines) {
    const drawX = align === "center" ? x + maxWidth / 2 : align === "right" ? x + maxWidth : x;
    ctx.fillText(line || " ", drawX, currentY, maxWidth);
    currentY += lineHeight;
  }
  return currentY;
}

function drawBulletList(ctx, bullets, x, y, maxWidth, options = {}) {
  const fontSize = options.fontSize || 25;
  const lineHeight = options.lineHeight || fontSize * 1.62;
  const color = options.color || "#333333";
  const bulletIndent = options.bulletIndent || 24;
  const dotX = x + 6;

  let currentY = y;
  for (const bullet of (Array.isArray(bullets) ? bullets : []).filter(Boolean)) {
    setCanvasFont(ctx, fontSize, 500);
    ctx.fillStyle = color;
    const lines = wrapCanvasText(ctx, sanitizePdfText(bullet), maxWidth - bulletIndent);
    ctx.beginPath();
    ctx.arc(dotX, currentY + fontSize * 0.72, 4, 0, Math.PI * 2);
    ctx.fill();
    currentY = drawWrappedText(ctx, lines.join("\n"), x + bulletIndent, currentY, maxWidth - bulletIndent, {
      fontSize,
      lineHeight,
      color
    });
    currentY += 6;
  }
  return currentY;
}

function deriveSectionEnglishFromTitleServer(title) {
  if (!title) return "";
  const source = String(title).trim();
  const compact = source.replace(/\s+/g, "");
  if (/^[a-z0-9 .,&/-]+$/i.test(source)) return source;

  const phraseMap = [
    [/个人信息|基本信息/, "Personal Information"],
    [/个人概述|个人简介|自我评价|自我介绍|简介/, "Profile Summary"],
    [/教育背景/, "Educational Background"],
    [/教育|学习经历/, "Education"],
    [/实习经历/, "Internship Experience"],
    [/实习|工作经历|职业经历|任职经历/, "Work Experience"],
    [/校园经历|校园实践/, "Campus Experience"],
    [/社团经历|社团实践|学生会|校园活动/, "Campus Activities"],
    [/项目经历/, "Project Experience"],
    [/项目|课题/, "Projects"],
    [/证书.*技能|技能.*证书/, "Certificates & Skills"],
    [/荣誉奖项|荣誉|奖项|获奖/, "Honors & Awards"],
    [/技能|能力|工具/, "Skills"],
    [/证书|资格/, "Certificates"],
    [/语言/, "Languages"],
    [/志愿/, "Volunteer Experience"],
    [/竞赛/, "Competitions"],
    [/科研|研究/, "Research Experience"],
    [/作品/, "Portfolio"],
    [/兴趣|爱好/, "Interests"],
    [/实践/, "Practical Experience"]
  ];
  for (const [pattern, english] of phraseMap) {
    if (pattern.test(compact)) return english;
  }

  const tokenMap = [
    ["个人", "Personal"],
    ["教育", "Education"],
    ["背景", "Background"],
    ["信息", "Information"],
    ["概述", "Summary"],
    ["简介", "Summary"],
    ["实习", "Internship"],
    ["工作", "Work"],
    ["项目", "Project"],
    ["校园", "Campus"],
    ["社团", "Campus"],
    ["活动", "Activities"],
    ["实践", "Experience"],
    ["经历", "Experience"],
    ["技能", "Skills"],
    ["能力", "Skills"],
    ["工具", "Tools"],
    ["荣誉", "Honors"],
    ["奖项", "Awards"],
    ["获奖", "Awards"],
    ["证书", "Certificates"],
    ["资格", "Certificates"],
    ["语言", "Languages"],
    ["志愿", "Volunteer"],
    ["竞赛", "Competitions"],
    ["科研", "Research"],
    ["研究", "Research"],
    ["作品", "Portfolio"],
    ["兴趣", "Interests"],
    ["爱好", "Interests"],
    ["市场", "Marketing"],
    ["运营", "Operations"],
    ["产品", "Product"],
    ["内容", "Content"],
    ["数据", "Data"],
    ["开发", "Development"],
    ["设计", "Design"],
    ["管理", "Management"],
    ["宣传", "Communications"],
    ["媒体", "Media"],
    ["财务", "Finance"],
    ["行政", "Administration"],
    ["支持", "Support"],
    ["服务", "Service"],
    ["综合", "General"],
    ["其他", "Additional"],
    ["补充", "Additional"],
    ["说明", "Notes"]
  ];

  const words = [];
  for (const [keyword, english] of tokenMap) {
    if (compact.includes(keyword) && !words.includes(english)) {
      words.push(english);
    }
  }

  if (!words.length) return "";
  if (words.length === 1) {
    if (words[0] === "Education") return "Educational Background";
    if (words[0] === "Internship") return "Internship Experience";
    if (words[0] === "Work") return "Work Experience";
    if (words[0] === "Project") return "Project Experience";
    if (words[0] === "Volunteer") return "Volunteer Experience";
    if (words[0] === "Research") return "Research Experience";
    if (words[0] === "Campus") return "Campus Experience";
    return words[0];
  }

  const nounSet = new Set(["Skills", "Certificates", "Languages", "Portfolio", "Interests", "Awards", "Honors"]);
  if (words.length === 2 && nounSet.has(words[0]) && nounSet.has(words[1])) {
    return `${words[0]} & ${words[1]}`;
  }

  const terminalWords = new Set([
    "Experience",
    "Background",
    "Summary",
    "Information",
    "Skills",
    "Awards",
    "Certificates",
    "Languages",
    "Portfolio",
    "Interests",
    "Activities",
    "Management",
    "Operations",
    "Development",
    "Communications",
    "Administration",
    "Finance",
    "Support",
    "Service",
    "Notes"
  ]);

  const normalizedWords = words.slice(0, 3);
  if (!terminalWords.has(normalizedWords.at(-1))) {
    normalizedWords.push("Section");
  }
  return normalizedWords.join(" ");
}

function getSectionEnglishServer(kind, title = "") {
  const derived = deriveSectionEnglishFromTitleServer(title);
  if (derived) return derived;
  if (kind === "summary") return "Summary";
  if (kind === "education") return "Educational Background";
  if (kind === "experience") return "Internship Experience";
  if (kind === "project") return "Project Experience";
  if (kind === "skills") return "Skills";
  if (kind === "awards") return "Honors & Awards";
  return "Custom Section";
}

function ensureSinglePageHeight(currentY) {
  if (currentY > PDF_CANVAS_HEIGHT - 64) {
    throw new Error("当前内容超出一页 A4，请先精简内容后再导出 PDF。");
  }
}

function drawReferenceRibbon(ctx, y, cnTitle, enTitle, palette) {
  const chipX = PDF_MARGIN_X;
  const chipY = y;
  const chipHeight = 58;
  const slant = 28;
  setCanvasFont(ctx, 30, 700);
  const cnWidth = ctx.measureText(cnTitle).width;
  setCanvasFont(ctx, 23, 600);
  const enWidth = ctx.measureText(enTitle).width;
  const chipWidth = Math.max(320, 30 + cnWidth + 34 + enWidth + 48);

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.moveTo(chipX, chipY);
  ctx.lineTo(chipX + chipWidth - slant, chipY);
  ctx.lineTo(chipX + chipWidth, chipY + chipHeight / 2);
  ctx.lineTo(chipX + chipWidth - slant, chipY + chipHeight);
  ctx.lineTo(chipX, chipY + chipHeight);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  setCanvasFont(ctx, 30, 700);
  ctx.fillText(cnTitle, chipX + 22, chipY + chipHeight / 2);

  const dividerX = chipX + 22 + cnWidth + 18;
  ctx.strokeStyle = "rgba(255,255,255,0.52)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(dividerX, chipY + 12);
  ctx.lineTo(dividerX, chipY + chipHeight - 12);
  ctx.stroke();

  setCanvasFont(ctx, 23, 600);
  ctx.fillText(enTitle, dividerX + 16, chipY + chipHeight / 2 + 1);

  ctx.strokeStyle = palette.accentLine;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(chipX + chipWidth + 20, chipY + chipHeight / 2 + 1);
  ctx.lineTo(PDF_CANVAS_WIDTH - PDF_MARGIN_X, chipY + chipHeight / 2 + 1);
  ctx.stroke();
  ctx.setLineDash([]);

  return chipY + chipHeight;
}

function drawReferenceInfoRow(ctx, x, y, label, value, maxWidth, palette) {
  setCanvasFont(ctx, 25, 700);
  ctx.fillStyle = palette.accentInk;
  ctx.fillRect(x, y + 14, 10, 10);
  ctx.fillText(`${label}：`, x + 20, y, maxWidth);
  const labelWidth = ctx.measureText(`${label}：`).width;
  setCanvasFont(ctx, 25, 700);
  ctx.fillStyle = palette.text;
  ctx.fillText(value || "", x + 20 + labelWidth + 8, y, Math.max(30, maxWidth - labelWidth - 28));
}

async function drawReferencePhoto(ctx, basics, x, y, width, height, palette) {
  ctx.fillStyle = palette.accentSoft;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = palette.accentLine;
  ctx.lineWidth = 14;
  ctx.strokeRect(x + 7, y + 7, width - 14, height - 14);

  if (!basics.photoUrl) return;

  try {
    const matched = String(basics.photoUrl).match(/^data:.*?;base64,(.+)$/);
    const source = matched ? Buffer.from(matched[1], "base64") : basics.photoUrl;
    const image = await loadImage(source);
    const scale = Math.max(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    ctx.strokeStyle = palette.accentLine;
    ctx.lineWidth = 14;
    ctx.strokeRect(x + 7, y + 7, width - 14, height - 14);
  } catch {
    // keep placeholder if image parsing fails
  }
}

async function renderResumeCanvas(resumeDocument) {
  const document = normalizeGeneratorResumeDocument(resumeDocument);
  const accent = document.theme.accentMode === "custom" && document.theme.accentColor
    ? document.theme.accentColor
    : "#36bed8";
  const palette = buildPdfPalette(accent);
  const canvas = createCanvas(PDF_CANVAS_WIDTH, PDF_CANVAS_HEIGHT);
  const ctx = canvas.getContext("2d");
  const basics = document.basics || {};
  const sections = (Array.isArray(document.sections) ? document.sections : []).filter((section) => section.visible !== false);
  let y = PDF_MARGIN_TOP;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PDF_CANVAS_WIDTH, PDF_CANVAS_HEIGHT);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  setCanvasFont(ctx, 60, 800);
  ctx.fillStyle = "#2a2a2a";
  ctx.fillText("个人简历", PDF_MARGIN_X, y);

  setCanvasFont(ctx, 28, 700);
  ctx.fillStyle = palette.text;
  const targetPrefix = "求职意向：";
  const targetPrefixWidth = ctx.measureText(targetPrefix).width;
  const targetX = PDF_MARGIN_X + 220;
  ctx.fillText(targetPrefix, targetX, y + 12);
  setCanvasFont(ctx, 28, 800);
  ctx.fillText(sanitizePdfText(basics.targetRole), targetX + targetPrefixWidth + 10, y + 12);

  setCanvasFont(ctx, 34, 800);
  ctx.textAlign = "right";
  ctx.fillText("PERSONAL RESUME", PDF_CANVAS_WIDTH - PDF_MARGIN_X, y + 6);
  ctx.textAlign = "left";
  y += 86;

  y = drawReferenceRibbon(ctx, y, "个人信息", "Personal Information", palette) + 18;
  const photoWidth = 312;
  const photoHeight = 408;
  const photoGap = 32;
  const infoWidth = PDF_CANVAS_WIDTH - PDF_MARGIN_X * 2 - photoWidth - photoGap;
  const columnGap = 40;
  const columnWidth = (infoWidth - columnGap) / 2;
  const infoPairs = [
    ["姓名", basics.name],
    ["城市", basics.city],
    ["性别", basics.gender],
    ["学校", basics.school],
    ["手机号", basics.phone],
    ["邮箱", basics.email],
    ["专业", basics.major],
    ["学历", basics.degree]
  ];
  infoPairs.forEach((pair, index) => {
    const row = Math.floor(index / 2);
    const column = index % 2;
    drawReferenceInfoRow(
      ctx,
      PDF_MARGIN_X + column * (columnWidth + columnGap),
      y + row * 56,
      pair[0],
      sanitizePdfText(pair[1]),
      columnWidth,
      palette
    );
  });
  await drawReferencePhoto(ctx, basics, PDF_CANVAS_WIDTH - PDF_MARGIN_X - photoWidth, y - 2, photoWidth, photoHeight, palette);
  y += Math.max(4 * 56, photoHeight) + 26;

  for (const section of sections) {
    const cnTitle = sanitizePdfText(section.title || "");
    const enTitle = getSectionEnglishServer(section.kind, cnTitle || defaultGeneratorSectionTitle(section.kind));
    y = drawReferenceRibbon(ctx, y, cnTitle || defaultGeneratorSectionTitle(section.kind), enTitle, palette) + 18;

    if (section.kind === "summary" || section.kind === "skills" || section.kind === "custom") {
      y = drawWrappedText(ctx, section.items?.[0]?.text || "", PDF_MARGIN_X, y, PDF_CANVAS_WIDTH - PDF_MARGIN_X * 2, {
        fontSize: 26,
        lineHeight: 42,
        color: palette.text,
        weight: 500
      });
      y += 18;
      ensureSinglePageHeight(y);
      continue;
    }

    if (section.kind === "awards") {
      y = drawBulletList(ctx, (section.items || []).map((item) => item.text), PDF_MARGIN_X, y, PDF_CANVAS_WIDTH - PDF_MARGIN_X * 2, {
        fontSize: 25,
        lineHeight: 40,
        color: palette.text
      });
      y += 12;
      ensureSinglePageHeight(y);
      continue;
    }

    if (section.kind === "education") {
      for (const item of section.items || []) {
        setCanvasFont(ctx, 28, 700);
        ctx.fillStyle = palette.text;
        ctx.textAlign = "left";
        ctx.fillText(sanitizePdfText(item.time), PDF_MARGIN_X, y, 340);
        ctx.textAlign = "center";
        ctx.fillText(sanitizePdfText(basics.school), PDF_MARGIN_X + 530, y, 460);
        ctx.textAlign = "right";
        ctx.fillText(sanitizePdfText(basics.major), PDF_CANVAS_WIDTH - PDF_MARGIN_X, y, 320);
        setCanvasFont(ctx, 22, 700);
        ctx.fillStyle = palette.muted;
        ctx.fillText(sanitizePdfText(basics.degree), PDF_CANVAS_WIDTH - PDF_MARGIN_X, y + 32, 320);
        ctx.textAlign = "left";
        y = drawWrappedText(ctx, item.text || "", PDF_MARGIN_X, y + 56, PDF_CANVAS_WIDTH - PDF_MARGIN_X * 2, {
          fontSize: 24,
          lineHeight: 38,
          color: palette.text
        });
        y += 16;
      }
      ensureSinglePageHeight(y);
      continue;
    }

    if (section.kind === "experience" || section.kind === "project") {
      for (const item of section.items || []) {
        const primary = section.kind === "experience" ? item.company : item.projectName;
        setCanvasFont(ctx, 28, 700);
        ctx.fillStyle = palette.text;
        ctx.textAlign = "left";
        ctx.fillText(sanitizePdfText(item.time), PDF_MARGIN_X, y, 320);
        ctx.textAlign = "center";
        ctx.fillText(sanitizePdfText(primary), PDF_MARGIN_X + 518, y, 520);
        ctx.textAlign = "right";
        ctx.fillText(sanitizePdfText(item.role), PDF_CANVAS_WIDTH - PDF_MARGIN_X, y, 320);
        ctx.textAlign = "left";
        y = drawWrappedText(ctx, item.summary || "", PDF_MARGIN_X, y + 48, PDF_CANVAS_WIDTH - PDF_MARGIN_X * 2, {
          fontSize: 24,
          lineHeight: 38,
          color: palette.text
        });
        y += 10;
        y = drawBulletList(ctx, item.bullets, PDF_MARGIN_X + 4, y, PDF_CANVAS_WIDTH - PDF_MARGIN_X * 2 - 4, {
          fontSize: 24,
          lineHeight: 38,
          color: palette.text,
          bulletIndent: 24
        });
        y += 10;
      }
      ensureSinglePageHeight(y);
    }
  }

  return canvas.toBuffer("image/png");
}

async function generateResumePdf(resumeDocument) {
  const pngBuffer = await renderResumeCanvas(resumeDocument);
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PDF_PAGE_WIDTH_PT, PDF_PAGE_HEIGHT_PT]);
  const image = await pdfDoc.embedPng(pngBuffer);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: PDF_PAGE_WIDTH_PT,
    height: PDF_PAGE_HEIGHT_PT
  });
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && requestUrl.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      ok: true,
      service: "resume-roaster",
      hasAiKey: Boolean(deepseekApiKey)
    }));
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/generator/optimize") {
    try {
      const payload = await readJsonBody(req);
      const resumeDocument = normalizeGeneratorResumeDocument(payload?.resumeDocument);
      const jdText = normalizeWhitespace(String(payload?.jdText || ""));
      const scope = payload?.scope === "section" ? "section" : "all";
      const sectionId = normalizeString(payload?.sectionId);
      const goal = payload?.goal === "compress" ? "compress" : "general";

      if (!resumeDocument) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "缺少有效的 resumeDocument。" }));
        return;
      }

      if (scope === "section" && !sectionId) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "缺少当前 sectionId。" }));
        return;
      }

      const result = await optimizeResumeDocumentWithDeepSeek(resumeDocument, {
        jdText,
        scope,
        sectionId,
        goal
      });

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(result));
      return;
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/export/pdf") {
    try {
      const payload = await readJsonBody(req);
      const resumeDocument = normalizeGeneratorResumeDocument(payload?.resumeDocument || payload?.draft);

      if (!resumeDocument || typeof resumeDocument !== "object") {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Missing resumeDocument payload");
        return;
      }

      const pdf = await generateResumePdf(resumeDocument);
      const filename = encodeURIComponent(`${resumeDocument.basics?.name || "resume"}.pdf`);

      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Cache-Control": "no-store"
      });
      res.end(pdf);
      return;
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`PDF export failed: ${error.message}`);
      return;
    }
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/review-resume") {
    try {
      const payload = await readJsonBody(req);
      const filename = String(payload?.filename || "resume.pdf");
      const fileBase64 = String(payload?.fileBase64 || "");
      const jdText = normalizeWhitespace(String(payload?.jdText || ""));

      if (!fileBase64) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "缺少 PDF 文件内容。" }));
        return;
      }

      const resumeText = await extractResumeTextFromPdf(fileBase64);
      const review = await reviewResumeWithDeepSeek(resumeText, filename, jdText);

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify({ review, resumeText }));
      return;
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/rewrite-resume") {
    try {
      const payload = await readJsonBody(req);
      const filename = String(payload?.filename || "resume.pdf");
      const resumeText = normalizeWhitespace(String(payload?.resumeText || ""));
      const jdText = normalizeWhitespace(String(payload?.jdText || ""));
      const structuredResume = normalizeStructuredResume(payload?.structuredResume || payload?.structured_resume);

      if (!resumeText) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "缺少可用于重写的简历文本。" }));
        return;
      }

      const rewriteResult = await rewriteResumeWithDeepSeek(resumeText, filename, structuredResume, jdText);

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify({ rewriteResult }));
      return;
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
      return;
    }
  }

  const requestPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  if (!publicStaticFiles.has(requestPath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const filePath = path.join(root, requestPath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    sendFile(filePath, res);
  });
});

server.listen(port, () => {
  console.log(`Demo server running at http://localhost:${port}`);
});
