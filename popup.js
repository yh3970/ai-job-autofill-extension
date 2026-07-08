const statusEl = document.querySelector("#status");
const resultEl = document.querySelector("#result");
const fillButton = document.querySelector("#fillPage");
const learnButton = document.querySelector("#learnPage");
const optionsButton = document.querySelector("#openOptions");

init();

async function init() {
  optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
  fillButton.addEventListener("click", fillCurrentPage);
  learnButton.addEventListener("click", learnCurrentPage);

  const tab = await getActiveTab();
  const response = await sendToTab(tab.id, { type: "APPLYPILOT_SCAN" });
  if (!response?.ok) {
    setStatus("这个页面暂时无法扫描。刷新页面后再试一次。");
    return;
  }
  const sections = response.sections;
  if (sections) {
    setStatus(`Agent 已理解页面：基础字段 ${sections.basicFields}，教育 ${sections.educationRows} 行，经历 ${sections.internshipRows} 行，长文本 ${sections.longTextFields} 个。`);
  } else {
    setStatus(`发现 ${response.count} 个可填写字段。`);
  }
}

async function fillCurrentPage() {
  setResult("");
  setStatus("Agent 正在理解页面并规划动作队列...");
  const tab = await getActiveTab();
  const { profile, fieldMemory } = await chrome.storage.local.get(["profile", "fieldMemory"]);
  const response = await sendToTab(tab.id, { type: "APPLYPILOT_FILL", profile, fieldMemory });
  if (!response?.ok) {
    setStatus("填充失败。请确认页面已经加载完成。");
    return;
  }
  setStatus(`Agent 已执行 ${response.actions || 0} 个动作，填充 ${response.filled} 个字段。`);
  if (response.sections || response.planSummary) {
    const sections = response.sections || {};
    const plan = response.planSummary || {};
    setResult(`页面结构：教育 ${sections.educationRows || 0} 行，经历 ${sections.internshipRows || 0} 行。动作计划：新增/点击 ${plan.click || 0} 次，输入 ${plan.inputText || 0} 次，下拉/日期 ${Number(plan.selectOption || 0) + Number(plan.selectDate || 0)} 次。`);
  }
  if (response.uncertain?.length) {
    setResult(`${resultEl.textContent} 还有 ${response.uncertain.length} 个动作不确定，可手动补充后点“记住当前填写内容”。`);
  }
}

async function learnCurrentPage() {
  setResult("");
  setStatus("正在学习当前页面的已填写内容...");
  const tab = await getActiveTab();
  const { profile, fieldMemory } = await chrome.storage.local.get(["profile", "fieldMemory"]);
  const response = await sendToTab(tab.id, { type: "APPLYPILOT_LEARN", profile, fieldMemory });
  if (!response?.ok) {
    setStatus("学习失败。请确认页面已经加载完成。");
    return;
  }
  setStatus(`已记住 ${response.learned} 个字段。`);
  setResult("下次遇到同站点或相同问题时，会优先使用记忆内容。");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setResult(text) {
  resultEl.textContent = text;
}
