const LIST_CONFIG = {
  education: {
    container: "#educationList",
    fields: [
      ["school", "学校"],
      ["degree", "学位"],
      ["major", "专业"],
      ["start", "开始时间"],
      ["end", "结束时间"]
    ]
  },
  experience: {
    container: "#experienceList",
    fields: [
      ["company", "公司"],
      ["title", "职位"],
      ["start", "开始时间"],
      ["end", "结束时间"],
      ["description", "工作内容"]
    ]
  },
  projects: {
    container: "#projectsList",
    fields: [
      ["name", "项目名"],
      ["role", "角色"],
      ["start", "开始时间"],
      ["end", "结束时间"],
      ["description", "项目描述"],
      ["url", "链接"]
    ]
  }
};

const PREVIEW_PERSONAL_FIELDS = [
  ["personal.fullName", "姓名"],
  ["personal.chineseName", "中文名"],
  ["personal.firstName", "名"],
  ["personal.lastName", "姓"],
  ["personal.email", "邮箱"],
  ["personal.phone", "电话"],
  ["personal.location", "所在地"],
  ["personal.linkedin", "LinkedIn"],
  ["personal.github", "GitHub"],
  ["personal.portfolio", "作品集/个人网站"]
];

let profile = null;
let pendingImport = null;

init();

async function init() {
  const stored = await chrome.storage.local.get(["profile", "fieldMemory"]);
  profile = withProfileDefaults(stored.profile || {});
  renderProfile(profile);
  renderMemoryCount(stored.fieldMemory || {});
  renderMemoryList(stored.fieldMemory || {});

  document.querySelector("#saveProfile").addEventListener("click", saveProfile);
  document.querySelector("#importResume").addEventListener("click", importResume);
  document.querySelector("#confirmImport").addEventListener("click", confirmImportPreview);
  document.querySelector("#cancelImport").addEventListener("click", cancelImportPreview);
  document.querySelector("#confirmImportBottom").addEventListener("click", confirmImportPreview);
  document.querySelector("#cancelImportBottom").addEventListener("click", cancelImportPreview);
  document.querySelector("#clearMemory").addEventListener("click", clearMemory);
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.add;
      profile[key] = [...(profile[key] || []), {}];
      renderList(key, profile[key]);
    });
  });
}

function renderProfile(data) {
  document.querySelectorAll("[data-path]").forEach((input) => {
    input.value = getPath(data, input.dataset.path) || "";
  });
  document.querySelector("#allowSensitiveAutofill").checked = Boolean(data.preferences?.allowSensitiveAutofill);
  document.querySelector("#skills").value = Array.isArray(data.skills) ? data.skills.join(", ") : "";
  document.querySelector("#languages").value = Array.isArray(data.languages) ? data.languages.join(", ") : "";
  document.querySelector("#certifications").value = Array.isArray(data.certifications) ? data.certifications.join(", ") : "";
  Object.keys(LIST_CONFIG).forEach((key) => renderList(key, data[key] || []));
}

