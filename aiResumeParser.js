window.AiResumeParser = (() => {
  const DEFAULT_SETTINGS = {
    enabled: false,
    apiStyle: "responses",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-evolving",
    apiKey: "",
    prompt: ""
  };

  const DEFAULT_PROMPT = `You are ApplyPilot's resume parser. Parse the resume text into strict JSON only.

Rules:
- Return only one JSON object. No markdown fences. No comments.
- Do not invent information not present in the resume.
- For Chinese resumes, understand headings such as 教育背景、教育经历、实习经历、工作经历、项目经历、技能、证书、语言能力.
- Never treat section headings such as 教育背景 or 项目经历 as a person's name.
- Extract the real candidate name from the top identity/header area when possible.
- Phone should be the real contact phone number only. Prefer valid Chinese mobile numbers such as 1xxxxxxxxxx when present. Do not use student IDs, dates, postal codes, or random number sequences.
- Separate internship/work experience from project experience. Company/employer items go to experience; standalone product/research/course projects go to projects.
- Extract start/end dates for education, work, and projects when present. Use strings such as 2025.07, 2025-07, or 至今.
- Preserve useful bullet points in description fields.
- Arrays must be arrays even when empty.

Return this exact schema:
{
  "personal": {
    "firstName": "",
    "middleName": "",
    "lastName": "",
    "fullName": "",
    "chineseName": "",
    "preferredName": "",
    "email": "",
    "phone": "",
    "location": "",
    "address": "",
    "nationality": "",
    "linkedin": "",
    "github": "",
    "portfolio": ""
  },
  "summary": "",
  "education": [
    {"school": "", "degree": "", "major": "", "start": "", "end": "", "description": ""}
  ],
  "experience": [
    {"company": "", "title": "", "start": "", "end": "", "description": ""}
  ],
  "projects": [
    {"name": "", "role": "", "start": "", "end": "", "description": "", "url": ""}
  ],
  "skills": [],
  "languages": [],
  "certifications": [],
  "resumeText": ""
}`;

  async function parseResumeText(text, settings = {}) {
    const resolved = normalizeSettings(settings);
    validateSettings(resolved);
    const prompt = buildPrompt(text, resolved.prompt || DEFAULT_PROMPT);
    const responseText = resolved.apiStyle === "chat"
      ? await callChatCompletions(prompt, resolved)
      : await callResponses(prompt, resolved);
    const json = extractJsonObject(responseText);
    return normalizeProfile(json, text);
  }

  function normalizeSettings(settings) {
    return {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
      baseUrl: String(settings?.baseUrl || DEFAULT_SETTINGS.baseUrl).replace(/\/+$/, ""),
      model: String(settings?.model || DEFAULT_SETTINGS.model).trim(),
      apiKey: String(settings?.apiKey || "").trim(),
      apiStyle: settings?.apiStyle === "chat" ? "chat" : "responses"
    };
  }

  function validateSettings(settings) {
    if (!settings.apiKey) throw new Error("AI resume parsing is enabled but API key is empty.");
    if (!settings.baseUrl) throw new Error("AI resume parsing is enabled but Base URL is empty.");
    if (!settings.model) throw new Error("AI resume parsing is enabled but model is empty.");
  }

  function buildPrompt(resumeText, parserPrompt) {
    return `${parserPrompt}\n\n# Resume text\n${String(resumeText || "").slice(0, 60000)}`;
  }

  async function callResponses(prompt, settings) {
    const response = await fetch(`${settings.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: prompt
              }
            ]
          }
        ]
      })
    });
    const data = await parseApiResponse(response);
    if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
    const parts = [];
    for (const item of data.output || []) {
      for (const content of item.content || []) {
        if (typeof content.text === "string") parts.push(content.text);
      }
    }
    return parts.join("\n");
  }

  async function callChatCompletions(prompt, settings) {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          {
            role: "system",
            content: "Return strict JSON only. Do not include markdown fences."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.1
      })
    });
    const data = await parseApiResponse(response);
    return data.choices?.[0]?.message?.content || "";
  }

  async function parseApiResponse(response) {
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      throw new Error(`AI API returned non-JSON response: ${text.slice(0, 200)}`);
    }
    if (!response.ok) {
      const message = data.error?.message || data.message || text.slice(0, 300) || response.statusText;
      throw new Error(`AI API request failed (${response.status}): ${message}`);
    }
    return data;
  }

  function extractJsonObject(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("AI returned an empty response.");
    try {
      return JSON.parse(raw);
    } catch (error) {
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const candidate = fenced ? fenced[1].trim() : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
      if (!candidate || !candidate.startsWith("{")) throw error;
      return JSON.parse(candidate);
    }
  }

  function normalizeProfile(value, resumeText) {
    const input = value && typeof value === "object" ? value : {};
    const personal = input.personal && typeof input.personal === "object" ? input.personal : {};
    return {
      personal: {
        firstName: textField(personal.firstName),
        middleName: textField(personal.middleName),
        lastName: textField(personal.lastName),
        fullName: textField(personal.fullName),
        chineseName: textField(personal.chineseName),
        preferredName: textField(personal.preferredName),
        email: textField(personal.email),
        phone: textField(personal.phone),
        location: textField(personal.location),
        address: textField(personal.address),
        nationality: textField(personal.nationality),
        linkedin: textField(personal.linkedin),
        github: textField(personal.github),
        portfolio: textField(personal.portfolio)
      },
      summary: textField(input.summary),
      education: normalizeList(input.education, ["school", "degree", "major", "start", "end", "description"]),
      experience: normalizeList(input.experience, ["company", "title", "start", "end", "description"]),
      projects: normalizeList(input.projects, ["name", "role", "start", "end", "description", "url"]),
      skills: normalizeArray(input.skills),
      languages: normalizeArray(input.languages),
      certifications: normalizeArray(input.certifications),
      resumeText: textField(input.resumeText) || String(resumeText || "")
    };
  }

  function normalizeList(value, fields) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const source = item && typeof item === "object" ? item : {};
      const next = {};
      fields.forEach((field) => {
        next[field] = textField(source[field]);
      });
      return next;
    }).filter((item) => Object.values(item).some(Boolean)).slice(0, 20);
  }

  function normalizeArray(value) {
    if (Array.isArray(value)) return value.map(textField).filter(Boolean).slice(0, 80);
    if (typeof value === "string") return value.split(/[,，;；、\n]/).map(textField).filter(Boolean).slice(0, 80);
    return [];
  }

  function textField(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
    return "";
  }

  return {
    DEFAULT_SETTINGS,
    DEFAULT_PROMPT,
    parseResumeText,
    normalizeSettings
  };
})();
