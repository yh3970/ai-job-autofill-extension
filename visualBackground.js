importScripts("background.js");

const VISUAL_SETTINGS_KEY = "aiResumeSettings";
const MAX_VISUAL_TILES = 14;
const VISUAL_CONFIDENCE_THRESHOLD = 0.9;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "APPLYPILOT_VISUAL_FILL") return false;

  runVisualFill(message.tabId, message.profile || {})
    .then(sendResponse)
    .catch((error) => {
      console.error("ApplyPilot visual fill failed", error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
});

async function runVisualFill(tabId, profile) {
  if (!Number.isInteger(tabId)) return { ok: false, error: "missing-tab-id" };

  const stored = await chrome.storage.local.get([VISUAL_SETTINGS_KEY]);
  const settings = normalizeVisualSettings(stored[VISUAL_SETTINGS_KEY] || {});
  validateVisualSettings(settings);

  const tab = await chrome.tabs.get(tabId);
  if (!tab?.active) return { ok: false, error: "visual-tab-not-active" };

  const prepared = await sendTopFrame(tabId, {
    type: "APPLYPILOT_VISUAL_PREPARE",
    profile
  });
  if (!prepared?.ok || !prepared.fieldCount) {
    await safeCleanup(tabId, prepared?.originalScrollY || 0);
    return { ok: false, error: prepared?.error || "visual-no-fields" };
  }

  const positions = buildScrollPositions(prepared.pageHeight, prepared.viewportHeight);
  const mappingById = new Map();
  const tileErrors = [];
  let processedTiles = 0;

  try {
    for (let tileIndex = 0; tileIndex < positions.length; tileIndex += 1) {
      const scrollY = positions[tileIndex];
      const scrolled = await sendTopFrame(tabId, {
        type: "APPLYPILOT_VISUAL_SCROLL",
        scrollY
      });
      if (!scrolled?.ok) {
        tileErrors.push({ tileIndex, error: scrolled?.error || "visual-scroll-failed" });
        continue;
      }

      await delay(260);
      let screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 72
      });

      try {
        const visibleFields = (prepared.fields || []).filter((field) => intersectsViewport(field, scrollY, prepared.viewportHeight));
        if (!visibleFields.length) continue;
        const result = await analyzeVisualTile({
          screenshot,
          tileIndex,
          scrollY,
          pageHeight: prepared.pageHeight,
          viewportHeight: prepared.viewportHeight,
          fields: visibleFields,
          profileCatalog: prepared.profileCatalog || [],
          settings
        });
        processedTiles += 1;
        for (const mapping of result.mappings || []) {
          if (!mapping?.id || !mapping?.profilePath) continue;
          const confidence = Number(mapping.confidence || 0);
          if (confidence < VISUAL_CONFIDENCE_THRESHOLD) continue;
          if (!(prepared.profileCatalog || []).includes(mapping.profilePath)) continue;
          const previous = mappingById.get(mapping.id);
          if (!previous || confidence > previous.confidence) {
            mappingById.set(mapping.id, {
              id: mapping.id,
              profilePath: mapping.profilePath,
              confidence,
              reason: String(mapping.reason || "visual-exact-label")
            });
          }
        }
      } catch (error) {
        tileErrors.push({ tileIndex, error: error?.message || String(error) });
      } finally {
        screenshot = null;
      }
    }

    const mappings = Array.from(mappingById.values());
    const applied = await sendTopFrame(tabId, {
      type: "APPLYPILOT_VISUAL_APPLY",
      profile,
      mappings
    });

    return {
      ok: Boolean(applied?.ok),
      mode: "ephemeral-visual-full-page",
      fieldCount: prepared.fieldCount,
      tileCount: positions.length,
      processedTiles,
      mapped: mappings.length,
      filled: Number(applied?.filled || 0),
      failed: Number(applied?.failed || 0),
      skipped: Number(applied?.skipped || 0),
      uncertain: applied?.uncertain || [],
      tileErrors: tileErrors.slice(0, 8),
      privacy: {
        localStorage: false,
        fileSaved: false,
        apiStoreRequested: false
      }
    };
  } finally {
    await safeCleanup(tabId, prepared.originalScrollY || 0);
  }
}

