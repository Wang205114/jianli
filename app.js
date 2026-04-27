const sampleJD = `职位：用户增长运营

岗位职责：
1. 负责拉新、留存、转化等增长链路策略设计与落地；
2. 能结合数据分析定位问题并推动跨团队协作；
3. 负责活动策划、用户分层、渠道转化效率优化。

任职要求：
1. 1-3年互联网增长/运营经验；
2. 具备较强的数据分析能力，能独立拆解核心指标；
3. 有活动增长、用户运营、渠道投放协同经验优先；
4. 结果导向强，表达清晰。`;

const STORAGE_KEY = "resume-generator-v1";
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

const TEMPLATE_CONFIGS = {
  "ref-01": {
    id: "ref-01",
    name: "模板1青蓝",
    layout: "reference-sheet",
    slots: {
      sidebar: ["summary", "skills"],
      main: ["education", "experience", "project", "awards", "custom"]
    },
      defaults: {
        accent: "#36bed8",
        fontScale: 1,
        sectionStyle: "bar"
      }
  }
};

const SECTION_CATALOG = [
  { kind: "summary", label: "个人概述", singleton: true },
  { kind: "education", label: "教育背景", singleton: true },
  { kind: "experience", label: "实习经历", singleton: true },
  { kind: "project", label: "项目经历", singleton: true },
  { kind: "skills", label: "个人技能", singleton: true },
  { kind: "awards", label: "荣誉奖项", singleton: true },
  { kind: "custom", label: "自定义模块", singleton: false }
];

let sectionSeed = 1;
let autosaveTimer = 0;
let previewMeasureTimer = 0;

const workspaceTabs = document.querySelector("#workspaceTabs");
const generatorPanel = document.querySelector("#generatorPanel");
const reviewPanel = document.querySelector("#reviewPanel");

const autosaveStatus = document.querySelector("#autosaveStatus");
const fillGeneratorSample = document.querySelector("#fillGeneratorSample");
const exportPdfButton = document.querySelector("#exportPdfButton");
const resetGeneratorButton = document.querySelector("#resetGeneratorButton");
const optimizeProfileButton = document.querySelector("#optimizeProfileButton");
const optimizeCurrentSectionButton = document.querySelector("#optimizeCurrentSectionButton");
const compressToOnePageButton = document.querySelector("#compressToOnePageButton");
const applyAiDiffButton = document.querySelector("#applyAiDiffButton");
const aiCompareTitle = document.querySelector("#aiCompareTitle");
const aiCompareText = document.querySelector("#aiCompareText");
const aiDiffList = document.querySelector("#aiDiffList");
const activeSectionHint = document.querySelector("#activeSectionHint");
const themeColorSelect = document.querySelector("#themeColorSelect");
const fontScaleSelect = document.querySelector("#fontScaleSelect");
const templateNameValue = document.querySelector("#templateNameValue");
const structuredEditor = document.querySelector("#structuredEditor");
const sectionToolbar = document.querySelector("#sectionToolbar");
const resumePreviewStage = document.querySelector("#resumePreviewStage");
const resumePreviewViewport = document.querySelector("#resumePreviewViewport");
const resumePreview = document.querySelector("#resumePreview");
const pageStatusBox = document.querySelector("#pageStatusBox");
const pageStatusTitle = document.querySelector("#pageStatusTitle");
const pageStatusText = document.querySelector("#pageStatusText");

const profileNameInput = document.querySelector("#profileNameInput");
const profileTargetRoleInput = document.querySelector("#profileTargetRoleInput");
const profileGenderInput = document.querySelector("#profileGenderInput");
const profileCityInput = document.querySelector("#profileCityInput");
const profilePhoneInput = document.querySelector("#profilePhoneInput");
const profileEmailInput = document.querySelector("#profileEmailInput");
const profileSchoolInput = document.querySelector("#profileSchoolInput");
const profileMajorInput = document.querySelector("#profileMajorInput");
const profileDegreeInput = document.querySelector("#profileDegreeInput");
const profilePhotoInput = document.querySelector("#profilePhotoInput");
const profilePhotoPreview = document.querySelector("#profilePhotoPreview");
const photoEmptyHint = document.querySelector("#photoEmptyHint");

const fillReviewJdButton = document.querySelector("#fillReviewJdButton");
const resumeFile = document.querySelector("#resumeFile");
const fileHint = document.querySelector("#fileHint");
const reviewJdInput = document.querySelector("#reviewJdInput");
const analyzePdfButton = document.querySelector("#analyzePdfButton");
const reviewStatusText = document.querySelector("#reviewStatusText");
const emptyOptimization = document.querySelector("#emptyOptimization");
const optimizationContent = document.querySelector("#optimizationContent");
const overallScoreValue = document.querySelector("#overallScoreValue");
const oneLineRoastText = document.querySelector("#oneLineRoastText");
const strengthHighlightsList = document.querySelector("#strengthHighlightsList");
const rewriteCompareList = document.querySelector("#rewriteCompareList");
const missingKeywordsList = document.querySelector("#missingKeywordsList");
const riskFlagsList = document.querySelector("#riskFlagsList");
const interviewQuestionList = document.querySelector("#interviewQuestionList");
const rewriteResumeSummary = document.querySelector("#rewriteResumeSummary");
const rewriteResumeModules = document.querySelector("#rewriteResumeModules");

const state = {
  activePanel: "generatorPanel",
  resumeDocument: loadResumeDocument(),
  activeSectionId: null,
  pendingOptimization: null,
  lastAppliedSnapshot: null,
  generatorAiSummary: null,
  pageStatus: { overflowing: false, overflowPx: 0 },
  reviewOptimization: null,
  reviewRewrite: null
};

hydrateSectionSeed(state.resumeDocument);
state.activeSectionId = state.resumeDocument.sections[0]?.id || null;

bindWorkspaceEvents();
bindGeneratorEvents();
bindReviewEvents();
renderApp();
renderOptimizationEmpty();

function bindWorkspaceEvents() {
  workspaceTabs?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-panel]");
    if (!button) return;
    switchWorkspace(button.dataset.panel);
  });
}

function bindGeneratorEvents() {
  fillGeneratorSample?.addEventListener("click", () => {
    state.pendingOptimization = null;
    state.lastAppliedSnapshot = null;
    state.generatorAiSummary = {
      title: "已填入示例简历",
      text: "示例会保留学校、专业、学历在基本信息里，教育模块默认仍然不出现。"
    };
    state.resumeDocument = createSampleResumeDocument();
    hydrateSectionSeed(state.resumeDocument);
    state.activeSectionId = state.resumeDocument.sections[0]?.id || null;
    persistAndRender("sample");
  });

  exportPdfButton?.addEventListener("click", async () => {
    if (!state.resumeDocument.basics.name.trim()) {
      window.alert("先补全姓名，再导出 PDF。");
      return;
    }
    if (state.pageStatus.overflowing) {
      window.alert("当前内容已经超出一页 A4，请先压缩内容或调整字号。");
      return;
    }

    exportPdfButton.disabled = true;
    const previousLabel = exportPdfButton.textContent;
    exportPdfButton.textContent = "准备 PDF...";

    try {
      await exportResumeAsPdf();
    } catch (error) {
      console.error(error);
      window.alert("PDF 导出失败了。请确认本地服务已启动，并稍后再试。");
    } finally {
      exportPdfButton.disabled = !state.resumeDocument.basics.name.trim();
      exportPdfButton.textContent = previousLabel;
    }
  });

  optimizeProfileButton?.addEventListener("click", async () => {
    await requestOptimization({ scope: "all", goal: "general" });
  });

  optimizeCurrentSectionButton?.addEventListener("click", async () => {
    const activeSection = getActiveSection();
    if (!activeSection) {
      window.alert("先在左侧或右侧选中一个模块，再继续优化当前模块。");
      return;
    }
    await requestOptimization({ scope: "section", sectionId: activeSection.id, goal: "general" });
  });

  compressToOnePageButton?.addEventListener("click", async () => {
    await requestOptimization({ scope: "all", goal: "compress" });
  });

  applyAiDiffButton?.addEventListener("click", () => {
    applyPendingOptimization();
  });

  resetGeneratorButton?.addEventListener("click", () => {
    if (state.lastAppliedSnapshot) {
      state.resumeDocument = cloneResumeDocument(state.lastAppliedSnapshot);
      state.lastAppliedSnapshot = null;
      state.pendingOptimization = null;
      state.generatorAiSummary = {
        title: "已恢复原版",
        text: "已恢复到应用 AI 优化之前的版本。"
      };
      hydrateSectionSeed(state.resumeDocument);
      state.activeSectionId = state.resumeDocument.sections.find((section) => section.id === state.activeSectionId)?.id || state.resumeDocument.sections[0]?.id || null;
      persistAndRender("restore");
      return;
    }
    if (state.pendingOptimization) {
      state.pendingOptimization = null;
      state.generatorAiSummary = {
        title: "已取消本次建议",
        text: "当前简历没有被覆盖，你可以继续手动编辑，或重新发起一次优化。"
      };
      renderGenerator();
      return;
    }
  });

  wireBasicInput(profileNameInput, "name");
  wireBasicInput(profileTargetRoleInput, "targetRole");
  wireBasicInput(profileGenderInput, "gender");
  wireBasicInput(profileCityInput, "city");
  wireBasicInput(profilePhoneInput, "phone");
  wireBasicInput(profileEmailInput, "email");
  wireBasicInput(profileSchoolInput, "school");
  wireBasicInput(profileMajorInput, "major");
  wireBasicInput(profileDegreeInput, "degree");

  profilePhotoInput?.addEventListener("change", async () => {
    const file = profilePhotoInput.files?.[0];
    if (!file) {
      mutateResumeDocument((document) => {
        document.basics.photoUrl = "";
      }, "manual");
      return;
    }
    const photoUrl = await fileToDataUrl(file);
    mutateResumeDocument((document) => {
      document.basics.photoUrl = photoUrl;
    }, "manual");
  });

  themeColorSelect?.addEventListener("change", () => {
    mutateResumeDocument((document) => {
      if (themeColorSelect.value === "template") {
        document.theme.accentMode = "template";
        document.theme.accentColor = "";
      } else {
        document.theme.accentMode = "custom";
        document.theme.accentColor = themeColorSelect.value;
      }
    }, "manual");
  });

  fontScaleSelect?.addEventListener("change", () => {
    mutateResumeDocument((document) => {
      document.theme.fontScale = Number(fontScaleSelect.value) || 1;
    }, "manual");
  });

  structuredEditor?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-section-id]");
    if (card?.dataset.sectionId) {
      state.activeSectionId = card.dataset.sectionId;
      renderAiWorkbench();
      highlightPreviewSelection();
      highlightSectionCard();
    }

    const action = event.target.closest("[data-section-action]");
    if (!action) return;

    const sectionId = action.dataset.sectionId;
    const itemIndex = toNumber(action.dataset.itemIndex, -1);
    const bulletIndex = toNumber(action.dataset.bulletIndex, -1);
    const command = action.dataset.sectionAction;

    if (command === "add-section") {
      addSection(action.dataset.kind);
      return;
    }

    if (command === "delete-section") {
      removeSection(sectionId);
      return;
    }

    if (command === "move-up" || command === "move-down") {
      moveSection(sectionId, command === "move-up" ? -1 : 1);
      return;
    }

    if (command === "toggle-visible") {
      mutateSection(sectionId, (section) => {
        section.visible = !section.visible;
      }, "manual");
      return;
    }

    if (command === "add-item") {
      addSectionItem(sectionId);
      return;
    }

    if (command === "remove-item") {
      removeSectionItem(sectionId, itemIndex);
      return;
    }

    if (command === "add-bullet") {
      addBullet(sectionId, itemIndex);
      return;
    }

    if (command === "remove-bullet") {
      removeBullet(sectionId, itemIndex, bulletIndex);
    }
  });

  structuredEditor?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (event.isComposing || target.dataset.composing === "true") return;
    commitStructuredEditorInput(target, "editor-input");
  });

  structuredEditor?.addEventListener("compositionstart", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    target.dataset.composing = "true";
  });

  structuredEditor?.addEventListener("compositionend", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    target.dataset.composing = "false";
    commitStructuredEditorInput(target, "editor-input");
  });

  structuredEditor?.addEventListener("change", (event) => {
    const target = event.target;
    const sectionId = target.dataset.sectionId;
    if (!sectionId) return;

    if (target.dataset.sectionField === "visible") {
      mutateSection(sectionId, (section) => {
        section.visible = target.checked;
      }, "manual");
      return;
    }

    if (target.matches("input, textarea")) {
      commitStructuredEditorInput(target, "editor-input");
      renderStructuredEditor();
    }
  });

  structuredEditor?.addEventListener("toggle", (event) => {
    const details = event.target;
    if (!details.matches(".section-card")) return;
    const sectionId = details.dataset.sectionId;
    if (!sectionId) return;
    mutateSection(sectionId, (section) => {
      section.collapsed = !details.open;
    }, "silent");
  });

  sectionToolbar?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-section-action='add-section']");
    if (!action) return;
    addSection(action.dataset.kind);
  });

  resumePreview?.addEventListener("click", (event) => {
    const sectionNode = event.target.closest("[data-section-id]");
    if (sectionNode?.dataset.sectionId) {
      state.activeSectionId = sectionNode.dataset.sectionId;
      renderAiWorkbench();
      highlightPreviewSelection();
      highlightSectionCard();
    }
  });

  resumePreview?.addEventListener("keydown", (event) => {
    const editable = event.target.closest("[data-bind]");
    if (!editable) return;
    const multiline = editable.dataset.multiline === "true";
    if (event.key === "Enter" && !(multiline && event.shiftKey)) {
      event.preventDefault();
      editable.blur();
    }
  });

  resumePreview?.addEventListener("paste", (event) => {
    const editable = event.target.closest("[data-bind]");
    if (!editable) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text);
  });

  resumePreview?.addEventListener("blur", (event) => {
    const editable = event.target.closest("[data-bind]");
    if (!editable) return;
    const bindPath = editable.dataset.bind;
    if (!bindPath) return;
    writeBindValue(bindPath, normalizePreviewText(editable.innerText || ""));
  }, true);

  window.addEventListener("resize", () => {
    updatePreviewViewportScale();
    measurePreviewOverflow();
  });
}

