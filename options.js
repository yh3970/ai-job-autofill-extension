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

let profile = null;

init();

async function init() {
  const stored = await chrome.storage.local.get(["profile", "fieldMemory"]);
  profile = withProfileDefaults(stored.profile || {});
  renderProfile(profile);
  renderMemoryCount(stored.fieldMemory || {});

  document.querySelector("#saveProfile").addEventListener("click", saveProfile);
  document.querySelector("#importResume").addEventListener("click", importResume);
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

  status.textContent = "正在本地解析...";
  try {
    const parser = window.ResumeParser || ResumeParser;
    const parsed = await parser.parseFile(file);
    profile = mergeImportedProfile(collectProfileFromForm(), parsed.profile, parsed.fileName);
    renderProfile(profile);
    await chrome.storage.local.set({ profile });
    status.textContent = `已导入 ${parsed.fileName}，提取 ${parsed.stats.textLength} 字，识别 ${parsed.stats.recognized} 项`;
    showToast("已从简历自动填写并保存 Profile");
  } catch (error) {
    console.error(error);
    status.textContent = "解析失败，可尝试复制简历文字到简历文本区";
    showToast("简历解析失败");
  }
}

async function clearMemory() {
  await chrome.storage.local.set({ fieldMemory: {} });
  renderMemoryCount({});
  showToast("记忆库已清空");
}

function renderMemoryCount(memory) {
  document.querySelector("#memoryCount").textContent = `当前已记住 ${Object.keys(memory).length} 个字段`;
}

function collectProfileFromForm() {
  const current = structuredClone(profile);
  document.querySelectorAll("[data-path]").forEach((input) => {
    setPath(current, input.dataset.path, input.value.trim());
  });
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
    resumeFiles: []
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
