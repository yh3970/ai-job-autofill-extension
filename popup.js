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
  const response = await sendToBackground({ type: "APPLYPILOT_TAB_SCAN", tabId: tab?.id });
  if (!response?.ok) {
    setStatus(scanFailureMessage(response));
    return;
  }

  const diagnostics = response.diagnostics || {};
  setStatus(`发现 ${response.count || 0} 个可填写字段：顶层 ${diagnostics.topFrameFields || 0}，iframe ${diagnostics.iframeFields || 0}，Shadow DOM ${diagnostics.shadowFields || 0}。`);
  setResult(frameAccessText(diagnostics));
}

async function fillCurrentPage() {
  setResult("");
  setStatus("正在等待表单稳定并扫描所有可访问框架...");
  const tab = await getActiveTab();
  const { profile, fieldMemory } = await chrome.storage.local.get(["profile", "fieldMemory"]);
  const response = await sendToBackground({
    type: "APPLYPILOT_TAB_FILL",
    tabId: tab?.id,
    profile,
    fieldMemory
  });

  if (!response?.ok) {
    setStatus(scanFailureMessage(response, "填充失败"));
    return;
  }

  const diagnostics = response.diagnostics || {};
  setStatus(`扫描 ${response.scanned || 0} 个字段，匹配 ${diagnostics.matched || 0} 个，已填充 ${response.filled || 0} 个，建议确认 ${response.suggestions || 0} 个。`);
  const failurePreview = formatFailurePreview(response.uncertain || []);
  setResult([
    `顶层 ${diagnostics.topFrameFields || 0}｜iframe ${diagnostics.iframeFields || 0}｜Shadow DOM ${diagnostics.shadowFields || 0}`,
    `跳过 ${diagnostics.skipped || 0}｜敏感字段跳过 ${diagnostics.sensitiveSkipped || 0}｜执行失败 ${diagnostics.failed || 0}`,
    frameAccessText(diagnostics),
    failurePreview
  ].filter(Boolean).join("\n"));
}

async function learnCurrentPage() {
  setResult("");
  setStatus("正在学习所有可访问表单中的已填写内容...");
  const tab = await getActiveTab();
  const { profile, fieldMemory } = await chrome.storage.local.get(["profile", "fieldMemory"]);
  const response = await sendToBackground({
    type: "APPLYPILOT_TAB_LEARN",
    tabId: tab?.id,
    profile,
    fieldMemory
  });

  if (!response?.ok) {
    setStatus(scanFailureMessage(response, "学习失败"));
    return;
  }
  setStatus(`已记住 ${response.learned || 0} 个字段。`);
  setResult("下次遇到同站点或相同问题时，会优先使用已确认记忆。若页面有多个 iframe，确认框可能逐帧出现。");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sendToBackground(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

function scanFailureMessage(response, prefix = "这个页面暂时无法扫描") {
  if (response?.error === "no-accessible-form-frames") {
    return `${prefix}。请刷新页面，并确认不是 chrome://、扩展商店或浏览器内部页面。`;
  }
  return `${prefix}。请刷新网申页面和扩展后再试一次。`;
}

function frameAccessText(diagnostics) {
  if (!diagnostics?.totalFrames) return "";
  const inaccessible = diagnostics.inaccessibleFrames || 0;
  return `可访问框架 ${diagnostics.accessibleFrames || 0}/${diagnostics.totalFrames}${inaccessible ? `，另有 ${inaccessible} 个框架受浏览器权限限制` : ""}。`;
}

function formatFailurePreview(uncertain) {
  const failures = uncertain
    .filter((item) => item.reason && !String(item.reason).startsWith("missing-add-"))
    .slice(0, 3);
  if (!failures.length) return "";
  return `失败示例：\n${failures.map((item) => {
    const label = String(item.label || item.debug?.label || item.source || "字段").replace(/\s+/g, " ").slice(0, 34);
    return `• ${label}：${translateReason(item.reason)}`;
  }).join("\n")}`;
}

function translateReason(reason) {
  const labels = {
    "target-not-found": "网页刷新后字段被替换",
    "main-world-target-not-found": "主页面中未找到字段",
    "main-world-text-rejected": "网页框架拒绝写入文本",
    "main-world-no-editable-control": "没有找到真实输入框",
    "main-world-custom-option-not-found": "下拉选项中未找到匹配值",
    "main-world-native-option-not-found": "原生下拉框无匹配选项",
    "main-world-bridge-timeout": "页面环境通信超时",
    "main-world-radio-option-not-found": "单选项中无匹配值",
    "main-world-checkbox-value-unknown": "无法把答案转换为是/否",
    "isolated-action-failed": "普通填写方式失败"
  };
  return labels[reason] || reason;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setResult(text) {
  resultEl.textContent = text;
}