function bindReviewEvents() {
  fillReviewJdButton?.addEventListener("click", () => {
    reviewJdInput.value = sampleJD;
  });

  resumeFile?.addEventListener("change", () => {
    const file = resumeFile.files?.[0];
    if (!file) {
      if (fileHint) fileHint.textContent = "建议上传可复制文字的 PDF，系统会自动读取正文后再做分析。";
      return;
    }
    if (fileHint) fileHint.textContent = `已收到文件：${file.name}。点击“开始分析”即可读取 PDF 并生成专业诊断。`;
  });

  analyzePdfButton?.addEventListener("click", async () => {
    const file = resumeFile.files?.[0];
    const jdText = reviewJdInput.value.trim();
    if (!file) {
      window.alert("先上传一份 PDF 简历，再开始分析。");
      return;
    }

    analyzePdfButton.disabled = true;
    analyzePdfButton.textContent = "正在分析...";
    state.reviewRewrite = null;
    renderReviewRewriteResult(null);
    if (reviewStatusText) {
      reviewStatusText.textContent = "AI 正在读取 PDF、抽取正文，并准备诊断与改写建议。";
    }
    if (fileHint) {
      fileHint.textContent = `正在分析 ${file.name}，请稍等。`;
    }

    try {
      const result = await reviewPdfResume(file, jdText);
      state.reviewOptimization = normalizeOptimizationResult(result.review || result);
      renderOptimizationResult(state.reviewOptimization);
      renderStructuredOptimizationDecorations(state.reviewOptimization);

      if (reviewStatusText) {
        reviewStatusText.textContent = "诊断完成，正在生成整份重写草案。";
      }

      try {
        const rewritePayload = await rewriteResumeText({
          filename: file.name,
          resumeText: result.resumeText || "",
          jdText
        });
        state.reviewRewrite = normalizeRewriteResult(rewritePayload.rewriteResult || rewritePayload);
        renderReviewRewriteResult(state.reviewRewrite);
        renderStructuredRewriteDecorations(state.reviewRewrite);
        if (reviewStatusText) {
          reviewStatusText.textContent = "诊断与整份重写都已完成。你现在可以对照查看并选择采纳。";
        }
        if (fileHint) {
          fileHint.textContent = `分析完成：${file.name}。诊断结果和整份重写草案都已准备好。`;
        }
      } catch (rewriteError) {
        console.error(rewriteError);
        state.reviewRewrite = null;
        renderReviewRewriteResult(null);
        if (reviewStatusText) {
          reviewStatusText.textContent = "诊断已完成，但整份重写暂时失败，请稍后重试。";
        }
        if (fileHint) {
          fileHint.textContent = `分析完成：${file.name}。诊断可用，但整份重写暂时不可用。`;
        }
      }
    } catch (error) {
      console.error(error);
      state.reviewOptimization = null;
      renderOptimizationEmpty();
      state.reviewRewrite = null;
      renderReviewRewriteResult(null);
      if (reviewStatusText) {
        reviewStatusText.textContent = "分析暂时失败，请稍后重试。";
      }
      if (fileHint) {
        fileHint.textContent = `分析失败：${file.name}。请确认 PDF 可复制文字，或稍后重试。`;
      }
      window.alert("分析暂时失败，请稍后重试。");
    } finally {
      analyzePdfButton.disabled = false;
      analyzePdfButton.textContent = "开始分析";
    }
  });

  rewriteCompareList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-optimized]");
    if (!button) return;
    try {
      await copyToClipboard(button.dataset.copyOptimized || "");
      const label = button.textContent;
      button.textContent = "已复制";
      window.setTimeout(() => {
        button.textContent = label;
      }, 1200);
    } catch (error) {
      console.error(error);
      window.alert("复制失败了，请手动复制这段优化版。");
    }
  });
}

function wireBasicInput(element, field) {
  if (!element) return;
  element.dataset.composing = "false";
  element.addEventListener("input", () => {
    if (element.dataset.composing === "true") return;
    commitBasicInput(element, field);
  });
  element.addEventListener("compositionstart", () => {
    element.dataset.composing = "true";
  });
  element.addEventListener("compositionend", () => {
    element.dataset.composing = "false";
    commitBasicInput(element, field);
  });
  element.addEventListener("blur", () => {
    if (element.dataset.composing === "true") return;
    commitBasicInput(element, field);
  });
}

function commitBasicInput(element, field) {
  if (!element) return;
  if ((state.resumeDocument.basics[field] || "") === element.value) return;
  mutateResumeDocument((document) => {
    document.basics[field] = element.value;
  }, "manual");
}

function commitStructuredEditorInput(target, origin = "editor-input") {
  const sectionId = target?.dataset?.sectionId;
  if (!sectionId) return;

  state.activeSectionId = sectionId;

  if (target.dataset.sectionField) {
    const field = target.dataset.sectionField;
    mutateSection(sectionId, (section) => {
      section[field] = target.value;
    }, origin);
    return;
  }

  if (target.dataset.itemField) {
    const field = target.dataset.itemField;
    const itemIndex = toNumber(target.dataset.itemIndex, 0);
    mutateSection(sectionId, (section) => {
      const item = ensureSectionItem(section, itemIndex);
      item[field] = target.value;
    }, origin);
    return;
  }

  if (target.dataset.bulletIndex) {
    const itemIndex = toNumber(target.dataset.itemIndex, 0);
    const bulletIndex = toNumber(target.dataset.bulletIndex, 0);
    mutateSection(sectionId, (section) => {
      const item = ensureSectionItem(section, itemIndex);
      item.bullets = normalizeBullets(item.bullets);
      item.bullets[bulletIndex] = target.value;
    }, origin);
  }
}

function syncControlValue(element, value) {
  if (!element) return;
  if (document.activeElement === element || element.dataset.composing === "true") return;
  const nextValue = value || "";
  if (element.value !== nextValue) {
    element.value = nextValue;
  }
}

function syncSelectValue(element, value) {
  if (!element) return;
  if (document.activeElement === element) return;
  if (element.value !== value) {
    element.value = value;
  }
}

function switchWorkspace(panelId) {
  state.activePanel = panelId;
  generatorPanel?.classList.toggle("hidden", panelId !== "generatorPanel");
  reviewPanel?.classList.toggle("hidden", panelId !== "reviewPanel");
  workspaceTabs?.querySelectorAll("[data-panel]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.panel === panelId);
  });
}

function renderApp() {
  switchWorkspace(state.activePanel);
  renderGenerator();
}

function renderGenerator() {
  populateGeneratorInputs();
  renderTemplateMeta();
  renderSectionToolbar();
  renderStructuredEditor();
  renderAiWorkbench();
  renderResumePreview();
  renderAutosaveStatus();
}

function renderTemplateMeta() {
  if (!templateNameValue) return;
  const template = getTemplateConfig(state.resumeDocument.theme.templateId);
  templateNameValue.textContent = template.name || "模板1青蓝";
}

function populateGeneratorInputs() {
  const basics = state.resumeDocument.basics;
  syncControlValue(profileNameInput, basics.name || "");
  syncControlValue(profileTargetRoleInput, basics.targetRole || "");
  syncControlValue(profileGenderInput, basics.gender || "");
  syncControlValue(profileCityInput, basics.city || "");
  syncControlValue(profilePhoneInput, basics.phone || "");
  syncControlValue(profileEmailInput, basics.email || "");
  syncControlValue(profileSchoolInput, basics.school || "");
  syncControlValue(profileMajorInput, basics.major || "");
  syncControlValue(profileDegreeInput, basics.degree || "");
  syncSelectValue(themeColorSelect, state.resumeDocument.theme.accentMode === "template" ? "template" : state.resumeDocument.theme.accentColor || "template");
  syncSelectValue(fontScaleSelect, String(state.resumeDocument.theme.fontScale || 1));
  renderPhotoPreview(basics.photoUrl || "");
}

