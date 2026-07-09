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
      ["description", "项目描述"],
      ["url", "链接"]
    ]
  }
};

const AI_RESUME_SETTINGS_KEY = "aiResumeSettings";

let profile = null;
let aiResumeSettings = null;

init();

async function init() {
  const stored = await chrome.storage.local.get(["profile", "fieldMemory", AI_RESUME_SETTINGS_KEY]);
  profile = withProfileDefaults(stored.profile || {});
  aiResumeSettings = normalizeAiSettings(stored[AI_RESUME_SETTINGS_KEY] || {});
  renderProfile(profile);
  renderAiResumeSettings(aiResumeSettings);
  renderMemoryCount(stored.fieldMemory || {});
  renderMemoryList(stored.fieldMemory || {});

  document.querySelector("#saveProfile").addEventListener("click", saveProfile);
  document.querySelector("#importResume").addEventListener("click", importResume);
  document.querySelector("#saveAiResumeSettings").addEventListener("click", saveAiResumeSettings);
  document.querySelector("#clearMemory").addEventListener("click", clearMemory);
  document.querySelectorAll("[data-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.add;
      profile[key] = [...(profile[key] || []), {}];
      renderList(key, profile[key]);
    });
  });
}

function renderAiResumeSettings(settings) {
  document.querySelector("#aiResumeEnabled").checked = Boolean(settings.enabled);
  document.querySelector("#aiResumeApiStyle").value = settings.apiStyle || "responses";
  document.querySelector("#aiResumeBaseUrl").value = settings.baseUrl || "";
  document.querySelector("#aiResumeModel").value = settings.model || "";
  document.querySelector("#aiResumeApiKey").value = settings.apiKey || "";
  document.querySelector("#aiResumePrompt").value = settings.prompt || "";
}

async function saveAiResumeSettings() {
  aiResumeSettings = collectAiResumeSettings();
  await chrome.storage.local.set({ [AI_RESUME_SETTINGS_KEY]: aiResumeSettings });
  document.querySelector("#aiResumeSettingsStatus").textContent = "AI 设置已保存";
  setTimeout(() => {
    document.querySelector("#aiResumeSettingsStatus").textContent = "";
  }, 1800);
  showToast("AI 设置已保存");
}

function collectAiResumeSettings() {
  return normalizeAiSettings({
    enabled: document.querySelector("#aiResumeEnabled").checked,
    apiStyle: document.querySelector("#aiResumeApiStyle").value,
    baseUrl: document.querySelector("#aiResumeBaseUrl").value,
    model: document.querySelector("#aiResumeModel").value,
    apiKey: document.querySelector("#aiResumeApiKey").value,
    prompt: document.querySelector("#aiResumePrompt").value
  });
}

function normalizeAiSettings(value) {
  const defaults = window.AiResumeParser?.DEFAULT_SETTINGS || {
    enabled: false,
    apiStyle: "responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
    prompt: ""
  };
  return {
    ...defaults,
    ...(value || {}),
    enabled: Boolean(value?.enabled),
    apiStyle: value?.apiStyle === "chat" ? "chat" : "responses",
    baseUrl: String(value?.baseUrl || defaults.baseUrl).trim().replace(/\/+$/, ""),
    model: String(value?.model || defaults.model).trim(),
    apiKey: String(value?.apiKey || "").trim(),
    prompt: String(value?.prompt || "")
  };
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
  const nextProfile = structuredClone(profile);
  document.querySelectorAll("[data-path]").forEach((input) => {
    setPath(nextProfile, input.dataset.path, input.value.trim());
  });
  nextProfile.preferences ||= {};
  nextProfile.preferences.allowSensitiveAutofill = document.querySelector("#allowSensitiveAutofill").checked;
  nextProfile.skills = document.querySelector("#skills").value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  nextProfile.languages = document.querySelector("#languages").value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  nextProfile.certifications = document.querySelector("#certifications").value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);

  Object.keys(LIST_CONFIG).forEach((key) => {
    nextProfile[key] = [];
  });
  document.querySelectorAll("[data-list]").forEach((input) => {
    const listName = input.dataset.list;
    const index = Number(input.dataset.index);
    const field = input.dataset.field;
    nextProfile[listName] ||= [];
    nextProfile[listName][index] ||= {};
    nextProfile[listName][index][field] = input.value.trim();
  });

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

  status.textContent = "正在本地提取简历文本...";
  try {
    const parser = window.ResumeParser || ResumeParser;
    const parsed = await parser.parseFile(file);
    let importedProfile = parsed.profile;
    let source = "本地解析";
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter(Boolean) : [];
    aiResumeSettings = collectAiResumeSettings();
    await chrome.storage.local.set({ [AI_RESUME_SETTINGS_KEY]: aiResumeSettings });

    if (aiResumeSettings.enabled) {
      if (!aiResumeSettings.apiKey) {
        warnings.push("已启用 AI 解析，但 API Key 为空，本次使用本地解析。");
      } else if (!parsed.text || parsed.text.replace(/\s/g, "").length < 80) {
        warnings.push("简历可用文本过少。若这是扫描版/图片 PDF，需要 OCR；本次使用本地解析。");
      } else {
        const confirmed = window.confirm("ApplyPilot will send the extracted resume text to your configured AI API for parsing. API Key is stored only in local browser storage. Continue?");
        if (confirmed) {
          status.textContent = "正在调用 AI 解析简历...";
          try {
            const aiParser = window.AiResumeParser || AiResumeParser;
            importedProfile = await aiParser.parseResumeText(parsed.text, aiResumeSettings);
            source = "AI 解析";
          } catch (error) {
            console.error("ApplyPilot AI resume parsing failed", error);
            warnings.push(`AI 解析失败，已回退本地解析：${error.message || error}`);
          }
        } else {
          warnings.push("用户取消发送简历文本到 AI API，本次使用本地解析。");
        }
      }
    }

    profile = mergeImportedProfile(collectProfileFromForm(), importedProfile, parsed.fileName);
    renderProfile(profile);
    await chrome.storage.local.set({ profile });
    const warningText = warnings.length ? ` 提示：${warnings.join("；")}` : "";
    status.textContent = `已通过${source}导入 ${parsed.fileName}，提取 ${parsed.stats.textLength} 字，已写入 Profile。${warningText}`;
    showToast(`已通过${source}填写 Profile`);
  } catch (error) {
    console.error(error);
    status.textContent = "解析失败，可尝试复制简历文字到简历文本区";
    showToast("简历解析失败");
  }
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
  current.skills = document.querySelector("#skills").value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  current.languages = document.querySelector("#languages").value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
  current.certifications = document.querySelector("#certifications").value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
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
  const merged = mergePreferImported(withProfileDefaults(imported), withProfileDefaults(current));
  merged.preferences = current.preferences || merged.preferences || {};
  if (imported.resumeText) merged.resumeText = imported.resumeText;
  merged.resumeFiles = [
    ...(Array.isArray(current.resumeFiles) ? current.resumeFiles : []),
    { name: fileName, importedAt: new Date().toISOString() }
  ].slice(-10);
  return merged;
}

function mergePreferImported(imported, current) {
  if (Array.isArray(imported)) return imported.length ? imported : (Array.isArray(current) ? current : []);
  if (!imported || typeof imported !== "object") return imported || current || "";
  const merged = { ...(current || {}), ...imported };
  Object.keys({ ...(current || {}), ...imported }).forEach((key) => {
    merged[key] = mergePreferImported(imported[key], current?.[key]);
  });
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