async function analyzeVisualTile({ screenshot, tileIndex, scrollY, pageHeight, viewportHeight, fields, profileCatalog, settings }) {
  const prompt = buildVisualPrompt({ tileIndex, scrollY, pageHeight, viewportHeight, fields, profileCatalog });
  const response = await fetch(`${settings.baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.model,
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: screenshot, detail: "high" }
          ]
        }
      ]
    })
  });

  const data = await parseApiResponse(response);
  const text = extractOutputText(data);
  const parsed = extractJsonObject(text);
  return {
    mappings: Array.isArray(parsed.mappings) ? parsed.mappings : []
  };
}

function buildVisualPrompt({ tileIndex, scrollY, pageHeight, viewportHeight, fields, profileCatalog }) {
  const candidates = fields.map((field) => ({
    id: field.id,
    control: field.control,
    sectionHint: field.sectionHint,
    rowHint: field.rowHint,
    domTextHint: field.domTextHint
  }));

  return `You are ApplyPilot's visual form-field mapper.
This is viewport tile ${tileIndex + 1} of a long job-application webpage.
Every candidate form control has a bright red badge such as AP12 immediately beside it.
Map only clearly visible badges to one allowed Profile path.

Strict safety rules:
- Use the screenshot's visible human label as the source of truth.
- DOM hints may be incomplete or wrong; use them only as secondary evidence.
- Never map 学院/院系, 学历类型/培养方式, 实验室, 领域方向/研究方向, 导师, GPA, 成绩排名 unless an exact allowed path for that concept exists.
- Never map one Profile path to several unrelated fields.
- For repeated education/work/project records, use row order and section headings to select the correct numeric index.
- For a two-box 起止时间/date range, map the left badge to start and the right badge to end.
- Omit ambiguous fields. Do not guess.
- Return strict JSON only, with no markdown.

Page position: scrollY=${scrollY}, viewportHeight=${viewportHeight}, pageHeight=${pageHeight}.
Visible candidate metadata:
${JSON.stringify(candidates)}

Allowed Profile paths:
${JSON.stringify(profileCatalog)}

Return exactly:
{"mappings":[{"id":"AP1","profilePath":"education.0.school","confidence":0.98,"reason":"visible label 学校名称"}]}`;
}

function normalizeVisualSettings(value) {
  return {
    enabled: Boolean(value?.enabled),
    apiStyle: value?.apiStyle === "chat" ? "chat" : "responses",
    baseUrl: String(value?.baseUrl || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, ""),
    model: String(value?.visualModel || value?.model || "").trim(),
    apiKey: String(value?.apiKey || "").trim()
  };
}

function validateVisualSettings(settings) {
  if (!settings.enabled) throw new Error("visual-ai-not-enabled");
  if (settings.apiStyle !== "responses") throw new Error("visual-requires-responses-api");
  if (!settings.apiKey) throw new Error("visual-api-key-empty");
  if (!settings.baseUrl) throw new Error("visual-base-url-empty");
  if (!settings.model) throw new Error("visual-model-empty");
}

function buildScrollPositions(pageHeight, viewportHeight) {
  const height = Math.max(1, Number(pageHeight || 1));
  const viewport = Math.max(300, Number(viewportHeight || 800));
  if (height <= viewport) return [0];

  const step = Math.max(260, Math.floor(viewport * 0.72));
  const positions = [];
  for (let y = 0; y < height - viewport; y += step) positions.push(y);
  positions.push(Math.max(0, height - viewport));

  const unique = Array.from(new Set(positions.map((value) => Math.round(value))));
  if (unique.length <= MAX_VISUAL_TILES) return unique;

  const sampled = [];
  for (let index = 0; index < MAX_VISUAL_TILES; index += 1) {
    sampled.push(unique[Math.round(index * (unique.length - 1) / (MAX_VISUAL_TILES - 1))]);
  }
  return Array.from(new Set(sampled));
}

function intersectsViewport(field, scrollY, viewportHeight) {
  const top = Number(field.pageY || 0);
  const bottom = top + Number(field.height || 1);
  const viewportTop = Number(scrollY || 0) - 80;
  const viewportBottom = Number(scrollY || 0) + Number(viewportHeight || 0) + 80;
  return bottom >= viewportTop && top <= viewportBottom;
}

async function sendTopFrame(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload, { frameId: 0 });
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function safeCleanup(tabId, originalScrollY) {
  try {
    await sendTopFrame(tabId, {
      type: "APPLYPILOT_VISUAL_CLEANUP",
      originalScrollY
    });
  } catch (error) {
    console.debug("ApplyPilot visual cleanup skipped", error);
  }
}

async function parseApiResponse(response) {
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error(`visual-api-non-json: ${raw.slice(0, 180)}`);
  }
  if (!response.ok) {
    const message = data.error?.message || data.message || raw.slice(0, 260) || response.statusText;
    throw new Error(`visual-api-failed-${response.status}: ${message}`);
  }
  return data;
}

function extractOutputText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("visual-ai-empty-response");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    if (!candidate?.startsWith("{")) throw new Error("visual-ai-invalid-json");
    return JSON.parse(candidate);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