function renderPhotoPreview(photoUrl) {
  const hasPhoto = Boolean(photoUrl);
  profilePhotoPreview?.classList.toggle("hidden", !hasPhoto);
  photoEmptyHint?.classList.toggle("hidden", hasPhoto);
  if (hasPhoto && profilePhotoPreview) {
    profilePhotoPreview.src = photoUrl;
  }
}

function renderSectionToolbar() {
  if (!sectionToolbar) return;
  const buttons = SECTION_CATALOG.filter((entry) => canAddSectionKind(entry.kind)).map((entry) => `
    <button type="button" class="mini-button" data-section-action="add-section" data-kind="${entry.kind}">
      + ${escapeHtml(entry.label)}
    </button>
  `);

  sectionToolbar.innerHTML = buttons.length
    ? buttons.join("")
    : `<div class="structured-empty">当前推荐模块已经齐了，仍然可以继续添加自定义模块。</div>`;
}

function renderStructuredEditor() {
  if (!structuredEditor) return;
  const sections = state.resumeDocument.sections;
  if (!sections.length) {
    structuredEditor.innerHTML = `
      <div class="structured-empty">
        当前还没有模块，先点上面的按钮添加内容。
      </div>
    `;
    return;
  }

  structuredEditor.innerHTML = sections.map((section, index) => renderSectionCard(section, index)).join("");
  highlightSectionCard();
}

function renderSectionCard(section, index) {
  const openAttr = section.collapsed ? "" : "open";
  const activeClass = section.id === state.activeSectionId ? " is-active" : "";
  return `
    <details class="section-card${activeClass}" data-section-id="${section.id}" ${openAttr}>
      <summary class="section-card__summary">
        <div>
          <strong>${escapeHtml(section.title || getSectionTitle(section.kind))}</strong>
          <span>${escapeHtml(getSectionCardHint(section))}</span>
        </div>
        <div class="section-card__summary-meta">
          <span class="section-card__badge">${escapeHtml(getSectionLabel(section.kind))}</span>
          <span class="module-list__type">${index + 1}</span>
        </div>
      </summary>
      <div class="section-card__body">
        <div class="editor-grid">
          <label class="field">
            <span>模块标题</span>
            <input type="text" value="${escapeAttribute(section.title || "")}" data-section-id="${section.id}" data-section-field="title" placeholder="${escapeAttribute(getSectionTitle(section.kind))}" />
          </label>
          <label class="module-form__switch">
            <input type="checkbox" ${section.visible !== false ? "checked" : ""} data-section-id="${section.id}" data-section-field="visible" />
            <span>在简历里显示</span>
          </label>
        </div>

        ${renderSectionEditor(section)}

        <div class="section-card__actions">
          <button type="button" class="ghost-button" data-section-action="move-up" data-section-id="${section.id}">上移</button>
          <button type="button" class="ghost-button" data-section-action="move-down" data-section-id="${section.id}">下移</button>
          <button type="button" class="ghost-button" data-section-action="toggle-visible" data-section-id="${section.id}">
            ${section.visible !== false ? "隐藏" : "显示"}
          </button>
          <button type="button" class="ghost-button" data-section-action="delete-section" data-section-id="${section.id}">删除</button>
        </div>
      </div>
    </details>
  `;
}

function renderSectionEditor(section) {
  if (section.kind === "summary") {
    return `
      <label class="field">
        <span>正文</span>
        <textarea class="editor-textarea editor-textarea--card" data-section-id="${section.id}" data-item-index="0" data-item-field="text" placeholder="用 2-3 句讲清你的方向、经验和目标岗位。">${escapeHtml(section.items[0]?.text || "")}</textarea>
      </label>
    `;
  }

  if (section.kind === "skills") {
    return `
      <label class="field">
        <span>技能 / 标签</span>
        <textarea class="editor-textarea editor-textarea--card" data-section-id="${section.id}" data-item-index="0" data-item-field="text" placeholder="例如：SQL / Excel / 用户增长 / 数据分析 / 英语六级">${escapeHtml(section.items[0]?.text || "")}</textarea>
      </label>
    `;
  }

  if (section.kind === "custom") {
    return `
      <label class="field">
        <span>正文</span>
        <textarea class="editor-textarea editor-textarea--card" data-section-id="${section.id}" data-item-index="0" data-item-field="text" placeholder="可以写语言能力、作品链接、社团经历、个人网站等内容。">${escapeHtml(section.items[0]?.text || "")}</textarea>
      </label>
    `;
  }

  const items = section.items.map((item, index) => renderSectionItemEditor(section, item, index)).join("");
  const addLabel = section.kind === "education" ? "添加教育条目" : section.kind === "awards" ? "添加奖项条目" : "添加条目";

  return `
    <div class="section-item-list">
      ${items}
    </div>
    <button type="button" class="mini-button" data-section-action="add-item" data-section-id="${section.id}">${escapeHtml(addLabel)}</button>
  `;
}

function renderSectionItemEditor(section, item, index) {
  if (section.kind === "education") {
    return `
      <div class="section-item-card" data-section-id="${section.id}">
        <div class="section-item-card__head">
          <strong>教育条目 ${index + 1}</strong>
          <button type="button" class="mini-button" data-section-action="remove-item" data-section-id="${section.id}" data-item-index="${index}">删除条目</button>
        </div>
        <div class="editor-grid">
          <label class="field">
            <span>时间</span>
            <input type="text" value="${escapeAttribute(item.time || "")}" data-section-id="${section.id}" data-item-index="${index}" data-item-field="time" placeholder="例如：2020.09 - 2024.06" />
          </label>
        </div>
        <label class="field">
          <span>补充描述</span>
          <textarea class="editor-textarea editor-textarea--card" data-section-id="${section.id}" data-item-index="${index}" data-item-field="text" placeholder="例如：GPA、主修课程、研究方向、交换经历、奖学金。">${escapeHtml(item.text || "")}</textarea>
        </label>
      </div>
    `;
  }

  if (section.kind === "experience" || section.kind === "project") {
    const primaryLabel = section.kind === "experience" ? "公司 / 组织" : "项目名";
    const primaryField = section.kind === "experience" ? "company" : "projectName";
    return `
      <div class="section-item-card" data-section-id="${section.id}">
        <div class="section-item-card__head">
          <strong>${escapeHtml(section.kind === "experience" ? `经历 ${index + 1}` : `项目 ${index + 1}`)}</strong>
          <button type="button" class="mini-button" data-section-action="remove-item" data-section-id="${section.id}" data-item-index="${index}">删除条目</button>
        </div>

        <div class="editor-grid">
          <label class="field">
            <span>${escapeHtml(primaryLabel)}</span>
            <input type="text" value="${escapeAttribute(item[primaryField] || "")}" data-section-id="${section.id}" data-item-index="${index}" data-item-field="${primaryField}" placeholder="${escapeAttribute(section.kind === "experience" ? "例如：字节跳动" : "例如：校园拉新项目")}" />
          </label>
          <label class="field">
            <span>${escapeHtml(section.kind === "experience" ? "职位" : "角色")}</span>
            <input type="text" value="${escapeAttribute(item.role || "")}" data-section-id="${section.id}" data-item-index="${index}" data-item-field="role" placeholder="${escapeAttribute(section.kind === "experience" ? "例如：用户增长运营实习生" : "例如：项目负责人")}" />
          </label>
        </div>

        <div class="editor-grid">
          <label class="field">
            <span>时间</span>
            <input type="text" value="${escapeAttribute(item.time || "")}" data-section-id="${section.id}" data-item-index="${index}" data-item-field="time" placeholder="例如：2024.06 - 2024.12" />
          </label>
        </div>

        <label class="field">
          <span>一句话描述</span>
          <textarea class="editor-textarea editor-textarea--card" data-section-id="${section.id}" data-item-index="${index}" data-item-field="summary" placeholder="写目标、动作、结果，以及你个人做成了什么。">${escapeHtml(item.summary || "")}</textarea>
        </label>

        <div class="bullet-editor">
          <div class="bullet-editor__head">
            <strong>要点补充</strong>
            <button type="button" class="mini-button" data-section-action="add-bullet" data-section-id="${section.id}" data-item-index="${index}">+ 添加要点</button>
          </div>
          <div class="bullet-editor__list">
            ${normalizeBullets(item.bullets).map((bullet, bulletIndex) => `
              <div class="bullet-editor__row">
                <input type="text" value="${escapeAttribute(bullet || "")}" data-section-id="${section.id}" data-item-index="${index}" data-bullet-index="${bulletIndex}" placeholder="例如：推动活动上线，协调产品、设计和渠道团队执行" />
                <button type="button" class="mini-button" data-section-action="remove-bullet" data-section-id="${section.id}" data-item-index="${index}" data-bullet-index="${bulletIndex}">删除</button>
              </div>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }

  if (section.kind === "awards") {
    return `
      <div class="section-item-card" data-section-id="${section.id}">
        <div class="section-item-card__head">
          <strong>奖项 ${index + 1}</strong>
          <button type="button" class="mini-button" data-section-action="remove-item" data-section-id="${section.id}" data-item-index="${index}">删除条目</button>
        </div>
        <label class="field">
          <span>奖项文本</span>
          <input type="text" value="${escapeAttribute(item.text || "")}" data-section-id="${section.id}" data-item-index="${index}" data-item-field="text" placeholder="例如：国家奖学金 / 校优秀毕业生 / 数模竞赛二等奖" />
        </label>
      </div>
    `;
  }

  return `
    <div class="section-item-card" data-section-id="${section.id}">
      <div class="section-item-card__head">
        <strong>内容 ${index + 1}</strong>
        <button type="button" class="mini-button" data-section-action="remove-item" data-section-id="${section.id}" data-item-index="${index}">删除条目</button>
      </div>
      <label class="field">
        <span>正文</span>
        <textarea class="editor-textarea editor-textarea--card" data-section-id="${section.id}" data-item-index="${index}" data-item-field="text">${escapeHtml(item.text || "")}</textarea>
      </label>
    </div>
  `;
}

function renderAiWorkbench() {
  const activeSection = getActiveSection();
  if (activeSectionHint) {
    activeSectionHint.textContent = activeSection
      ? `当前模块：${activeSection.title || getSectionTitle(activeSection.kind)}`
      : "当前模块：未选择";
  }

  optimizeCurrentSectionButton.disabled = !activeSection;
  applyAiDiffButton.disabled = !state.pendingOptimization || !state.pendingOptimization.diffs.length;
  resetGeneratorButton.disabled = !state.pendingOptimization && !state.lastAppliedSnapshot;

  const summary = state.generatorAiSummary;
  aiCompareTitle.textContent = summary?.title || "还没开始优化";
  aiCompareText.textContent = summary?.text || "先选整份简历或当前模块，再决定要不要应用这次改动。";
  aiDiffList.innerHTML = state.pendingOptimization?.diffs?.length
    ? state.pendingOptimization.diffs.map((diff) => renderAiDiffCard(diff)).join("")
    : `<div class="ai-diff-empty">当前没有待应用的修改建议。</div>`;
}