function renderList(key, items) {
  const config = LIST_CONFIG[key];
  const container = document.querySelector(config.container);
  container.innerHTML = "";

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "item-card";
    const fields = config.fields.map(([field, label]) => {
      const isLong = ["description"].includes(field);
      const value = item[field] || "";
      return `<label>${label}${isLong ? `<textarea data-list="${key}" data-index="${index}" data-field="${field}" rows="3">${escapeHtml(value)}</textarea>` : `<input data-list="${key}" data-index="${index}" data-field="${field}" value="${escapeHtml(value)}">`}</label>`;
    }).join("");

    card.innerHTML = `
      <div class="item-header">
        <strong>${index + 1}</strong>
        <button data-remove="${key}" data-index="${index}">删除</button>
      </div>
      <div class="grid">${fields}</div>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      profile[key].splice(Number(button.dataset.index), 1);
      renderList(key, profile[key]);
    });
  });
}

async function saveProfile() {
  const nextProfile = collectProfileFromForm();
  profile = nextProfile;
  await chrome.storage.local.set({ profile });
  showToast("Profile 已保存");
}

async function importResume() {
  const fileInput = document.querySelector("#resumeFile");
  const status = document.querySelector("#importStatus");
  const file = fileInput.files?.[0];
  if (!file) {
    showToast("请先选择简历文件");
    return;
  }

  status.textContent = "正在本地解析...";
  hideImportPreview();
  try {
    const parser = window.ResumeParser || ResumeParser;
    const parsed = await parser.parseFile(file);
    const current = collectProfileFromForm();
    const previewProfile = mergeImportedProfile(current, parsed.profile, parsed.fileName);
    pendingImport = {
      parsed,
      profile: previewProfile
    };
    renderImportPreview(previewProfile, parsed);
    status.textContent = `已解析 ${parsed.fileName}，提取 ${parsed.stats.textLength} 字，识别 ${parsed.stats.recognized} 项；请先预览确认，确认前不会保存。`;
    showToast("请检查导入预览");
  } catch (error) {
    console.error(error);
    status.textContent = "解析失败，可尝试复制简历文字到简历文本区";
    showToast("简历解析失败");
  }
}

function renderImportPreview(data, parsed) {
  const preview = document.querySelector("#importPreview");
  const warning = document.querySelector("#importWarning");
  const summary = document.querySelector("#importPreviewSummary");
  const fields = document.querySelector("#importPreviewFields");
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter(Boolean) : [];

  warning.hidden = warnings.length === 0;
  warning.innerHTML = warnings.map((item) => `<div>${escapeHtml(item)}</div>`).join("");
  summary.textContent = `文件：${parsed.fileName}｜提取 ${parsed.stats.textLength} 字｜识别 ${parsed.stats.recognized} 项`;
  fields.innerHTML = buildImportPreviewFields(data);
  preview.hidden = false;
  preview.scrollIntoView({ behavior: "smooth", block: "start" });
}

function buildImportPreviewFields(data) {
  const personalFields = PREVIEW_PERSONAL_FIELDS.map(([path, label]) => {
    return `<label>${label}<input data-preview-path="${path}" value="${escapeHtml(getPath(data, path) || "")}"></label>`;
  }).join("");

  return `
    <section class="preview-section">
      <h3>基础信息</h3>
      <div class="grid">${personalFields}</div>
    </section>
    <section class="preview-section">
      <h3>个人简介</h3>
      <label class="wide">Summary<textarea data-preview-path="summary" rows="4">${escapeHtml(data.summary || "")}</textarea></label>
    </section>
    ${buildPreviewList("education", data.education || [])}
    ${buildPreviewList("experience", data.experience || [])}
    ${buildPreviewList("projects", data.projects || [])}
    <section class="preview-section">
      <h3>技能/语言/证书</h3>
      <div class="grid">
        <label class="wide">技能<textarea data-preview-array="skills" rows="3">${escapeHtml((data.skills || []).join(", "))}</textarea></label>
        <label class="wide">语言<textarea data-preview-array="languages" rows="2">${escapeHtml((data.languages || []).join(", "))}</textarea></label>
        <label class="wide">证书<textarea data-preview-array="certifications" rows="2">${escapeHtml((data.certifications || []).join(", "))}</textarea></label>
      </div>
    </section>
  `;
}

function buildPreviewList(key, items) {
  const config = LIST_CONFIG[key];
  const titleMap = {
    education: "教育经历",
    experience: "工作/实习经历",
    projects: "项目经历"
  };
  const cards = items.length ? items.map((item, index) => {
    const controls = config.fields.map(([field, label]) => {
      const value = item[field] || "";
      if (field === "description") {
        return `<label class="wide">${label}<textarea data-preview-list="${key}" data-index="${index}" data-field="${field}" rows="3">${escapeHtml(value)}</textarea></label>`;
      }
      return `<label>${label}<input data-preview-list="${key}" data-index="${index}" data-field="${field}" value="${escapeHtml(value)}"></label>`;
    }).join("");
    return `<article class="item-card"><div class="item-header"><strong>${index + 1}</strong></div><div class="grid">${controls}</div></article>`;
  }).join("") : `<p class="hint">未识别到${titleMap[key]}，你可以确认后在下方 Profile 里手动添加。</p>`;

  return `
    <section class="preview-section">
      <h3>${titleMap[key]}</h3>
      <div class="list">${cards}</div>
    </section>
  `;
}

async function confirmImportPreview() {
  if (!pendingImport) {
    showToast("没有待确认的导入内容");
    return;
  }
  const nextProfile = collectProfileFromPreview(pendingImport.profile);
  profile = withProfileDefaults(nextProfile);
  renderProfile(profile);
  await chrome.storage.local.set({ profile });
  hideImportPreview();
  document.querySelector("#importStatus").textContent = `已确认并保存 ${pendingImport.parsed.fileName}`;
  pendingImport = null;
  showToast("导入内容已确认并保存");
}

function cancelImportPreview() {
  pendingImport = null;
  hideImportPreview();
  document.querySelector("#importStatus").textContent = "已取消导入，Profile 未保存任何变更";
  showToast("已取消导入");
}

function hideImportPreview() {
  const preview = document.querySelector("#importPreview");
  if (preview) preview.hidden = true;
}

function collectProfileFromPreview(baseProfile) {
  const next = structuredClone(baseProfile);
  document.querySelectorAll("[data-preview-path]").forEach((input) => {
    setPath(next, input.dataset.previewPath, input.value.trim());
  });
  document.querySelectorAll("[data-preview-array]").forEach((input) => {
    next[input.dataset.previewArray] = splitCsvTextarea(input.value);
  });

  Object.keys(LIST_CONFIG).forEach((key) => {
    next[key] = [];
  });
  document.querySelectorAll("[data-preview-list]").forEach((input) => {
    const listName = input.dataset.previewList;
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    next[listName] ||= [];
    next[listName][index] ||= {};
    next[listName][index][field] = input.value.trim();
  });
  return next;
}

async function clearMemory() {
  await chrome.storage.local.set({ fieldMemory: {} });
  renderMemoryCount({});
  renderMemoryList({});
  showToast("记忆库已清空");
}

function renderMemoryCount(memory) {
  document.querySelector("#memoryCount").textContent = `当前已记住 ${Object.keys(memory).length} 个字段`;
}

function renderMemoryList(memory) {
  const container = document.querySelector("#memoryList");
  if (!container) return;
  const entries = Object.entries(memory || {});
  if (!entries.length) {
    container.innerHTML = '<p class="hint">No saved memory yet.</p>';
    return;
  }

  container.innerHTML = entries.map(([key, entry]) => `
    <article class="memory-item" data-memory-key="${escapeHtml(key)}">
      <label><input type="checkbox" data-memory-toggle ${entry.disabled ? "" : "checked"}> Enabled</label>
      <div><strong>${escapeHtml(entry.label || key)}</strong></div>
      <div class="hint">Section: ${escapeHtml(entry.section || "profile")} | Source: ${escapeHtml(entry.profilePath || "literal")}</div>
      <textarea data-memory-value rows="2">${escapeHtml(entry.value || "")}</textarea>
      <div class="actions-row">
        <button data-memory-save>Edit</button>
        <button data-memory-delete>Delete</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-memory-save]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = button.closest("[data-memory-key]");
      const key = item.dataset.memoryKey;
      const next = { ...(await getMemory()) };
      next[key] = {
        ...(next[key] || {}),
        value: item.querySelector("[data-memory-value]").value.trim(),
        disabled: !item.querySelector("[data-memory-toggle]").checked,
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({ fieldMemory: next });
      renderMemoryCount(next);
      renderMemoryList(next);
      showToast("Memory updated");
    });
  });

  container.querySelectorAll("[data-memory-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = button.closest("[data-memory-key]");
      const key = item.dataset.memoryKey;
      const next = { ...(await getMemory()) };
      delete next[key];
      await chrome.storage.local.set({ fieldMemory: next });
      renderMemoryCount(next);
      renderMemoryList(next);
      showToast("Memory deleted");
    });
  });
}

