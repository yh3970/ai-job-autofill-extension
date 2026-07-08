(function () {
  const MEMORY_THRESHOLD = 0.55;
  const ONTOLOGY_THRESHOLD = 0.55;

  const STOP_WORDS = new Set([
    "the", "a", "an", "of", "to", "for", "in", "on", "and", "or", "your", "you", "please", "enter",
    "select", "choose", "input", "field", "form", "信息", "请输入", "选择", "填写"
  ]);

  const PROFILE_CONCEPTS = [
    concept("personal.email", ["email", "email address", "mail", "e-mail", "\u90ae\u7bb1", "\u7535\u5b50\u90ae\u4ef6"]),
    concept("personal.phone", ["phone", "mobile", "telephone", "cell", "contact number", "\u7535\u8bdd", "\u624b\u673a", "\u8054\u7cfb\u65b9\u5f0f"]),
    concept("personal.firstName", ["first name", "given name", "forename", "\u540d", "\u540d\u5b57"]),
    concept("personal.middleName", ["middle name", "middle initial"]),
    concept("personal.lastName", ["last name", "family name", "surname", "\u59d3"]),
    concept("personal.fullName", ["full name", "legal name", "candidate name", "applicant name", "\u59d3\u540d", "\u5168\u540d"]),
    concept("personal.chineseName", ["chinese name", "name in chinese", "\u4e2d\u6587\u540d", "\u4e2d\u6587\u59d3\u540d"]),
    concept("personal.preferredName", ["preferred name", "nickname", "chosen name", "\u5e38\u7528\u540d", "\u82f1\u6587\u540d"]),
    concept("personal.location", ["location", "current location", "city", "where are you based", "\u6240\u5728\u5730", "\u57ce\u5e02", "\u5c45\u4f4f\u5730"]),
    concept("personal.address", ["address", "street address", "mailing address", "\u5730\u5740", "\u901a\u8baf\u5730\u5740"]),
    concept("personal.nationality", ["nationality", "citizenship", "country of citizenship", "\u56fd\u7c4d", "\u516c\u6c11\u8eab\u4efd"]),
    concept("personal.linkedin", ["linkedin", "linkedin profile", "\u9886\u82f1"]),
    concept("personal.github", ["github", "github profile", "code repository"]),
    concept("personal.portfolio", ["portfolio", "website", "personal site", "homepage", "\u4f5c\u54c1\u96c6", "\u4e2a\u4eba\u7f51\u7ad9"]),
    concept("summary", ["summary", "profile summary", "cover letter", "about you", "why interested", "motivation", "\u4e2a\u4eba\u7b80\u4ecb", "\u81ea\u6211\u4ecb\u7ecd", "\u6c42\u804c\u4fe1"]),
    concept("skillsText", ["skills", "technical skills", "technologies", "tech stack", "\u6280\u80fd", "\u6280\u672f\u6808", "\u4e13\u4e1a\u6280\u80fd"]),
    concept("languagesText", ["language", "languages", "spoken languages", "\u8bed\u8a00", "\u8bed\u8a00\u80fd\u529b"]),
    concept("certificationsText", ["certification", "certificate", "license", "credential", "\u8bc1\u4e66", "\u8d44\u683c", "\u8d44\u8d28"]),
    concept("workAuthorization", ["work authorization", "authorized to work", "work permit", "visa status", "\u5de5\u4f5c\u8bb8\u53ef", "\u5de5\u4f5c\u7b7e\u8bc1"]),
    concept("visaSponsorship", ["visa sponsorship", "need sponsorship", "require sponsorship", "\u7b7e\u8bc1\u62c5\u4fdd", "\u662f\u5426\u9700\u8981\u62c5\u4fdd"]),
    concept("relocation", ["relocation", "willing to relocate", "move for job", "\u642c\u8fc1", "\u5f02\u5730", "\u63a5\u53d7\u8c03\u52a8"]),
    concept("desiredSalary", ["salary expectation", "expected salary", "compensation", "\u671f\u671b\u85aa\u8d44", "\u85aa\u8d44\u8981\u6c42"]),
    concept("noticePeriod", ["notice period", "current notice", "time to join", "\u5230\u5c97\u65f6\u95f4", "\u901a\u77e5\u671f"]),
    concept("availabilityDate", ["available date", "start date", "earliest start", "\u53ef\u5165\u804c\u65e5\u671f", "\u5f00\u59cb\u5de5\u4f5c"])
  ];

  const ARRAY_CONCEPTS = {
    education: [
      concept("school", ["school", "university", "college", "institution", "academy", "\u5b66\u6821", "\u9662\u6821", "\u5927\u5b66"]),
      concept("degree", ["degree", "qualification", "level of education", "diploma", "\u5b66\u4f4d", "\u5b66\u5386"]),
      concept("major", ["major", "field of study", "discipline", "program", "\u4e13\u4e1a", "\u7814\u7a76\u65b9\u5411"]),
      concept("start", ["start date", "from", "begin", "enrolled", "\u5f00\u59cb\u65f6\u95f4", "\u5165\u5b66"]),
      concept("end", ["end date", "to", "graduation", "graduated", "\u7ed3\u675f\u65f6\u95f4", "\u6bd5\u4e1a\u65f6\u95f4"]),
      concept("description", ["description", "details", "honors", "courses", "\u63cf\u8ff0", "\u8be6\u60c5", "\u8363\u8a89"])
    ],
    experience: [
      concept("company", ["company", "employer", "organization", "workplace", "\u516c\u53f8", "\u5355\u4f4d", "\u673a\u6784"]),
      concept("title", ["title", "position", "role", "job title", "\u804c\u4f4d", "\u5c97\u4f4d", "\u89d2\u8272"]),
      concept("start", ["start date", "from", "begin", "\u5f00\u59cb\u65f6\u95f4"]),
      concept("end", ["end date", "to", "finish", "\u7ed3\u675f\u65f6\u95f4"]),
      concept("description", ["responsibilities", "description", "achievement", "duties", "\u5de5\u4f5c\u5185\u5bb9", "\u804c\u8d23", "\u4e1a\u7ee9", "\u63cf\u8ff0"])
    ]
  };

  function matchProfileField(field, memory) {
    const text = buildFieldText(field);
    const memoryMatch = matchMemory(text, memory, "profile");
    const ontologyMatch = bestConcept(text, PROFILE_CONCEPTS, ONTOLOGY_THRESHOLD);
    if (memoryMatch && (!ontologyMatch || memoryMatch.score >= ontologyMatch.score)) return memoryMatch;
    return ontologyMatch;
  }

  function matchArrayField(field, section, memory) {
    const text = field.fieldTextNormalized || field.text || "";
    const memoryMatch = matchMemory(text, memory, section);
    const concepts = ARRAY_CONCEPTS[section] || ARRAY_CONCEPTS.experience;
    const ontologyMatch = bestConcept(text, concepts, ONTOLOGY_THRESHOLD);
    if (memoryMatch && (!ontologyMatch || memoryMatch.score >= ontologyMatch.score)) return memoryMatch;
    return ontologyMatch;
  }

  function createMemoryEntry(field, value, profilePath, section) {
    const text = buildFieldText(field);
    return {
      type: profilePath ? "profilePath" : "literal",
      profilePath: profilePath || "",
      value: profilePath ? "" : value,
      label: text,
      section: section || field.section || "profile",
      vector: vectorToPairs(vectorize(text)),
      updatedAt: Date.now()
    };
  }

  function matchMemory(text, memory, section) {
    if (!memory) return null;
    const query = vectorize(text);
    let best = null;
    for (const entry of Object.values(memory)) {
      if (!entry || entry.disabled || (!entry.profilePath && !entry.value)) continue;
      if (entry.section && section && entry.section !== section && entry.section !== "profile") continue;
      const entryVector = entry.vector ? pairsToVector(entry.vector) : vectorize(entry.label || "");
      const score = cosine(query, entryVector);
      if (score >= MEMORY_THRESHOLD && (!best || score > best.score)) {
        best = {
          key: entry.profilePath || "",
          value: entry.value || "",
          source: "memory",
          score,
          confidence: score,
          memoryEntry: entry
        };
      }
    }
    return best;
  }

  function bestConcept(text, concepts, threshold) {
    const query = vectorize(text);
    let best = null;
    for (const item of concepts) {
      const score = cosine(query, item.vector);
      if (score >= threshold && (!best || score > best.score)) {
        best = { key: item.key, source: "semantic", score, confidence: score };
      }
    }
    return best;
  }

  function concept(key, phrases) {
    return { key, phrases, vector: vectorize(phrases.join(" ")) };
  }

  function buildFieldText(field) {
    return normalize([field.text, field.normalizedText, field.section].filter(Boolean).join(" "));
  }

  function vectorize(text) {
    const vector = new Map();
    for (const token of tokenize(text)) {
      vector.set(token, (vector.get(token) || 0) + weightToken(token));
    }
    return vector;
  }

  function tokenize(text) {
    const normalized = normalize(text);
    const latin = normalized.match(/[a-z0-9]+/g) || [];
    const cjk = normalized.match(/[\u4e00-\u9fa5]/g) || [];
    const cjkBigrams = [];
    for (let i = 0; i < cjk.length - 1; i += 1) cjkBigrams.push(cjk[i] + cjk[i + 1]);
    return [...latin, ...cjk, ...cjkBigrams].filter((token) => !STOP_WORDS.has(token));
  }

  function weightToken(token) {
    if (token.length >= 6) return 1.4;
    if (/[\u4e00-\u9fa5]/.test(token)) return 1.2;
    return 1;
  }

  function cosine(left, right) {
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const value of left.values()) leftNorm += value * value;
    for (const value of right.values()) rightNorm += value * value;
    for (const [token, value] of left.entries()) dot += value * (right.get(token) || 0);
    if (!leftNorm || !rightNorm) return 0;
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  function vectorToPairs(vector) {
    return Array.from(vector.entries());
  }

  function pairsToVector(pairs) {
    return new Map(pairs);
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }


  window.ApplyPilotSemanticMatcher = {
    matchProfileField,
    matchArrayField,
    createMemoryEntry,
    vectorize,
    cosine,
    thresholds: {
      autoFill: 0.85,
      suggest: 0.55
    }
  };
})();