function renderAiDiffCard(diff) {
  const title = diff.after?.title || diff.before?.title || "未命名模块";
  const beforeText = formatSectionSnapshot(diff.before);
  const afterText = formatSectionSnapshot(diff.after);
  return `
    <article class="ai-diff-card">
      <div class="ai-diff-card__head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(getSectionLabel(diff.after?.kind || diff.before?.kind || "custom"))}</span>
      </div>
      <div class="ai-diff-card__grid">
        <div>
          <p class="rewrite-grid__label">优化前</p>
          <div class="ai-diff-card__copy">${escapeHtml(beforeText)}</div>
        </div>
        <div>
          <p class="rewrite-grid__label">优化后</p>
          <div class="ai-diff-card__copy">${escapeHtml(afterText)}</div>
        </div>
      </div>
      <p class="hint">${escapeHtml(diff.reason || buildClientGeneratorReason(diff.after?.kind || diff.before?.kind || "custom"))}</p>
    </article>
  `;
}

function renderResumePreview() {
  if (!resumePreview) return;
  const templateConfig = getTemplateConfig(state.resumeDocument.theme.templateId);
  resumePreview.innerHTML = renderResume(state.resumeDocument, templateConfig, "screen");
  updatePreviewViewportScale();
  highlightPreviewSelection();
  schedulePreviewMeasurement();
}

function highlightPreviewSelection() {
  if (!resumePreview) return;
  resumePreview.querySelectorAll(".is-active").forEach((node) => node.classList.remove("is-active"));
  if (!state.activeSectionId) return;
  resumePreview.querySelectorAll(`[data-section-id="${state.activeSectionId}"]`).forEach((node) => {
    node.classList.add("is-active");
  });
}

function highlightSectionCard() {
  if (!structuredEditor) return;
  structuredEditor.querySelectorAll(".section-card").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.sectionId === state.activeSectionId);
  });
}

function schedulePreviewMeasurement() {
  window.clearTimeout(previewMeasureTimer);
  previewMeasureTimer = window.setTimeout(() => {
    updatePreviewViewportScale();
    measurePreviewOverflow();
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        updatePreviewViewportScale();
        measurePreviewOverflow();
      }).catch(() => {});
    }
  }, 40);
}

function updatePreviewViewportScale() {
  if (!resumePreviewStage || !resumePreviewViewport) return;
  const stageStyles = window.getComputedStyle(resumePreviewStage);
  const horizontalPadding = Number.parseFloat(stageStyles.paddingLeft || "0") + Number.parseFloat(stageStyles.paddingRight || "0");
  const availableWidth = Math.max(0, resumePreviewStage.clientWidth - horizontalPadding);
  const scale = Math.min(1, availableWidth / A4_WIDTH);
  const scaledWidth = A4_WIDTH * scale;
  const scaledHeight = A4_HEIGHT * scale;
  resumePreviewStage.style.setProperty("--preview-scale", String(scale));
  resumePreviewStage.style.setProperty("--preview-width", `${scaledWidth}px`);
  resumePreviewStage.style.setProperty("--preview-height", `${scaledHeight}px`);
}

function measurePreviewOverflow() {
  const page = resumePreview.querySelector(".resume-sheet__page");
  const inner = resumePreview.querySelector(".resume-sheet__page-inner");
  if (!page || !inner) return;

  const overflowPx = Math.max(0, Math.ceil(inner.scrollHeight - page.clientHeight));
  state.pageStatus = {
    overflowing: overflowPx > 0,
    overflowPx
  };

  if (state.pageStatus.overflowing) {
    pageStatusBox?.classList.add("is-danger");
  } else {
    pageStatusBox?.classList.remove("is-danger");
  }

  if (exportPdfButton) {
    exportPdfButton.disabled = !state.resumeDocument.basics.name.trim();
  }
}

async function requestOptimization({ scope, sectionId = "", goal = "general" }) {
  const activeSection = getSectionById(sectionId);
  state.generatorAiSummary = {
    title: goal === "compress" ? "AI 正在压缩内容" : scope === "section" ? "AI 正在优化当前模块" : "AI 正在优化整份简历",
    text: goal === "compress"
      ? "本次会优先删掉冗余表达，帮助你把内容压回一页 A4。"
      : scope === "section"
        ? `这次只会修改「${activeSection?.title || "当前模块"}」。`
        : "本次会在不改事实的前提下，把整份简历的句子顺一顺。"
  };
  renderAiWorkbench();

  try {
    const result = await optimizeResumeDocument({
      resumeDocument: state.resumeDocument,
      jdText: reviewJdInput?.value?.trim() || "",
      scope,
      sectionId,
      goal
    });

    const diffs = normalizeGeneratorDiffs(result.diffs, state.resumeDocument);
    state.pendingOptimization = {
      diffs,
      afterDocument: applyDiffsToDocument(state.resumeDocument, diffs),
      scope,
      sectionId,
      goal
    };

    state.generatorAiSummary = {
      title: goal === "compress" ? "已生成压缩建议" : scope === "section" ? "已生成当前模块的优化建议" : "已生成整份简历的优化建议",
      text: looksLikeGeneratorMetaText(result.summary)
        ? buildClientGeneratorSummary({ scope, goal }, diffs.length)
        : (result.summary || buildClientGeneratorSummary({ scope, goal }, diffs.length))
    };
  } catch (error) {
    console.error(error);
    state.pendingOptimization = null;
    state.generatorAiSummary = {
      title: "AI 优化失败",
      text: error.message || "稍后再试。"
    };
    window.alert(error.message || "AI 优化失败。");
  } finally {
    renderAiWorkbench();
  }
}

function applyPendingOptimization() {
  if (!state.pendingOptimization?.diffs?.length) return;
  state.lastAppliedSnapshot = cloneResumeDocument(state.resumeDocument);
  state.resumeDocument = cloneResumeDocument(state.pendingOptimization.afterDocument);
  state.resumeDocument.meta.lastAiDiff = {
    summary: state.generatorAiSummary?.text || "",
    diffCount: state.pendingOptimization.diffs.length,
    appliedAt: Date.now()
  };
  state.generatorAiSummary = {
    title: "已应用本次优化",
    text: "优化结果已经写回当前简历，并已切回预览页。若觉得改过头了，可以立即恢复原版。"
  };
  state.pendingOptimization = null;
  persistAndRender("apply-ai");
  switchWorkspace("generatorPanel");
  window.setTimeout(() => {
    resumePreviewStage?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
}

function mutateResumeDocument(mutator, origin = "manual") {
  const next = cloneResumeDocument(state.resumeDocument);
  mutator(next);
  state.resumeDocument = normalizeResumeDocument(next);
  persistAndRender(origin);
}

function mutateSection(sectionId, mutator, origin = "manual") {
  if (!sectionId) return;
  mutateResumeDocument((document) => {
    const section = document.sections.find((item) => item.id === sectionId);
    if (!section) return;
    mutator(section);
  }, origin);
}

function persistAndRender(origin) {
  if ((origin === "manual" || origin === "editor-input") && state.pendingOptimization) {
    state.pendingOptimization = null;
    state.generatorAiSummary = {
      title: "已继续手动编辑",
      text: "为避免覆盖你刚改的内容，上一轮待应用建议已自动失效。"
    };
  }

  state.resumeDocument.meta.lastSavedAt = Date.now();
  scheduleAutosave();

  if (origin === "silent") {
    return;
  }

  if (origin === "editor-input") {
    renderAiWorkbench();
    renderResumePreview();
    highlightSectionCard();
    renderAutosaveStatus();
    return;
  }

  renderGenerator();
}

function scheduleAutosave() {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.resumeDocument));
    } catch (error) {
      console.warn("autosave failed", error);
    }
    renderAutosaveStatus();
  }, 120);
}

function renderAutosaveStatus() {
  if (!autosaveStatus) return;
  const savedAt = state.resumeDocument.meta?.lastSavedAt;
  if (!savedAt) {
    autosaveStatus.textContent = "本地自动保存已开启";
    return;
  }
  autosaveStatus.textContent = `已自动保存 ${formatClock(savedAt)}`;
}

function addSection(kind) {
  if (!kind || !canAddSectionKind(kind)) return;
  const section = createSection(kind);
  state.activeSectionId = section.id;
  mutateResumeDocument((document) => {
    document.sections.push(section);
  }, "manual");
}

function removeSection(sectionId) {
  if (!sectionId) return;
  mutateResumeDocument((document) => {
    document.sections = document.sections.filter((section) => section.id !== sectionId);
  }, "manual");
  if (state.activeSectionId === sectionId) {
    state.activeSectionId = state.resumeDocument.sections[0]?.id || null;
  }
}

function moveSection(sectionId, direction) {
  mutateResumeDocument((document) => {
    const index = document.sections.findIndex((section) => section.id === sectionId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= document.sections.length) return;
    const [section] = document.sections.splice(index, 1);
    document.sections.splice(nextIndex, 0, section);
  }, "manual");
}

function addSectionItem(sectionId) {
  mutateSection(sectionId, (section) => {
    section.items.push(createSectionItem(section.kind));
  }, "manual");
}

function removeSectionItem(sectionId, itemIndex) {
  mutateSection(sectionId, (section) => {
    if (itemIndex < 0 || itemIndex >= section.items.length) return;
    section.items.splice(itemIndex, 1);
    if (!section.items.length) {
      section.items.push(createSectionItem(section.kind));
    }
  }, "manual");
}

function addBullet(sectionId, itemIndex) {
  mutateSection(sectionId, (section) => {
    const item = ensureSectionItem(section, itemIndex);
    item.bullets = normalizeBullets(item.bullets);
    item.bullets.push("");
  }, "manual");
}

function removeBullet(sectionId, itemIndex, bulletIndex) {
  mutateSection(sectionId, (section) => {
    const item = ensureSectionItem(section, itemIndex);
    item.bullets = normalizeBullets(item.bullets);
    item.bullets.splice(bulletIndex, 1);
    if (!item.bullets.length) {
      item.bullets.push("");
    }
  }, "manual");
}

function ensureSectionItem(section, itemIndex) {
  while (section.items.length <= itemIndex) {
    section.items.push(createSectionItem(section.kind));
  }
  if (!section.items[itemIndex]) {
    section.items[itemIndex] = createSectionItem(section.kind);
  }
  return section.items[itemIndex];
}

function canAddSectionKind(kind) {
  const entry = SECTION_CATALOG.find((item) => item.kind === kind);
  if (!entry) return false;
  if (!entry.singleton) return true;
  return !state.resumeDocument.sections.some((section) => section.kind === kind);
}

function getActiveSection() {
  return getSectionById(state.activeSectionId);
}

function getSectionById(sectionId) {
  return state.resumeDocument.sections.find((section) => section.id === sectionId) || null;
}

