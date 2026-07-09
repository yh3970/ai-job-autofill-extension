window.ResumeParser = (() => {
  const PDF_TEXT_MIN_CHARS = 80;
  const SCANNED_PDF_WARNING = "PDF 文本提取结果过少，可能是扫描件/图片型 PDF；当前版本暂不支持 OCR，请改用 DOCX/TXT 或可复制文字的 PDF。";

  const SECTION_DEFS = {
    summary: [/^(summary|profile|objective|about)$/i, /^(个人简介|自我评价|求职意向|个人总结)$/],
    education: [/^(education|academic|academic background)$/i, /^(教育背景|教育经历|学历背景|学习经历|教育)$/],
    internship: [/^(internship|internships|internship experience)$/i, /^(实习经历|实习经验|实习)$/],
    experience: [/^(experience|work experience|employment|professional experience|work history)$/i, /^(工作经历|工作经验|职业经历|全职经历|工作)$/],
    projects: [/^(projects|project|project experience)$/i, /^(项目经历|项目经验|项目)$/],
    skills: [/^(skills|technical skills|technologies|core skills)$/i, /^(技能|专业技能|技术技能|核心技能)$/],
    languages: [/^(languages|language)$/i, /^(语言能力|语言)$/],
    certifications: [/^(certifications|certificates|licenses|awards)$/i, /^(证书|资格证书|荣誉证书|获奖经历|荣誉奖项)$/]
  };

  const SECTION_HEADING_WORDS = new Set([
    "summary", "profile", "objective", "about", "education", "academic", "experience", "employment", "internship",
    "projects", "project", "skills", "languages", "certifications", "certificates", "licenses", "resume", "cv",
    "个人简介", "自我评价", "求职意向", "教育背景", "教育经历", "学历背景", "学习经历", "教育", "实习经历", "实习经验",
    "工作经历", "工作经验", "职业经历", "项目经历", "项目经验", "技能", "专业技能", "技术技能", "语言能力", "语言", "证书", "资格证书", "荣誉证书"
  ]);

  async function parseFile(file) {
    const name = file.name || "";
    const lower = name.toLowerCase();
    const warnings = [];
    let text = "";

    if (lower.endsWith(".docx")) {
      text = await extractDocxText(await file.arrayBuffer());
    } else if (lower.endsWith(".pdf")) {
      text = await extractPdfText(await file.arrayBuffer());
    } else {
      text = await file.text();
    }

    const normalizedText = cleanText(text);
    if (lower.endsWith(".pdf") && countUsefulTextChars(normalizedText) < PDF_TEXT_MIN_CHARS) {
      warnings.push(SCANNED_PDF_WARNING);
    }

    const profile = inferProfileAgent(normalizedText);
    return {
      fileName: name,
      text: normalizedText,
      profile,
      warnings,
      stats: getProfileStats(profile, normalizedText)
    };
  }

  async function extractDocxText(buffer) {
    const entries = readZipEntries(buffer);
    const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
    if (!documentEntry) return "";

    const xml = await inflateZipEntry(buffer, documentEntry);
    return xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function readZipEntries(buffer) {
    const view = new DataView(buffer);
    const entries = [];
    for (let offset = 0; offset < view.byteLength - 46; offset += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) continue;
      const compression = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const nameBytes = new Uint8Array(buffer, offset + 46, fileNameLength);
      entries.push({
        name: new TextDecoder().decode(nameBytes),
        compression,
        compressedSize,
        uncompressedSize,
        localHeaderOffset
      });
      offset += 45 + fileNameLength + extraLength + commentLength;
    }
    return entries;
  }

  async function inflateZipEntry(buffer, entry) {
    const view = new DataView(buffer);
    const local = entry.localHeaderOffset;
    const fileNameLength = view.getUint16(local + 26, true);
    const extraLength = view.getUint16(local + 28, true);
    const start = local + 30 + fileNameLength + extraLength;
    const bytes = new Uint8Array(buffer, start, entry.compressedSize);

    if (entry.compression === 0) return new TextDecoder().decode(bytes);
    if (entry.compression !== 8) return "";

    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }

  async function extractPdfText(buffer) {
    const pdfJsText = await extractPdfTextWithPdfJs(buffer);
    if (pdfJsText.trim()) return pdfJsText;

    const raw = new TextDecoder("latin1").decode(buffer);
    const chunks = extractPdfTextOperators(raw);
    const streamPattern = /<<(?:.|\n|\r)*?\/Filter\s*\/FlateDecode(?:.|\n|\r)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let streamMatch;
    while ((streamMatch = streamPattern.exec(raw))) {
      const bytes = latin1ToBytes(streamMatch[1]);
      const inflated = await inflatePdfStream(bytes);
      if (inflated) chunks.push(...extractPdfTextOperators(inflated));
    }

    return chunks.join("\n");
  }

  async function extractPdfTextWithPdfJs(buffer) {
    try {
      const pdfjs = await import(chrome.runtime.getURL("vendor/pdf.mjs"));
      pdfjs.GlobalWorkerOptions.workerSrc = "";
      const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        disableWorker: true,
        useWorkerFetch: false,
        isEvalSupported: false
      });
      const pdf = await loadingTask.promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str || "").join(" "));
      }
      return pages.join("\n");
    } catch (error) {
      console.warn("ApplyPilot PDF.js extraction failed", error);
      return "";
    }
  }

  function extractPdfTextOperators(raw) {
    const chunks = [];
    const textPattern = /\((?:\\.|[^\\)])*\)\s*T[jJ]/g;
    let match;
    while ((match = textPattern.exec(raw))) {
      chunks.push(decodePdfString(match[0].replace(/\)\s*T[jJ]$/, "").slice(1)));
    }

    const arrayPattern = /\[((?:\s*\((?:\\.|[^\\])*\)\s*-?\d*)+)\]\s*TJ/g;
    while ((match = arrayPattern.exec(raw))) {
      const inner = match[1];
      const parts = inner.match(/\((?:\\.|[^\\)])*\)/g) || [];
      chunks.push(parts.map((part) => decodePdfString(part.slice(1, -1))).join(""));
    }
    return chunks;
  }

  async function inflatePdfStream(bytes) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
      const buffer = await new Response(stream).arrayBuffer();
      return new TextDecoder("latin1").decode(buffer);
    } catch (error) {
      return "";
    }
  }

  function latin1ToBytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      bytes[index] = value.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  function decodePdfString(value) {
    return value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
      .replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
  }

  function inferProfileAgent(text) {
    const lines = splitLines(text);
    const sections = segmentResume(lines);
    const header = sections.header || [];
    const name = inferNameAgent(header.length ? header : lines.slice(0, 10));

    return {
      personal: {
        ...name,
        email: firstMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
        phone: extractPhone(text),
        linkedin: firstMatch(text, /https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i),
        github: firstMatch(text, /https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i),
        portfolio: firstMatch(text, /https?:\/\/(?!.*(?:linkedin|github))[^\s)]+/i),
        location: inferLocationAgent(header.join("\n"))
      },
      summary: pickSection(sections, ["summary"]).slice(0, 6).join("\n"),
      education: parseExperienceLikeItems(pickSection(sections, ["education"]), "education"),
      experience: parseExperienceLikeItems([
        ...pickSection(sections, ["internship"]),
        ...pickSection(sections, ["experience"])
      ], "experience"),
      projects: parseExperienceLikeItems(pickSection(sections, ["projects"]), "project"),
      skills: splitListAgent(pickSection(sections, ["skills"]).join("\n")),
      languages: splitListAgent(pickSection(sections, ["languages"]).join("\n")),
      certifications: splitListAgent(pickSection(sections, ["certifications"]).join("\n")),
      resumeText: text
    };
  }

  function segmentResume(lines) {
    const sections = { header: [] };
    let current = "header";
    for (const rawLine of lines) {
      const line = stripBullet(rawLine);
      const heading = detectSectionHeading(line);
      if (heading) {
        current = heading;
        sections[current] ||= [];
        continue;
      }
      sections[current] ||= [];
      sections[current].push(line);
    }
    return sections;
  }

  function detectSectionHeading(line) {
    const normalizedLine = normalizeHeading(line);
    if (!normalizedLine || normalizedLine.length > 40) return "";
    for (const [section, patterns] of Object.entries(SECTION_DEFS)) {
      if (patterns.some((pattern) => pattern.test(normalizedLine))) return section;
    }
    return "";
  }

  function normalizeHeading(line) {
    return String(line || "")
      .replace(/^[-•*#\d.、\s]+/, "")
      .replace(/[：:|｜\s]/g, "")
      .trim()
      .toLowerCase();
  }

  function inferNameAgent(lines) {
    const cleanedLines = lines.map((line) => stripBullet(line).replace(/[|｜,，].*$/, "").trim()).filter(Boolean);
    const candidate = cleanedLines.find(isLikelyNameLine) || "";
    const chineseName = /^[\u4e00-\u9fa5·]{2,6}$/.test(candidate) ? candidate : "";
    const englishParts = /^[A-Za-z][A-Za-z\s.'-]{1,60}$/.test(candidate) ? candidate.split(/\s+/) : [];
    return {
      fullName: candidate,
      chineseName,
      firstName: englishParts[0] || "",
      middleName: englishParts.length > 2 ? englishParts.slice(1, -1).join(" ") : "",
      lastName: englishParts.length > 1 ? englishParts[englishParts.length - 1] : ""
    };
  }

  function isLikelyNameLine(line) {
    const compact = normalizeHeading(line);
    if (!line || SECTION_HEADING_WORDS.has(compact) || detectSectionHeading(line)) return false;
    if (/@|http|linkedin|github|gitee|email|mail|phone|mobile|tel|电话|手机|邮箱|地址|所在地|出生|年龄|性别|民族|政治面貌|求职/i.test(line)) return false;
    if (/\d{2,}/.test(line)) return false;
    if (/简历|个人信息|基本信息|curriculum vitae|resume/i.test(line)) return false;
    if (/^[\u4e00-\u9fa5·]{2,6}$/.test(line)) return !/(背景|经历|经验|技能|证书|项目|教育|工作|实习|语言|荣誉|评价|意向)$/.test(line);
    if (/^[A-Za-z][A-Za-z\s.'-]{1,60}$/.test(line)) return !SECTION_HEADING_WORDS.has(compact);
    return false;
  }

  function extractPhone(text) {
    const pattern = /(?:^|[^\d])((?:\+?86[-\s]?)?1[3-9]\d(?:[-\s]?\d){8})(?!\d)/g;
    let match;
    while ((match = pattern.exec(String(text || "")))) {
      const candidate = match[1];
      let digits = candidate.replace(/\D/g, "");
      if (digits.startsWith("86") && digits.length === 13) digits = digits.slice(2);
      if (/^1[3-9]\d{9}$/.test(digits)) return candidate.trim();
    }
    return "";
  }

  function inferLocationAgent(text) {
    const labeled = firstMatch(text, /(?:location|address|city|所在地|地址|城市)[:：\s]+([^\n]+)/i);
    if (labeled) return labeled.replace(/^(location|address|city|所在地|地址|城市)[:：\s]+/i, "").trim();
    return firstMatch(text, /\b(?:Beijing|Shanghai|Shenzhen|Guangzhou|Hangzhou|New York|London|Toronto|Singapore|Hong Kong)\b/i);
  }

  function parseExperienceLikeItems(lines, type) {
    if (!lines.length) return [];
    return splitResumeBlocks(lines)
      .slice(0, 10)
      .map((block) => parseItemBlock(block, type))
      .filter((item) => Object.values(item).some(Boolean));
  }

  function splitResumeBlocks(lines) {
    const blocks = [];
    let current = [];
    for (const rawLine of lines) {
      const line = stripBullet(rawLine);
      if (!line) continue;
      const startsNew = current.length > 0 && (
        (hasDateRange(line) && current.some((item) => hasDateRange(item))) ||
        (looksLikeEntryTitle(line) && current.length >= 2)
      );
      if (startsNew) {
        blocks.push(current);
        current = [];
      }
      current.push(line);
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  function parseItemBlock(lines, type) {
    const text = lines.join("\n");
    const dates = parseDateRange(text);
    if (type === "education") {
      const school = findLine(lines, /大学|学院|学校|university|college|school/i, 0);
      return {
        school,
        degree: findLine(lines, /bachelor|master|phd|doctor|degree|学士|硕士|博士|本科|研究生|学位/i, 1),
        major: findLine(lines, /major|专业|finance|business|computer|engineering|经济|金融|管理|计算机|工程|会计/i, 2),
        start: dates.start,
        end: dates.end,
        description: lines.filter((line) => line !== school).slice(0, 6).join("\n")
      };
    }
    if (type === "project") {
      const name = findLine(lines, /项目|project|system|platform|app|website|模型|系统|平台/i, 0);
      return {
        name,
        role: findLine(lines, /role|owner|lead|developer|designer|负责|角色|成员|负责人/i, 1),
        start: dates.start,
        end: dates.end,
        description: lines.filter((line) => line !== name).join("\n"),
        url: firstMatch(text, /https?:\/\/[^\s)]+/i)
      };
    }
    const company = findLine(lines, /公司|银行|证券|咨询|科技|集团|事务所|company|inc\.?|ltd\.?|llc|corp|bank|securities|consulting/i, 0);
    return {
      company,
      title: findLine(lines, /intern|engineer|analyst|manager|assistant|developer|research|实习|工程师|分析师|经理|助理|研究|运营|产品|开发/i, 1),
      start: dates.start,
      end: dates.end,
      description: lines.filter((line) => line !== company).join("\n")
    };
  }

  function parseDateRange(text) {
    const date = "(?:19|20)\\d{2}(?:[./年-]\\s?\\d{1,2}月?)?";
    const match = String(text || "").match(new RegExp(`(${date})\\s*(?:-|–|—|~|至|到|to)\\s*(present|current|now|至今|今|${date})`, "i"));
    return {
      start: match ? normalizeDate(match[1]) : "",
      end: match ? normalizeDate(match[2]) : ""
    };
  }

  function normalizeDate(value) {
    return String(value || "")
      .replace(/\s+/g, "")
      .replace(/年/g, ".")
      .replace(/月/g, "")
      .replace(/\.$/, "")
      .replace(/^(present|current|now|今)$/i, "至今");
  }

  function hasDateRange(line) {
    return /(?:19|20)\d{2}.*(?:-|–|—|~|至|到|to).*(?:present|current|now|至今|今|(?:19|20)\d{2})/i.test(line);
  }

  function looksLikeEntryTitle(line) {
    if (detectSectionHeading(line)) return false;
    if (/@|http|电话|手机|邮箱|email/i.test(line)) return false;
    return /^[\u4e00-\u9fa5A-Za-z0-9 .,&()《》「」'’·-]{2,90}$/.test(line) &&
      /公司|大学|学院|项目|银行|证券|咨询|科技|集团|University|College|Company|Project|Inc|Ltd|LLC/i.test(line);
  }

  function findLine(lines, pattern, fallbackIndex) {
    return lines.find((line) => pattern.test(line)) || lines[fallbackIndex] || "";
  }

  function pickSection(sections, names) {
    for (const name of names) {
      if (sections[name]?.length) return sections[name];
    }
    return [];
  }

  function splitListAgent(text) {
    return String(text || "")
      .split(/[,，;；|、\n]/)
      .map((item) => stripBullet(item).trim())
      .filter((item) => item && item.length <= 80 && !detectSectionHeading(item))
      .slice(0, 60);
  }

  function firstMatch(text, pattern) {
    const match = String(text || "").match(pattern);
    if (!match) return "";
    return (match[1] || match[0]).trim();
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .replace(/[\u00a0\t]+/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function splitLines(text) {
    return cleanText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }

  function stripBullet(value) {
    return String(value || "")
      .replace(/^[-•*●▪▫◆◇·\s]+/, "")
      .replace(/^\d{1,2}[.、)]\s+/, "")
      .trim();
  }

  function countUsefulTextChars(text) {
    return String(text || "").replace(/\s/g, "").length;
  }

  function getProfileStats(profile, text) {
    const fields = [
      profile.personal?.fullName,
      profile.personal?.email,
      profile.personal?.phone,
      profile.personal?.linkedin,
      profile.personal?.github,
      profile.personal?.portfolio,
      profile.personal?.location,
      profile.summary
    ];
    const listCount = ["education", "experience", "projects", "skills", "languages", "certifications"]
      .reduce((total, key) => total + (Array.isArray(profile[key]) ? profile[key].length : 0), 0);
    return {
      textLength: text.length,
      recognized: fields.filter(Boolean).length + listCount
    };
  }

  return { parseFile };
})();
