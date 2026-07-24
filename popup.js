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
  const [response, monitor] = await Promise.all([
    sendToBackground({ type: "APPLYPILOT_TAB_SCAN", tabId: tab?.id }),
    sendToBackground({ type: "APPLYPILOT_GET_MONITOR_STATS" })
  ]);

  if (!response?.ok) {
    setStatus(scanFailureMessage(response));
    return;
  }

  const diagnostics = response.diagnostics || {};
  setStatus(`发现 ${response.count || 0} 个可填写字段：已识别标签 ${diagnostics.labelledFields || 0} 个，未识别 ${diagnostics.unlabelledFields || 0} 个。`);
  setResult([
    `顶层 ${diagnostics.topFrameFields || 0}｜iframe ${diagnostics.iframeFields || 0}｜Shadow DOM ${diagnostics.shadowFields || 0}`,
    frameAccessText(diagnostics),
    monitorSummary(monitor)
  ].filter(Boolean).join("\n"));
}

async function fillCurrentPage() {
  setResult("");
  setStatus("正在识别表格、日期控件和重复经历区块...");
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
  const coverage = profileCoverageSummary(response.debugRows || []);
  setStatus(`扫描 ${response.scanned || 0} 个字段，匹配 ${diagnostics.matched || 0} 个，已填充 ${response.filled || 0} 个，建议确认 ${response.suggestions || 0} 个。`);
  const failurePreview = formatFailurePreview(response.uncertain || []);
  const monitorText = response.monitoring?.enabled
    ? `自动学习监测已开启：剩余失败 ${response.monitoring.pendingFailures || 0} 个。你手动补填或修改后会自动写入记忆库。`
    : "自动学习监测未开启，可在设置中启用。";
  setResult([
    `顶层 ${diagnostics.topFrameFields || 0}｜iframe ${diagnostics.iframeFields || 0}｜Shadow DOM ${diagnostics.shadowFields || 0}`,
    `已识别标签 ${diagnostics.labelledFields || 0}｜未识别标签 ${diagnostics.unlabelledFields || 0}`,
    `跳过 ${diagnostics.skipped || 0}｜敏感字段跳过 ${diagnostics.sensitiveSkipped || 0}｜执行失败 ${diagnostics.failed || 0}`,
    coverage,
    `通用适配补填 ${diagnostics.universalFilled || 0}｜重复经历补填 ${diagnostics.repeatedFallbackFilled || 0}｜站点适配补填 ${diagnostics.djiAdapterFilled || 0}`,
    monitorText,
    frameAccessText(diagnostics),
    failurePreview
  ].filter(Boolean).join("\n"));
}

async function learnCurrentPage() {
  setResult("");
  setStatus("正在把当前页面已有答案写入记忆库...");
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
  setResult("下次遇到相同或语义相近的问题时，会优先使用记忆。自动学习开启时，点击智能填充后无需再次点击此按钮。若页面有多个 iframe，确认框可能逐帧出现。");
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

function monitorSummary(response) {
  if (!response?.ok) return "";
  const stats = response.stats || {};
  return `记忆库 ${response.memoryCount || 0} 条｜自动学习 ${stats.totalLearned || 0} 次｜修正 ${stats.correctedAutofill || 0} 次｜失败后补填 ${stats.recoveredAfterFailure || 0} 次。`;
}

function profileCoverageSummary(debugRows) {
  const rows = Array.isArray(debugRows) ? debugRows : [];
  const noValue = rows.filter((row) => row.reason === "no-value").length;
  const lowConfidence = rows.filter((row) => row.reason === "low-confidence").length;
  const sensitive = rows.filter((row) => row.reason === "sensitive-field-requires-explicit-preference").length;
  if (!noValue && !lowConfidence && !sensitive) return "";
  return `未找到可用 Profile/记忆值 ${noValue}｜低置信度 ${lowConfidence}｜敏感信息保护 ${sensitive}`;
}

function formatFailurePreview(uncertain) {
  const failures = uncertain
    .filter((item) => item.reason && !String(item.reason).startsWith("missing-add-"))
    .slice(0, 4);
  if (!failures.length) return "";
  return `失败示例：\n${failures.map((item) => {
    const label = String(item.label || item.debug?.label || item.source || "字段").replace(/\s+/g, " ").slice(0, 38);
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
    "isolated-action-failed": "普通填写方式失败",
    "universal-target-not-found": "通用适配器找不到原字段",
    "universal-action-failed": "通用适配器填写失败",
    "repeated-target-not-found": "重复经历区块中的字段已被页面替换",
    "repeated-action-failed": "重复经历字段填写失败",
    "adapter-target-not-found": "站点适配器找不到原字段"
  };
  return labels[reason] || reason;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setResult(text) {
  resultEl.textContent = text;
}