function renderResume(resumeDocument, templateConfig, mode = "screen") {
  const document = normalizeResumeDocument(resumeDocument);
  const template = templateConfig || getTemplateConfig(document.theme.templateId);
  const accent = document.theme.accentMode === "custom" && document.theme.accentColor
    ? document.theme.accentColor
    : template.defaults.accent;
  const fontScale = Number(document.theme.fontScale) || template.defaults.fontScale || 1;
  const visibleSections = document.sections.filter((section) => section.visible !== false);
  const basics = document.basics;

  return `
    <div class="resume-skin" style="--resume-accent:${escapeAttribute(accent)}; --resume-font-scale:${escapeAttribute(fontScale)}">
      <div class="resume-sheet resume-sheet--${escapeAttribute(template.id)} resume-sheet--reference" data-mode="${escapeAttribute(mode)}">
        <section class="resume-sheet__page resume-sheet__page--reference">
          <div class="resume-sheet__page-inner resume-sheet__page-inner--reference">
            <header class="resume-ref01__header">
              <div class="resume-ref01__title-cn">个人简历</div>
              <div class="resume-ref01__target">
                <span>求职意向：</span>
                ${renderBoundText("strong", "resume-ref01__target-role", "basics.targetRole", basics.targetRole, { placeholder: "市场专员" })}
              </div>
              <div class="resume-ref01__title-en">PERSONAL RESUME</div>
            </header>

            ${renderReferenceProfileSection(basics)}

            <main class="resume-ref01__content">
              ${visibleSections.length
                ? visibleSections.map((section) => renderReferenceSection(section, basics)).join("")
                : `
                  <section class="resume-ref01__section resume-ref01__section--empty">
                    ${renderReferenceRibbon("添加你的简历模块", "Add Sections")}
                    <p class="resume-sheet__empty-copy">先在左侧添加教育背景、实习经历、项目经历、奖项或自定义模块，右侧会立刻同步。</p>
                  </section>
                `}
            </main>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderReferenceProfileSection(basics) {
  return `
    <section class="resume-ref01__section resume-ref01__section--profile">
      ${renderReferenceRibbon("个人信息", "Personal information")}
      <div class="resume-ref01__profile-grid">
        <div class="resume-ref01__profile-list">
          ${renderReferenceInfoRow("姓名", "basics.name", basics.name, "例如：张小可")}
          ${renderReferenceInfoRow("城市", "basics.city", basics.city, "例如：深圳")}
          ${renderReferenceInfoRow("性别", "basics.gender", basics.gender, "例如：女")}
          ${renderReferenceInfoRow("学校", "basics.school", basics.school, "例如：可瓦大学")}
          ${renderReferenceInfoRow("手机号", "basics.phone", basics.phone, "例如：13066668888")}
          ${renderReferenceInfoRow("邮箱", "basics.email", basics.email, "例如：support@example.com")}
          ${renderReferenceInfoRow("专业", "basics.major", basics.major, "例如：市场营销专业")}
          ${renderReferenceInfoRow("学历", "basics.degree", basics.degree, "例如：本科")}
        </div>
        <div class="resume-ref01__profile-photo">
          ${basics.photoUrl
            ? `<img class="resume-ref01__photo" src="${basics.photoUrl}" alt="头像" />`
            : `<div class="resume-ref01__photo resume-ref01__photo--empty"></div>`}
        </div>
      </div>
    </section>
  `;
}

function renderReferenceInfoRow(label, path, value, placeholder) {
  return `
    <div class="resume-ref01__info-row">
      <span class="resume-ref01__info-label">${escapeHtml(label)}：</span>
      ${renderBoundText("strong", "resume-ref01__info-value", path, value, { placeholder })}
    </div>
  `;
}

function renderReferenceSection(section, basics) {
  if (section.kind === "summary") {
    return `
      <section class="resume-ref01__section" data-section-id="${section.id}">
        ${renderReferenceRibbonEditable(section)}
        ${renderBoundText("p", "resume-ref01__paragraph", buildSectionItemBind(section.id, 0, "text"), section.items[0]?.text || "", {
          placeholder: "用 2-3 句讲清你的方向、经验和目标岗位。",
          multiline: true
        })}
      </section>
    `;
  }

  if (section.kind === "skills") {
    return `
      <section class="resume-ref01__section" data-section-id="${section.id}">
        ${renderReferenceRibbonEditable(section)}
        ${renderBoundText("p", "resume-ref01__paragraph", buildSectionItemBind(section.id, 0, "text"), section.items[0]?.text || "", {
          placeholder: "例如：SQL / Excel / 用户增长 / 数据分析 / 英语六级",
          multiline: true
        })}
      </section>
    `;
  }

  if (section.kind === "education") {
    return `
      <section class="resume-ref01__section" data-section-id="${section.id}">
        ${renderReferenceRibbonEditable(section)}
        <div class="resume-ref01__stack">
          ${section.items.map((item, index) => `
            <article class="resume-ref01__entry">
              <div class="resume-ref01__entry-row resume-ref01__entry-row--education">
                ${renderBoundText("span", "resume-ref01__entry-time", buildSectionItemBind(section.id, index, "time"), item.time || "", {
                  placeholder: "例如：2020.09 - 2024.06"
                })}
                ${renderBoundText("span", "resume-ref01__entry-main", "basics.school", basics.school, {
                  placeholder: "例如：可瓦大学"
                })}
                <span class="resume-ref01__entry-side">
                  ${renderBoundText("span", "resume-ref01__entry-side-main", "basics.major", basics.major, {
                    placeholder: "例如：市场营销专业"
                  })}
                  ${renderBoundText("span", "resume-ref01__entry-side-sub", "basics.degree", basics.degree, {
                    placeholder: "本科"
                  })}
                </span>
              </div>
              ${renderBoundText("p", "resume-ref01__paragraph", buildSectionItemBind(section.id, index, "text"), item.text || "", {
                placeholder: "例如：GPA、主修课程、研究方向、交换经历。",
                multiline: true
              })}
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  if (section.kind === "experience" || section.kind === "project") {
    const primaryField = section.kind === "experience" ? "company" : "projectName";
    const primaryPlaceholder = section.kind === "experience" ? "例如：字节跳动" : "例如：校园拉新项目";
    const rolePlaceholder = section.kind === "experience" ? "例如：用户增长运营实习生" : "例如：项目负责人";
    return `
      <section class="resume-ref01__section" data-section-id="${section.id}">
        ${renderReferenceRibbonEditable(section)}
        <div class="resume-ref01__stack">
          ${section.items.map((item, index) => `
            <article class="resume-ref01__entry">
              <div class="resume-ref01__entry-row resume-ref01__entry-row--experience">
                ${renderBoundText("span", "resume-ref01__entry-time", buildSectionItemBind(section.id, index, "time"), item.time || "", {
                  placeholder: "例如：2024.06 - 2024.12"
                })}
                ${renderBoundText("strong", "resume-ref01__entry-main", buildSectionItemBind(section.id, index, primaryField), item[primaryField] || "", {
                  placeholder: primaryPlaceholder
                })}
                ${renderBoundText("span", "resume-ref01__entry-side-main", buildSectionItemBind(section.id, index, "role"), item.role || "", {
                  placeholder: rolePlaceholder
                })}
              </div>
              ${renderBoundText("p", "resume-ref01__paragraph", buildSectionItemBind(section.id, index, "summary"), item.summary || "", {
                placeholder: "写清目标、动作、结果，以及你个人做成了什么。",
                multiline: true
              })}
              <ul class="resume-ref01__bullet-list">
                ${normalizeBullets(item.bullets).map((bullet, bulletIndex) => `
                  <li>
                    ${renderBoundText("span", "resume-ref01__bullet-text", buildSectionBulletBind(section.id, index, bulletIndex), bullet || "", {
                      placeholder: "补充一个动作或结果要点。",
                      multiline: true
                    })}
                  </li>
                `).join("")}
              </ul>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  if (section.kind === "awards") {
    return `
      <section class="resume-ref01__section" data-section-id="${section.id}">
        ${renderReferenceRibbonEditable(section)}
        <ul class="resume-ref01__bullet-list">
          ${section.items.map((item, index) => `
            <li>${renderBoundText("span", "resume-ref01__bullet-text", buildSectionItemBind(section.id, index, "text"), item.text || "", {
              placeholder: "例如：国家奖学金 / 校优秀毕业生"
            })}</li>
          `).join("")}
        </ul>
      </section>
    `;
  }

  return `
    <section class="resume-ref01__section" data-section-id="${section.id}">
      ${renderReferenceRibbonEditable(section)}
      ${section.items.map((item, index) => renderBoundText("p", "resume-ref01__paragraph", buildSectionItemBind(section.id, index, "text"), item.text || "", {
        placeholder: "写任何你想补充到简历里的内容。",
        multiline: true
      })).join("")}
    </section>
  `;
}

function renderReferenceRibbonEditable(section) {
  return renderReferenceRibbon(
    section.title || getSectionTitle(section.kind),
    getSectionEnglish(section.kind, section.title || getSectionTitle(section.kind)),
    buildSectionBind(section.id, "title"),
    getSectionTitle(section.kind)
  );
}

function renderReferenceRibbon(title, english, bindPath = "", placeholder = "") {
  const cnMarkup = bindPath
    ? renderBoundText("span", "resume-ref01__ribbon-cn", bindPath, title, { placeholder })
    : `<span class="resume-ref01__ribbon-cn">${escapeHtml(title)}</span>`;
  return `
    <div class="resume-ref01__ribbon">
      <div class="resume-ref01__ribbon-chip">
        ${cnMarkup}
        <span class="resume-ref01__ribbon-en">${escapeHtml(english)}</span>
      </div>
      <div class="resume-ref01__ribbon-line"></div>
    </div>
  `;
}

function renderBoundText(tag, className, bindPath, value, options = {}) {
  const placeholder = options.placeholder || "";
  const multiline = options.multiline ? "true" : "false";
  const content = formatEditableHtml(value);
  return `<${tag} class="${className}" contenteditable="true" spellcheck="false" data-bind="${bindPath}" data-multiline="${multiline}" data-placeholder="${escapeAttribute(placeholder)}">${content}</${tag}>`;
}

function buildSectionBind(sectionId, field) {
  return `sections.${sectionId}.${field}`;
}

function buildSectionItemBind(sectionId, itemIndex, field) {
  return `sections.${sectionId}.items.${itemIndex}.${field}`;
}

function buildSectionBulletBind(sectionId, itemIndex, bulletIndex) {
  return `sections.${sectionId}.items.${itemIndex}.bullets.${bulletIndex}`;
}

function writeBindValue(bindPath, value) {
  if (!bindPath) return;
  mutateResumeDocument((document) => {
    const parts = String(bindPath).split(".");
    if (parts[0] === "basics") {
      const field = parts[1];
      if (field in document.basics) {
        document.basics[field] = value;
      }
      return;
    }

    if (parts[0] !== "sections") return;
    const section = document.sections.find((item) => item.id === parts[1]);
    if (!section) return;

    if (parts[2] === "title") {
      section.title = value;
      return;
    }

    if (parts[2] !== "items") return;
    const itemIndex = toNumber(parts[3], 0);
    const item = ensureSectionItem(section, itemIndex);
    if (parts[4] === "bullets") {
      const bulletIndex = toNumber(parts[5], 0);
      item.bullets = normalizeBullets(item.bullets);
      item.bullets[bulletIndex] = value;
      return;
    }
    item[parts[4]] = value;
  }, "manual");
}

function createSampleResumeDocument() {
  const document = createDefaultResumeDocument();
  document.basics = {
    name: "张三",
    targetRole: "用户增长运营",
    gender: "男",
    phone: "13800000000",
    email: "zhangsan@email.com",
    city: "上海",
    school: "复旦大学",
    major: "市场营销",
    degree: "本科",
    photoUrl: ""
  };

  document.sections = [
    createSection("summary", {
      title: "个人概述",
      items: [{
        text: "2 年增长与内容运营相关经历，做过拉新活动、指标复盘和跨团队推进，希望投递增长、用户运营或内容增长方向岗位。"
      }]
    }),
    createSection("experience", {
      title: "实习经历",
      items: [
        {
          company: "XX 内容社区",
          role: "用户增长运营实习生",
          time: "2024.07 - 2025.01",
          summary: "围绕社区拉新目标参与活动策划、执行推进与复盘，协同产品、设计和投放团队完成上线。",
          bullets: [
            "跟进活动日历和需求拆解，推动关键节点按期交付",
            "整理拉新与转化数据周报，支持团队优化转化路径",
            "协同社群和内容运营同学完成活动素材分发与效果回收"
          ]
        }
      ]
    }),
    createSection("project", {
      title: "项目经历",
      items: [
        {
          projectName: "校园渠道拉新项目",
          role: "项目负责人",
          time: "2024.01 - 2024.02",
          summary: "负责暑期拉新活动的校园端执行方案，统筹渠道沟通、文案推进和复盘整理。",
          bullets: [
            "对接校园代理和社群渠道，跟进每日执行反馈",
            "整理活动素材与转化表现，输出项目复盘",
            "协调宣传节奏，保证关键节点宣传不掉线"
          ]
        }
      ]
    }),
    createSection("skills", {
      title: "个人技能",
      items: [{
        text: "Excel / SQL / 数据分析 / 活动策划 / 跨团队协作 / 英语六级"
      }]
    })
  ];

  return normalizeResumeDocument(document);
}

function createDefaultResumeDocument() {
  return normalizeResumeDocument({
    basics: {
      name: "",
      targetRole: "",
      gender: "",
      phone: "",
      email: "",
      city: "",
      school: "",
      major: "",
      degree: "",
      photoUrl: ""
    },
    sections: [
      createSection("summary"),
      createSection("experience"),
      createSection("project"),
      createSection("skills")
    ],
    theme: {
      templateId: "ref-01",
      accentMode: "template",
      accentColor: "",
      fontScale: 1
    },
    meta: {
      version: 1,
      lastSavedAt: 0,
      lastAiDiff: null
    }
  });
}

function loadResumeDocument() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultResumeDocument();
    return normalizeResumeDocument(JSON.parse(raw));
  } catch (error) {
    console.warn("load resume document failed", error);
    return createDefaultResumeDocument();
  }
}

function normalizeResumeDocument(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const basics = source.basics && typeof source.basics === "object" ? source.basics : {};
  const theme = source.theme && typeof source.theme === "object" ? source.theme : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const sections = Array.isArray(source.sections) ? source.sections : [];
  const normalized = {
    basics: {
      name: normalizeText(basics.name),
      targetRole: normalizeText(basics.targetRole),
      gender: normalizeText(basics.gender),
      phone: normalizeText(basics.phone),
      email: normalizeText(basics.email),
      city: normalizeText(basics.city),
      school: normalizeText(basics.school),
      major: normalizeText(basics.major),
      degree: normalizeText(basics.degree),
      photoUrl: normalizeText(basics.photoUrl)
    },
    sections: sections.map((section) => normalizeSection(section)).filter(Boolean),
    theme: {
      templateId: "ref-01",
      accentMode: theme.accentMode === "custom" && theme.accentColor ? "custom" : "template",
      accentColor: normalizeText(theme.accentColor),
      fontScale: clampNumber(theme.fontScale, 0.84, 1.16, 1)
    },
    meta: {
      version: 1,
      lastSavedAt: Number(meta.lastSavedAt) || 0,
      lastAiDiff: meta.lastAiDiff || null
    }
  };

  if (!normalized.sections.length) {
    normalized.sections = createDefaultResumeDocument().sections;
  }

  return normalized;
}

function normalizeSection(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = normalizeSectionKind(raw.kind);
  const normalized = {
    id: normalizeText(raw.id) || createSectionId(kind),
    kind,
    title: normalizeSectionTitle(kind, raw.title),
    visible: raw.visible !== false,
    collapsed: Boolean(raw.collapsed),
    items: normalizeSectionItems(kind, raw.items)
  };
  return normalized;
}

function normalizeSectionItems(kind, rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const normalized = items.map((item) => normalizeSectionItem(kind, item)).filter(Boolean);
  return normalized.length ? normalized : [createSectionItem(kind)];
}

function normalizeSectionItem(kind, raw) {
  const item = raw && typeof raw === "object" ? raw : {};
  if (kind === "summary" || kind === "skills" || kind === "awards" || kind === "custom") {
    return { text: normalizeText(item.text) };
  }
  if (kind === "education") {
    return {
      time: normalizeText(item.time),
      text: normalizeText(item.text)
    };
  }
  if (kind === "experience") {
    return {
      company: normalizeText(item.company),
      role: normalizeText(item.role),
      time: normalizeText(item.time),
      summary: normalizeText(item.summary),
      bullets: normalizeBullets(item.bullets)
    };
  }
  return {
    projectName: normalizeText(item.projectName),
    role: normalizeText(item.role),
    time: normalizeText(item.time),
    summary: normalizeText(item.summary),
    bullets: normalizeBullets(item.bullets)
  };
}

function createSection(kind, overrides = {}) {
  return normalizeSection({
    id: overrides.id || createSectionId(kind),
    kind,
    title: overrides.title || getSectionTitle(kind),
    visible: overrides.visible ?? true,
    collapsed: overrides.collapsed ?? false,
    items: Array.isArray(overrides.items) ? overrides.items : [createSectionItem(kind)]
  });
}

function createSectionItem(kind) {
  if (kind === "summary" || kind === "skills" || kind === "awards" || kind === "custom") {
    return { text: "" };
  }
  if (kind === "education") {
    return {
      time: "",
      text: ""
    };
  }
  if (kind === "experience") {
    return {
      company: "",
      role: "",
      time: "",
      summary: "",
      bullets: [""]
    };
  }
  return {
    projectName: "",
    role: "",
    time: "",
    summary: "",
    bullets: [""]
  };
}

function createSectionId(kind) {
  return `sec_${kind}_${sectionSeed++}`;
}

function hydrateSectionSeed(document) {
  const maxId = (document.sections || []).reduce((max, section) => {
    const matched = String(section.id || "").match(/_(\d+)$/);
    return matched ? Math.max(max, Number(matched[1])) : max;
  }, 0);
  sectionSeed = Math.max(sectionSeed, maxId + 1);
}

function normalizeSectionKind(kind) {
  const source = String(kind || "").toLowerCase();
  if (source === "summary") return "summary";
  if (source === "education") return "education";
  if (source === "experience") return "experience";
  if (source === "project") return "project";
  if (source === "skills") return "skills";
  if (source === "awards") return "awards";
  return "custom";
}

function normalizeBullets(raw) {
  const source = Array.isArray(raw) ? raw : [];
  const normalized = source.map((item) => normalizeText(item));
  return normalized.length ? normalized : [""];
}

const generatorMetaTextPatterns = [
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
  /措辞/,
  /把原来偏空的表述/,
  /动作和结果/,
  /把你具体做的事和结果写清楚/,
  /补充你具体做了什么/,
  /怎么做的(?:，|,)?以及最后产出了什么/,
  /写清楚/
];

function looksLikeGeneratorMetaText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return generatorMetaTextPatterns.some((pattern) => pattern.test(normalized));
}

const generatorInstructionTextPatterns = [
  /把你具体做的事和结果写清楚/,
  /把你具体做过的事和结果写清楚/,
  /把原来偏空的表述改得更具体/,
  /补充你具体做了什么/,
  /怎么做的(?:，|,)?以及最后产出了什么/,
  /把和.+?相关的内容写清楚/,
  /动作和结果/,
  /结果导向/,
  /岗位关键词/,
  /空话/
];

function looksLikeGeneratorInstructionText(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return generatorInstructionTextPatterns.some((pattern) => pattern.test(normalized));
}

function stripGeneratorInstructionSuffix(text) {
  return normalizeText(text)
    .replace(/[，,\s]*把你具体做的事和结果写清楚。?$/u, "")
    .replace(/[，,\s]*把你具体做过的事和结果写清楚。?$/u, "")
    .replace(/[，,\s]*把原来偏空的表述改得更具体。?$/u, "")
    .replace(/[，,\s]*补充你具体做了什么，并把和.+?相关的内容写清楚。?$/u, "")
    .replace(/[，,\s]*补充你具体做了什么、怎么做的，以及最后产出了什么。?$/u, "")
    .replace(/[，,\s]*补充你具体做了什么。?$/u, "")
    .replace(/[，,\s]*把和.+?相关的内容写清楚。?$/u, "")
    .replace(/[，,\s]*也补清了动作和结果。?$/u, "")
    .replace(/[，,\s]*把动作和结果写清楚。?$/u, "")
    .replace(/[，,\s]+$/u, "")
    .trim();
}

function sanitizeGeneratorDiffText(beforeText, afterText) {
  const before = normalizeText(beforeText);
  const stripped = stripGeneratorInstructionSuffix(afterText);
  if (!stripped) return before;
  if (looksLikeGeneratorInstructionText(stripped)) return before;
  return stripped;
}

function sanitizeGeneratorDiffSection(before, after) {
  if (!before || !after || before.kind !== after.kind) return after;
  const next = cloneResumeDocument(after);
  next.title = looksLikeGeneratorMetaText(next.title) ? before.title : normalizeSectionTitle(before.kind, next.title);

  if (before.kind === "summary" || before.kind === "skills" || before.kind === "awards" || before.kind === "custom") {
    next.items = (Array.isArray(after.items) ? after.items : []).map((item, index) => ({
      text: sanitizeGeneratorDiffText(before.items?.[index]?.text, item?.text)
    }));
    return normalizeSection({ ...before, ...next });
  }

  if (before.kind === "education") {
    next.items = (Array.isArray(after.items) ? after.items : []).map((item, index) => ({
      time: before.items?.[index]?.time || "",
      text: sanitizeGeneratorDiffText(before.items?.[index]?.text, item?.text)
    }));
    return normalizeSection({ ...before, ...next });
  }

  if (before.kind === "experience" || before.kind === "project") {
    next.items = (Array.isArray(after.items) ? after.items : []).map((item, index) => {
      const sourceItem = before.items?.[index] || createSectionItem(before.kind);
      const cleanedBullets = (Array.isArray(item?.bullets) ? item.bullets : [])
        .map((bullet, bulletIndex) => sanitizeGeneratorDiffText(sourceItem?.bullets?.[bulletIndex], bullet))
        .filter(Boolean);
      return before.kind === "experience"
        ? {
            company: sourceItem.company || "",
            role: sourceItem.role || "",
            time: sourceItem.time || "",
            summary: sanitizeGeneratorDiffText(sourceItem.summary, item?.summary),
            bullets: cleanedBullets.length ? cleanedBullets : normalizeBullets(sourceItem.bullets)
          }
        : {
            projectName: sourceItem.projectName || "",
            role: sourceItem.role || "",
            time: sourceItem.time || "",
            summary: sanitizeGeneratorDiffText(sourceItem.summary, item?.summary),
            bullets: cleanedBullets.length ? cleanedBullets : normalizeBullets(sourceItem.bullets)
          };
    });
    return normalizeSection({ ...before, ...next });
  }

  return normalizeSection({ ...before, ...next });
}

function generatorSectionsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildClientGeneratorSummary({ scope, goal }, diffCount) {
  if (!diffCount) {
    return goal === "compress"
      ? "当前内容已经比较紧凑，没有给出必须压缩的改动。"
      : "这次没有给出可靠的自动改写建议，先保留原文会更稳。";
  }
  if (goal === "compress") {
    return `这次压了 ${diffCount} 个模块，主要删掉了重复表述。`;
  }
  if (scope === "section") {
    return "这次只调整了当前模块的说法，没有改原来的事实。";
  }
  return `这次调整了 ${diffCount} 个模块，主要是把说法改得更顺一些。`;
}

function buildClientGeneratorReason(kind) {
  if (kind === "summary") return "这段主要调整了说法，信息没有变。";
  if (kind === "experience" || kind === "project") return "这段保留了原来的经历信息，只微调了表达。";
  if (kind === "skills") return "这段主要整理了表述顺序，没有改原来的技能信息。";
  return "这段只做了轻微改写，没有改原来的事实。";
}

function normalizeGeneratorDiffs(rawDiffs, resumeDocument) {
  const current = normalizeResumeDocument(resumeDocument);
  return (Array.isArray(rawDiffs) ? rawDiffs : []).map((diff) => {
    const sectionId = normalizeText(diff?.sectionId);
    const before = normalizeSection(diff?.before) || current.sections.find((section) => section.id === sectionId) || null;
    const after = normalizeSection(diff?.after);
    if (!sectionId || !before || !after) return null;
    const cleanedAfter = sanitizeGeneratorDiffSection(before, {
      ...before,
      ...after,
      id: before.id,
      kind: before.kind,
      collapsed: before.collapsed,
      visible: before.visible
    });
    if (!cleanedAfter || generatorSectionsEqual(before, cleanedAfter)) return null;
    return {
      sectionId,
      before,
      after: cleanedAfter,
      reason: looksLikeGeneratorMetaText(diff?.reason)
        ? buildClientGeneratorReason(cleanedAfter.kind || before.kind)
        : normalizeText(diff?.reason) || buildClientGeneratorReason(cleanedAfter.kind || before.kind)
    };
  }).filter(Boolean);
}

function applyDiffsToDocument(resumeDocument, diffs) {
  const document = cloneResumeDocument(resumeDocument);
  diffs.forEach((diff) => {
    const index = document.sections.findIndex((section) => section.id === diff.sectionId);
    if (index === -1) return;
    document.sections[index] = normalizeSection({
      ...document.sections[index],
      ...diff.after,
      id: document.sections[index].id,
      kind: document.sections[index].kind,
      visible: document.sections[index].visible,
      collapsed: document.sections[index].collapsed
    });
  });
  return normalizeResumeDocument(document);
}

function getTemplateConfig(templateId) {
  return TEMPLATE_CONFIGS[templateId] || TEMPLATE_CONFIGS["ref-01"];
}

function getSectionTitle(kind) {
  if (kind === "summary") return "个人概述";
  if (kind === "education") return "教育背景";
  if (kind === "experience") return "实习经历";
  if (kind === "project") return "项目经历";
  if (kind === "skills") return "个人技能";
  if (kind === "awards") return "荣誉奖项";
  return "自定义模块";
}

function getSectionLabel(kind) {
  return getSectionTitle(kind);
}

function getSectionEnglish(kind, title = "") {
  const normalizedTitle = normalizeText(title);
  if (normalizedTitle) {
    const derived = deriveSectionEnglishFromTitle(normalizedTitle);
    if (derived) return derived;
  }
  if (kind === "summary") return "Summary";
  if (kind === "education") return "Educational Background";
  if (kind === "experience") return "Internship Experience";
  if (kind === "project") return "Project Experience";
  if (kind === "skills") return "Skills";
  if (kind === "awards") return "Honors & Awards";
  return "Custom Section";
}

function deriveSectionEnglishFromTitle(title) {
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
  const tokens = [];
  for (const [keyword, english] of tokenMap) {
    if (compact.includes(keyword) && !tokens.includes(english)) {
      tokens.push(english);
    }
  }

  if (!tokens.length) return "";
  if (tokens.length === 1) return finalizeSectionEnglishTitle(tokens);
  return finalizeSectionEnglishTitle(tokens.slice(0, 3));
}

function finalizeSectionEnglishTitle(tokens) {
  const words = Array.isArray(tokens) ? [...tokens] : [tokens];
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

  if (!terminalWords.has(words.at(-1))) {
    words.push("Section");
  }

  return words.join(" ");
}

function getSectionCardHint(section) {
  if (section.kind === "summary") return "1 段正文";
  if (section.kind === "skills") return "技能 / 标签文本";
  if (section.kind === "education") return `${section.items.length} 条教育补充`;
  if (section.kind === "experience") return `${section.items.length} 条实习经历`;
  if (section.kind === "project") return `${section.items.length} 条项目`;
  if (section.kind === "awards") return `${section.items.length} 条奖项`;
  return "自由扩展正文";
}

function normalizeSectionTitle(kind, rawTitle) {
  const title = normalizeText(rawTitle);
  if (kind === "experience" && (!title || title === "经历模块")) {
    return getSectionTitle(kind);
  }
  return title || getSectionTitle(kind);
}

function formatSectionSnapshot(section) {
  if (!section) return "没有可显示的内容";
  const header = section.title || getSectionTitle(section.kind);
  const content = section.items.map((item) => {
    if (section.kind === "summary" || section.kind === "skills" || section.kind === "awards" || section.kind === "custom") {
      return item.text || "";
    }
    if (section.kind === "education") {
      return [item.time, item.text].filter(Boolean).join(" ｜ ");
    }
    const primary = section.kind === "experience" ? item.company : item.projectName;
    return [
      [primary, item.role, item.time].filter(Boolean).join(" ｜ "),
      item.summary,
      normalizeBullets(item.bullets).filter(Boolean).join(" / ")
    ].filter(Boolean).join(" ｜ ");
  }).filter(Boolean).join("\n");
  return `${header}\n${content}`.trim();
}

function cloneResumeDocument(document) {
  return JSON.parse(JSON.stringify(document));
}

function normalizePreviewText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(value) {
  return String(value || "").replace(/\r/g, "").trim();
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric * 100) / 100));
}

function toNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatEditableHtml(value) {
  return escapeHtml(String(value || "")).replace(/\n/g, "<br />");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}

function sanitizeFilename(value) {
  return String(value || "resume").replace(/[\\/:*?"<>|]/g, "-");
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

async function optimizeResumeDocument({ resumeDocument, jdText, scope, sectionId, goal = "general" }) {
  const response = await fetch("/api/generator/optimize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      resumeDocument,
      jdText,
      scope,
      sectionId,
      goal
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "AI 优化失败。");
  }
  return payload;
}

async function exportResumeAsPdf() {
  const response = await fetch("/api/export/pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      resumeDocument: state.resumeDocument
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "PDF export failed");
  }

  const blob = await response.blob();
  const filename = `${sanitizeFilename(state.resumeDocument.basics.name || "resume")}-${state.resumeDocument.theme.templateId}.pdf`;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function buildPdfExportMarkup(resumeDocument) {
  const templateConfig = getTemplateConfig(resumeDocument?.theme?.templateId);
  return `
    <div class="pdf-page-stack">
      <section class="pdf-page">
        <div class="pdf-page__sheet">
          <div class="resume-preview pdf-preview">
            ${renderResume(resumeDocument, templateConfig, "pdf")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function mountPdfExportPreview(resumeDocument) {
  document.body.classList.add("pdf-export-mode");
  document.body.innerHTML = `<div class="print-host pdf-export-host">${buildPdfExportMarkup(resumeDocument)}</div>`;
}

async function reviewPdfResume(file, jdText = "") {
  const dataUrl = await fileToDataUrl(file);
  const fileBase64 = String(dataUrl).split(",")[1] || "";
  const response = await fetch("/api/review-resume", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filename: file.name,
      fileBase64,
      jdText
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "AI 评价失败。");
  }
  return payload;
}

async function rewriteResumeText({ filename, resumeText, jdText = "", structuredResume = null }) {
  const response = await fetch("/api/rewrite-resume", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      filename,
      resumeText,
      jdText,
      structuredResume
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "AI 整份重写失败。");
  }
  return payload;
}

function normalizeOptimizationResult(review) {
  if (!review || typeof review !== "object") {
    throw new Error("AI 没有返回有效的优化结果。");
  }

  const rewrites = (Array.isArray(review.rewrites) ? review.rewrites : []).map((item) => ({
    original: String(item?.original || "").trim(),
    problem: String(item?.problem || "").trim(),
    optimized: String(item?.optimized || "").trim()
  })).filter((item) => item.original || item.optimized);
  const interviewQuestions = (Array.isArray(review.interview_questions) ? review.interview_questions : review.interviewQuestions || [])
    .map((item) => {
      if (typeof item === "string") {
        return {
          question: item.trim(),
          intent: ""
        };
      }
      return {
        question: String(item?.question || item?.title || "").trim(),
        intent: String(item?.intent || item?.why || "").trim()
      };
    })
    .filter((item) => item.question);

  return {
    overallScore: normalizePercent(review.overall_score ?? review.overallScore, 0),
    oneLineRoast: String(review.one_line_roast ?? review.oneLineRoast ?? "这份简历有经历基础，但价值表达还不够集中。"),
    strengths: (Array.isArray(review.strengths) ? review.strengths : [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 4),
    rewrites: rewrites.length ? rewrites : [{
      original: "没有拿到稳定的改写片段",
      problem: "模型本次输出不完整",
      optimized: "请稍后重试，或缩短简历文本后再次诊断。"
    }],
    missingKeywords: (Array.isArray(review.missing_keywords) ? review.missing_keywords : review.missingKeywords || [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 8),
    riskFlags: (Array.isArray(review.risk_flags) ? review.risk_flags : review.riskFlags || [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 5),
    interviewQuestions: interviewQuestions.slice(0, 6)
  };
}

function normalizeRewriteResult(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("AI 没有返回有效的整份重写结果。");
  }

  const rewrite = raw.rewrite && typeof raw.rewrite === "object" ? raw.rewrite : {};
  const sectionRewrites = (Array.isArray(raw.section_rewrites) ? raw.section_rewrites : raw.sectionRewrites || [])
    .map((item) => ({
      title: String(item?.title || "").trim(),
      reason: String(item?.reason || "").trim(),
      rewritten: String(item?.rewritten || "").trim()
    }))
    .filter((item) => item.title || item.rewritten);
  const rewrittenResume = raw.rewritten_resume || raw.rewrittenResume || {};
  const modules = (Array.isArray(rewrittenResume.modules) ? rewrittenResume.modules : [])
    .map((item) => ({
      type: String(item?.type || "").trim(),
      title: String(item?.title || "").trim(),
      content: String(item?.content || "").trim()
    }))
    .filter((item) => item.title || item.content);

  return {
    rewrite: {
      original: String(rewrite.original || "").trim(),
      reason: String(rewrite.reason || "").trim(),
      rewritten: String(rewrite.rewritten || "").trim()
    },
    sectionRewrites,
    modules
  };
}

function normalizePercent(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function renderOptimizationEmpty() {
  emptyOptimization?.classList.remove("hidden");
  optimizationContent?.classList.add("hidden");
  if (strengthHighlightsList) strengthHighlightsList.innerHTML = "";
  if (rewriteCompareList) rewriteCompareList.innerHTML = "";
  if (missingKeywordsList) missingKeywordsList.innerHTML = "";
  if (riskFlagsList) riskFlagsList.innerHTML = "";
  if (interviewQuestionList) interviewQuestionList.innerHTML = "";
  renderReviewRewriteResult(null);
}

function renderOptimizationResult(result) {
  emptyOptimization?.classList.add("hidden");
  optimizationContent?.classList.remove("hidden");
  if (overallScoreValue) overallScoreValue.textContent = String(result.overallScore);
  if (oneLineRoastText) oneLineRoastText.textContent = result.oneLineRoast;

  if (strengthHighlightsList) {
    strengthHighlightsList.innerHTML = result.strengths.length
      ? result.strengths.map((item) => `<span class="keyword-tag keyword-tag--positive">${escapeHtml(item)}</span>`).join("")
      : `<span class="keyword-tag keyword-tag--muted">当前亮点会在分析后自动提炼。</span>`;
  }

  if (rewriteCompareList) {
    rewriteCompareList.innerHTML = result.rewrites.map((item, index) => `
      <article class="rewrite-compare-card">
        <div class="rewrite-compare-card__col rewrite-compare-card__col--original">
          <p class="rewrite-grid__label">原文片段 ${index + 1}</p>
          <div class="rewrite-compare-card__copy">${escapeHtml(item.original || "原文片段缺失")}</div>
        </div>
        <div class="rewrite-compare-card__center">
          <span class="rewrite-problem-tag">${escapeHtml(item.problem || "问题不够具体")}</span>
        </div>
        <div class="rewrite-compare-card__col rewrite-compare-card__col--optimized">
          <p class="rewrite-grid__label">优化版本</p>
          <div class="rewrite-compare-card__copy">${escapeHtml(item.optimized || "优化版缺失")}</div>
          <div class="rewrite-compare-card__actions">
            <button type="button" class="mini-button" data-copy-optimized="${escapeAttribute(item.optimized || "")}">采用</button>
          </div>
        </div>
      </article>
    `).join("");
  }

  if (rewriteCompareList) {
    rewriteCompareList.innerHTML = result.rewrites.map((item, index) => `
      <article class="rewrite-compare-card">
        <div class="rewrite-compare-card__top">
          <div>
            <p class="rewrite-grid__label">优先优化片段 ${index + 1}</p>
            <strong>保持事实不变，提升表达力度与职业感</strong>
          </div>
          <span class="rewrite-problem-tag">${escapeHtml(item.problem || "问题描述暂未生成")}</span>
        </div>
        <div class="rewrite-compare-card__grid">
          <div class="rewrite-compare-card__col rewrite-compare-card__col--original">
            <p class="rewrite-grid__label">原文片段</p>
            <div class="rewrite-compare-card__copy">${escapeHtml(item.original || "原文片段缺失")}</div>
          </div>
          <div class="rewrite-compare-card__col rewrite-compare-card__col--optimized">
            <p class="rewrite-grid__label">职业化改写</p>
            <div class="rewrite-compare-card__copy">${escapeHtml(item.optimized || "优化版缺失")}</div>
          </div>
        </div>
        <div class="rewrite-compare-card__actions">
          <button type="button" class="mini-button" data-copy-optimized="${escapeAttribute(item.optimized || "")}">复制优化版</button>
        </div>
      </article>
    `).join("");
  }

  if (missingKeywordsList) {
    missingKeywordsList.innerHTML = result.missingKeywords.length
      ? result.missingKeywords.map((keyword) => `<span class="keyword-tag">${escapeHtml(keyword)}</span>`).join("")
      : `<span class="keyword-tag keyword-tag--muted">当前没识别出明显缺失关键词</span>`;
  }

  if (riskFlagsList) {
    riskFlagsList.innerHTML = result.riskFlags.length
      ? result.riskFlags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join("")
      : `<li>当前没有识别出特别突出的高风险表述。</li>`;
  }
}

function renderReviewRewriteResult(result) {
  if (rewriteResumeSummary) {
    rewriteResumeSummary.innerHTML = result
      ? `
        <article class="rewrite-resume-highlight">
          <p class="rewrite-grid__label">关键重写说明</p>
          <strong>${escapeHtml(result.rewrite.reason || "已根据原始事实重写整份简历。")}</strong>
          <p>${escapeHtml(result.rewrite.rewritten || "整份重写草案已经生成，可在下方逐模块查看。")}</p>
        </article>
      `
      : `
        <article class="rewrite-resume-highlight rewrite-resume-highlight--muted">
          <p class="rewrite-grid__label">整份重写草案</p>
          <p>上传 PDF 并完成分析后，这里会展示按原始事实重写的整份简历草案。</p>
        </article>
      `;
  }

  if (rewriteResumeModules) {
    rewriteResumeModules.innerHTML = result?.modules?.length
      ? result.modules.map((item, index) => `
        <article class="rewrite-resume-card">
          <div class="rewrite-resume-card__head">
            <strong>${escapeHtml(item.title || `模块 ${index + 1}`)}</strong>
            <span>${escapeHtml(item.type || "module")}</span>
          </div>
          <p>${escapeHtml(item.content || "")}</p>
        </article>
      `).join("")
      : "";
  }
}

function renderStructuredOptimizationDecorations(result) {
  if (!result) return;

  if (rewriteCompareList) {
    rewriteCompareList.innerHTML = result.rewrites.map((item, index) => `
      <article class="rewrite-compare-card">
        <div class="rewrite-compare-card__top">
          <div>
            <p class="rewrite-grid__label">优先优化片段 ${index + 1}</p>
            <strong>保持事实不变，提升表达力度与职业感</strong>
          </div>
          <span class="rewrite-problem-tag">${escapeHtml(item.problem || "问题描述暂未生成")}</span>
        </div>
        <div class="rewrite-compare-card__grid">
          <div class="rewrite-compare-card__col rewrite-compare-card__col--original">
            <p class="rewrite-grid__label">原文片段</p>
            <div class="rewrite-compare-card__copy">${escapeHtml(item.original || "原文片段缺失")}</div>
          </div>
          <div class="rewrite-compare-card__col rewrite-compare-card__col--optimized">
            <p class="rewrite-grid__label">职业化改写</p>
            <div class="rewrite-compare-card__copy">${escapeHtml(item.optimized || "优化版缺失")}</div>
          </div>
        </div>
        <div class="rewrite-compare-card__actions">
          <button type="button" class="mini-button" data-copy-optimized="${escapeAttribute(item.optimized || "")}">复制优化版</button>
        </div>
      </article>
    `).join("");
  }

  if (interviewQuestionList) {
    interviewQuestionList.innerHTML = result.interviewQuestions.length
      ? result.interviewQuestions.map((item, index) => `
          <li>
            <strong>问题 ${index + 1}：${escapeHtml(item.question)}</strong>
            <p>${escapeHtml(item.intent || "用于考察事实边界、职责深度和结果表达是否站得住。")}</p>
          </li>
        `).join("")
      : `<li><strong>模拟提问暂未生成</strong><p>重新分析后，这里会给出更贴近岗位的真实追问。</p></li>`;
  }
}

function renderStructuredRewriteDecorations(result) {
  if (!result) return;

  if (rewriteResumeSummary) {
    rewriteResumeSummary.innerHTML = `
      <article class="rewrite-resume-highlight">
        <div class="rewrite-resume-highlight__head">
          <div>
            <p class="rewrite-grid__label">整份重写策略</p>
            <strong>${escapeHtml(result.rewrite.reason || "已根据原始事实重写整份简历。")}</strong>
          </div>
          <span class="rewrite-resume-highlight__badge">可直接落版</span>
        </div>
        <div class="rewrite-resume-highlight__grid">
          <div class="rewrite-resume-highlight__block">
            <p class="rewrite-grid__label">原片段</p>
            <p>${escapeHtml(result.rewrite.original || "原片段未单独提取，已直接生成整份重写草案。")}</p>
          </div>
          <div class="rewrite-resume-highlight__block rewrite-resume-highlight__block--accent">
            <p class="rewrite-grid__label">重写后</p>
            <p>${escapeHtml(result.rewrite.rewritten || "整份重写草案已经生成，可在下方逐模块查看。")}</p>
          </div>
        </div>
      </article>
    `;
  }

  if (rewriteResumeModules) {
    const strategyCards = result.sectionRewrites.length
      ? `
        <section class="rewrite-resume-group">
          <p class="rewrite-grid__label">关键模块改写策略</p>
          <div class="rewrite-resume-strategy-list">
            ${result.sectionRewrites.map((item, index) => `
              <article class="rewrite-resume-strategy-card">
                <div class="rewrite-resume-card__head">
                  <strong>${escapeHtml(item.title || `模块 ${index + 1}`)}</strong>
                  <span>Rewrite Focus</span>
                </div>
                <p class="rewrite-resume-strategy-card__reason">${escapeHtml(item.reason || "围绕岗位价值重新组织表达。")}</p>
                <p>${escapeHtml(item.rewritten || "")}</p>
              </article>
            `).join("")}
          </div>
        </section>
      `
      : "";

    const moduleCards = result.modules.length
      ? `
        <section class="rewrite-resume-group">
          <p class="rewrite-grid__label">可直接落版的模块文案</p>
          <div class="rewrite-resume-list">
            ${result.modules.map((item, index) => `
              <article class="rewrite-resume-card">
                <div class="rewrite-resume-card__head">
                  <strong>${escapeHtml(item.title || `模块 ${index + 1}`)}</strong>
                  <span>${escapeHtml(item.type || "module")}</span>
                </div>
                <p>${escapeHtml(item.content || "")}</p>
              </article>
            `).join("")}
          </div>
        </section>
      `
      : `<section class="rewrite-resume-group"><p class="hint">暂未生成可直接落版的模块文案。</p></section>`;

    rewriteResumeModules.innerHTML = `${strategyCards}${moduleCards}`;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

window.__resumeDemo = {
  renderResume,
  mountPdfExportPreview
};
