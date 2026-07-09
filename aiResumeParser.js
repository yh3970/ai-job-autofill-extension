window.AiResumeParser = (() => {
  const DEFAULT_SETTINGS = {
    enabled: false,
    apiStyle: "responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
    prompt: ""
  };

  const DEFAULT_PROMPT = `You are ApplyPilot's resume-to-profile parser.

Return strict JSON only. Do not include markdown fences, comments, or explanations.

Task:
Parse the resume text into the exact JSON schema below. The resume may be Chinese or English.

Accuracy rules:
- Do not invent information.
- Extract the candidate name only from the top identity/header area.
- Never use section headings such as "Education", "Internship Experience", "Project Experience", "教育背景", "实习经历", "科研经历", "校园经历", or "项目经历" as a person's name.
- Phone must be the real contact phone number. Do not use dates, student IDs, postal codes, project metrics, GPA, or random number sequences.
- Separate education, internship/work experience, research/campus/project experience carefully.
- Put employer/company internships and jobs in "experience".
- Put standalone product, research, course, or competition projects in "projects" only when there is a clear project/research/campus/project section or clear project title.
- If there is no clear project section, leave "projects" empty. Do not move internship bullet points into projects just because a bullet contains the word "project".
- Preserve useful bullet points in description fields.
- Arrays must be arrays even when empty.
- Use date strings exactly as found when possible, such as "2023.09", "2025-07", "Present", or "至今".

JSON schema:
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
  "workAuthorization": "",
  "visaSponsorship": "",
  "relocation": "",
  "desiredSalary": "",
  "noticePeriod": "",
  "availabilityDate": "",
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
    const value = settings || {};
    return {
      ...DEFAULT_SETTINGS,
      ...value,
      enabled: Boolean(value.enabled),
      apiStyle: value.apiStyle === "chat" ? "chat" : "responses",
      baseUrl: String(value.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, ""),
      model: String(value.model || DEFAULT_SETTINGS.model).trim(),
      apiKey: String(value.apiKey || "").trim(),
      prompt: String(value.prompt || "")
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
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }]
          }
        ],
        temperature: 0.1
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
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: "Return strict JSON only. Do not include markdown fences." },
          { role: "user", content: prompt }
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
      throw new Error(`AI API returned non-JSON response: ${text.slice(0, 240)}`);
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
      workAuthorization: textField(input.workAuthorization),
      visaSponsorship: textField(input.visaSponsorship),
      relocation: textField(input.relocation),
      desiredSalary: textField(input.desiredSalary),
      noticePeriod: textField(input.noticePeriod),
      availabilityDate: textField(input.availabilityDate),
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
    }).filter((item) => Object.values(item).some(Boolean)).slice(0, 30);
  }

  function normalizeArray(value) {
    if (Array.isArray(value)) return value.map(textField).filter(Boolean).slice(0, 100);
    if (typeof value === "string") return value.split(/[,，;；、\n]/).map(textField).filter(Boolean).slice(0, 100);
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
    normalizeSettings,
    normalizeProfile
  };
})();
