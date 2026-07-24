(function () {
  const MEMORY_THRESHOLD = 0.85;
  const ONTOLOGY_THRESHOLD = 0.65;

  const STOP_WORDS = new Set([
    "the", "a", "an", "of", "to", "for", "in", "on", "and", "or", "your", "you", "please", "enter",
    "select", "choose", "input", "field", "form", "required", "information", "信息", "请输入", "选择", "填写", "必填"
  ]);

  const PROFILE_CONCEPTS = [
    concept("personal.email", ["email", "email address", "private email", "personal email", "mail", "e-mail", "邮箱", "私人邮箱", "个人邮箱", "电子邮件"]),
    concept("personal.phone", ["phone", "mobile", "telephone", "cell", "contact number", "mobile number", "电话号码", "手机号", "电话", "手机", "手机号码"]),
    concept("personal.firstName", ["first name", "given name", "forename", "名", "名字"]),
    concept("personal.middleName", ["middle name", "middle initial"]),
    concept("personal.lastName", ["last name", "family name", "surname", "姓"]),
    concept("personal.fullName", ["full name", "legal name", "candidate name", "applicant name", "name", "姓名", "全名"]),
    concept("personal.chineseName", ["chinese name", "name in chinese", "中文名", "中文姓名"]),
    concept("personal.preferredName", ["preferred name", "nickname", "chosen name", "常用名", "英文名"]),
    concept("personal.gender", ["gender", "sex", "性别"]),
    concept("personal.birthDate", ["date of birth", "birth date", "birthday", "dob", "出生日期", "生日"]),
    concept("personal.ethnicity", ["ethnicity", "ethnic group", "nation", "民族"]),
    concept("personal.maritalStatus", ["marital status", "marriage status", "婚姻状况", "婚姻状态"]),
    concept("personal.politicalStatus", ["political status", "political affiliation", "政治面貌"]),
    concept("personal.idType", ["id type", "identity document type", "document type", "证件类型", "身份证件类型"]),
    concept("personal.idNumber", ["id number", "identity number", "document number", "certificate number", "证件号码", "身份证号", "身份证号码"]),
    concept("personal.location", ["location", "current location", "city", "where are you based", "所在地", "城市", "居住地"]),
    concept("personal.currentResidence", ["current residence", "current address", "present residence", "现居住地", "现居住址", "当前居住地"]),
    concept("personal.householdLocation", ["household registration", "hukou", "registered residence", "户口所在地", "户籍所在地", "户籍"]),
    concept("personal.nativePlace", ["native place", "place of origin", "籍贯"]),
    concept("personal.address", ["address", "street address", "mailing address", "地址", "通讯地址"]),
    concept("personal.nationality", ["nationality", "citizenship", "country of citizenship", "country region", "国籍", "国籍地区", "国家地区"]),
    concept("personal.highestDegree", ["highest degree", "highest education", "education level", "academic degree", "最高学历", "学历", "学位"]),
    concept("personal.latestMajor", ["major", "field of study", "专业", "所学专业"]),
    concept("personal.latestSchool", ["school", "university", "college", "学校", "毕业院校"]),
    concept("personal.linkedin", ["linkedin", "linkedin profile", "领英"]),
    concept("personal.github", ["github", "github profile", "code repository"]),
    concept("personal.portfolio", ["portfolio", "website", "personal site", "homepage", "作品集", "个人网站"]),
    concept("summary", ["summary", "profile summary", "cover letter", "about you", "why interested", "motivation", "个人简介", "自我介绍", "求职信"]),
    concept("skillsText", ["skills", "technical skills", "technologies", "tech stack", "技能", "技术栈", "专业技能"]),
    concept("languagesText", ["language", "languages", "spoken languages", "语言", "语言能力"]),
    concept("certificationsText", ["certification", "certificate", "license", "credential", "证书", "资格", "资质"]),
    concept("workAuthorization", ["work authorization", "authorized to work", "work permit", "visa status", "工作许可", "工作签证"]),
    concept("visaSponsorship", ["visa sponsorship", "need sponsorship", "require sponsorship", "签证担保", "是否需要担保"]),
    concept("relocation", ["relocation", "willing to relocate", "move for job", "搬迁", "异地", "接受调动", "城市调剂"]),
    concept("desiredSalary", ["salary expectation", "expected salary", "compensation", "期望薪资", "薪资要求"]),
    concept("noticePeriod", ["notice period", "current notice", "time to join", "到岗时间", "通知期"]),
    concept("availabilityDate", ["available date", "start date", "earliest start", "可入职日期", "开始工作"])
  ];

  const ARRAY_CONCEPTS = {
    education: [
      concept("school", ["school", "university", "college name", "institution", "academy", "学校", "院校", "大学", "毕业院校"]),
      concept("degree", ["degree", "qualification", "level of education", "diploma", "学位", "学历"]),
      concept("major", ["major", "field of study", "discipline", "program", "专业", "所学专业"]),
      concept("start", ["start date", "from", "begin", "enrolled", "开始时间", "入学", "就读开始"]),
      concept("end", ["end date", "to", "graduation", "graduated", "结束时间", "毕业时间"]),
      concept("description", ["description", "details", "honors", "courses", "描述", "详情", "荣誉"])
    ],
    experience: [
      concept("company", ["company", "company name", "employer", "organization", "workplace", "enterprise", "企业名称", "公司名称", "公司", "单位", "机构"]),
      concept("title", ["title", "position", "role", "job title", "职位名称", "职位", "岗位", "职务", "角色"]),
      concept("start", ["start date", "from", "begin", "开始时间", "任职开始", "实习开始"]),
      concept("end", ["end date", "to", "finish", "结束时间", "任职结束", "实习结束"]),
      concept("description", ["responsibilities", "description", "achievement", "duties", "工作描述", "工作内容", "实习内容", "职责", "业绩", "描述"])
    ]
  };

  function matchProfileField(field, memory) {
    const text = buildFieldText(field);
    const memoryMatch = matchMemory(text, memory, "profile", field);
    const ontologyMatch = bestConcept(text, PROFILE_CONCEPTS, ONTOLOGY_THRESHOLD);
    if (memoryMatch && (!ontologyMatch || memoryMatch.score >= ontologyMatch.score)) return memoryMatch;
    return ontologyMatch;
  }

  function matchArrayField(field, section, memory) {
    const text = buildFieldText(field);
    const memoryMatch = matchMemory(text, memory, section, field);
    const concepts = ARRAY_CONCEPTS[section] || ARRAY_CONCEPTS.experience;
    const ontologyMatch = bestConcept(text, concepts, ONTOLOGY_THRESHOLD);
    if (memoryMatch && (!ontologyMatch || memoryMatch.score >= ontologyMatch.score)) return memoryMatch;
    return ontologyMatch;
  }

  function createMemoryEntry(field, value, profilePath, section) {
    const text = buildFieldText(field);
    const canonicalLabel = canonicalize(field?.fieldTextNormalized || field?.text || text);
    return {
      type: profilePath ? "profilePath" : "literal",
      profilePath: profilePath || "",
      value: profilePath ? "" : value,
      label: text,
      canonicalLabel,
      section: section || field.section || "profile",
      control: field.control || "",
      vector: vectorToPairs(vectorize(text)),
      updatedAt: Date.now()
    };
  }

  function matchMemory(text, memory, section, field) {
    if (!memory) return null;
    const query = vectorize(text);
    const canonicalQuery = canonicalize(field?.fieldTextNormalized || field?.text || text);
    let best = null;

    for (const entry of Object.values(memory)) {
      if (!entry || entry.disabled || (!entry.profilePath && !hasStoredValue(entry.value))) continue;
      if (entry.section && section && entry.section !== section && entry.section !== "profile") continue;

      let score = 0;
      if (canonicalQuery && entry.canonicalLabel && canonicalQuery === entry.canonicalLabel) {
        score = 0.995;
      } else if (canonicalQuery && Array.isArray(entry.aliases) && entry.aliases.some((alias) => canonicalize(alias) === canonicalQuery)) {
        score = 0.98;
      } else {
        const entryVector = entry.vector ? pairsToVector(entry.vector) : vectorize(entry.label || "");
        score = cosine(query, entryVector);
      }

      if (entry.hostname && entry.hostname === location.hostname) score = Math.min(1, score + 0.03);
      if (score >= MEMORY_THRESHOLD && (!best || score > best.score)) {
        best = {
          key: entry.profilePath || "",
          value: entry.value ?? "",
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
    const canonicalQuery = canonicalize(text);
    const exact = concepts.find((item) => item.canonicalPhrases.includes(canonicalQuery));
    if (exact) return { key: exact.key, source: "semantic-exact", score: 0.99, confidence: 0.99 };

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
    return {
      key,
      phrases,
      canonicalPhrases: phrases.map(canonicalize),
      vector: vectorize(phrases.join(" "))
    };
  }

  function buildFieldText(field) {
    return normalize(field?.fieldTextNormalized || field?.text || "");
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

  function canonicalize(value) {
    return normalize(value)
      .replace(/请输入|请选择|please|enter|select|choose|required|必填/g, " ")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasStoredValue(value) {
    return value !== null && value !== undefined && (typeof value === "boolean" || String(value).trim() !== "");
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  window.ApplyPilotSemanticMatcher = {
    matchProfileField,
    matchArrayField,
    createMemoryEntry,
    matchMemory,
    vectorize,
    cosine,
    canonicalize,
    thresholds: {
      autoFill: 0.85,
      suggest: 0.55
    }
  };
})();