async function getMemory() {
  const { fieldMemory } = await chrome.storage.local.get(["fieldMemory"]);
  return fieldMemory || {};
}

function collectProfileFromForm() {
  const current = structuredClone(profile);
  document.querySelectorAll("[data-path]").forEach((input) => {
    setPath(current, input.dataset.path, input.value.trim());
  });
  current.preferences ||= {};
  current.preferences.allowSensitiveAutofill = document.querySelector("#allowSensitiveAutofill").checked;
  current.skills = splitCsvTextarea(document.querySelector("#skills").value);
  current.languages = splitCsvTextarea(document.querySelector("#languages").value);
  current.certifications = splitCsvTextarea(document.querySelector("#certifications").value);
  Object.keys(LIST_CONFIG).forEach((key) => {
    current[key] = [];
  });
  document.querySelectorAll("[data-list]").forEach((input) => {
    const listName = input.dataset.list;
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    current[listName] ||= [];
    current[listName][index] ||= {};
    current[listName][index][field] = input.value.trim();
  });
  return current;
}

function mergeImportedProfile(current, imported, fileName) {
  const merged = mergePreferCurrent(withProfileDefaults(imported), withProfileDefaults(current));
  if (imported.resumeText) merged.resumeText = imported.resumeText;
  merged.resumeFiles = [
    ...(Array.isArray(current.resumeFiles) ? current.resumeFiles : []),
    { name: fileName, importedAt: new Date().toISOString() }
  ].slice(-10);
  return merged;
}

function mergePreferCurrent(imported, current) {
  if (Array.isArray(imported)) return current?.length ? current : imported;
  if (!imported || typeof imported !== "object") return current || imported || "";
  const merged = { ...imported, ...(current || {}) };
  Object.keys(imported).forEach((key) => {
    merged[key] = mergePreferCurrent(imported[key], current?.[key]);
  });
  return merged;
}

function withProfileDefaults(data) {
  return mergeDefaults({
    personal: {
      firstName: "",
      middleName: "",
      lastName: "",
      fullName: "",
      chineseName: "",
      preferredName: "",
      email: "",
      phone: "",
      location: "",
      address: "",
      nationality: "",
      linkedin: "",
      github: "",
      portfolio: ""
    },
    summary: "",
    workAuthorization: "",
    visaSponsorship: "",
    relocation: "",
    desiredSalary: "",
    noticePeriod: "",
    availabilityDate: "",
    education: [],
    experience: [],
    projects: [],
    certifications: [],
    languages: [],
    skills: [],
    resumeText: "",
    resumeFiles: [],
    preferences: {
      allowSensitiveAutofill: false
    }
  }, data);
}

function mergeDefaults(defaults, current) {
  if (Array.isArray(defaults)) return Array.isArray(current) ? current : defaults;
  if (!defaults || typeof defaults !== "object") return current ?? defaults;
  const merged = { ...defaults, ...(current || {}) };
  Object.keys(defaults).forEach((key) => {
    merged[key] = mergeDefaults(defaults[key], current?.[key]);
  });
  return merged;
}

function splitCsvTextarea(value) {
  return String(value || "").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function getPath(source, path) {
  return path.split(".").reduce((value, key) => (value ? value[key] : ""), source);
}

function setPath(target, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const parent = keys.reduce((node, key) => {
    node[key] ||= {};
    return node[key];
  }, target);
  parent[last] = value;
}

function showToast(text) {
  const toast = document.querySelector("#toast");
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}
