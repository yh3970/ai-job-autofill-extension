window.ResumeParser = (() => {
  async function parseFile(file) {
    const name = file.name || "";
    const lower = name.toLowerCase();
    let text = "";

    if (lower.endsWith(".docx")) {
      text = await extractDocxText(await file.arrayBuffer());
    } else if (lower.endsWith(".pdf")) {
      text = await extractPdfText(await file.arrayBuffer());
    } else {
      text = await file.text();
    }

    const normalizedText = cleanText(text);
    const profile = inferProfileAgent(normalizedText);
    return {
      fileName: name,
      text: normalizedText,
      profile,
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

    const arrayPattern = /\[((?:\s*\((?:\\.|[^\\)])*\)\s*-?\d*)+)\]\s*TJ/g;
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

  function inferProfile(text) {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const firstMeaningfulLine = lines.find((line) => !/@|linkedin|github|phone|电话|邮箱/i.test(line)) || "";
    const email = firstMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const phone = firstMatch(text, /(?:\+?\d[\d\s().-]{7,}\d)/);
    const linkedin = firstMatch(text, /https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i);
    const github = firstMatch(text, /https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i);
    const portfolio = firstMatch(text, /https?:\/\/(?!.*(?:linkedin|github))[^\s)]+/i);
    const name = inferName(firstMeaningfulLine);

    return {
      personal: {
        ...name,
        email,
        phone,
        linkedin,
        github,
        portfolio,
        location: inferLocation(lines)
      },
      summary: section(text, ["summary", "profile", "objective", "个人简介", "自我评价", "求职意向"], 5),
      education: inferItems(section(text, ["education", "教育经历", "教育背景"], 12), ["school", "degree", "major", "start", "end"]),
      experience: inferItems(section(text, ["experience", "work experience", "employment", "工作经历", "实习经历"], 18), ["company", "title", "start", "end", "description"]),
      projects: inferItems(section(text, ["projects", "project experience", "项目经历"], 16), ["name", "role", "description", "url"]),
      skills: splitList(section(text, ["skills", "technical skills", "技能", "专业技能"], 8)),
      languages: splitList(section(text, ["languages", "语言能力", "语言"], 4)),
      certifications: splitList(section(text, ["certifications", "certificates", "证书", "资格证书"], 6)),
      resumeText: text
    };
  }

  function inferName(line) {
    const cleaned = line.replace(/[|,，].*$/, "").trim();
    const chineseName = /^[\u4e00-\u9fa5]{2,5}$/.test(cleaned) ? cleaned : "";
    const parts = /^[A-Za-z][A-Za-z\s.'-]{1,60}$/.test(cleaned) ? cleaned.split(/\s+/) : [];
    return {
      fullName: cleaned,
      chineseName,
      firstName: parts[0] || "",
      middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
      lastName: parts.length > 1 ? parts[parts.length - 1] : ""
    };
  }

  function inferLocation(lines) {
    const locationLine = lines.find((line) => /location|address|所在地|地址|城市/i.test(line));
    if (!locationLine) return "";
    return locationLine.replace(/^(location|address|所在地|地址|城市)[:：\s]*/i, "").trim();
  }

  function inferItems(text, keys) {
    if (!text) return [];
    const blocks = text.split(/\n(?=\S)/).map((block) => block.trim()).filter(Boolean).slice(0, 6);
    return blocks.map((block) => {
      const lines = block.split(/\n/).map((line) => line.trim()).filter(Boolean);
      const dates = firstMatch(block, /(20\d{2}|19\d{2})\s*[-–~至到]\s*(present|now|current|20\d{2}|19\d{2}|至今)/i);
      const item = {};
      item[keys[0]] = lines[0] || "";
      if (keys[1]) item[keys[1]] = lines[1] || "";
      if (keys.includes("start")) item.start = dates.split(/[-–~至到]/)[0]?.trim() || "";
      if (keys.includes("end")) item.end = dates.split(/[-–~至到]/)[1]?.trim() || "";
      if (keys.includes("description")) item.description = lines.slice(1).join("\n");
      if (keys.includes("url")) item.url = firstMatch(block, /https?:\/\/[^\s)]+/i);
      return item;
    });
  }

  function section(text, headings, maxLines) {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const start = lines.findIndex((line) => headings.some((heading) => normalize(line).includes(normalize(heading))));
    if (start < 0) return "";

    const nextHeading = /^(summary|profile|objective|education|experience|employment|projects|skills|languages|certifications|个人|自我|求职|教育|工作|实习|项目|技能|语言|证书)/i;
    const collected = [];
    for (let index = start + 1; index < lines.length && collected.length < maxLines; index += 1) {
      if (collected.length && nextHeading.test(lines[index])) break;
      collected.push(lines[index]);
    }
    return collected.join("\n");
  }

  function splitList(text) {
    return text.split(/[,，;；\n|]/).map((item) => item.trim()).filter(Boolean).slice(0, 40);
  }

  function firstMatch(text, pattern) {
    const match = String(text || "").match(pattern);
    return match ? match[0].trim() : "";
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
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

  function inferProfileAgent(text) {
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const sections = segmentResume(lines);
    const header = lines.slice(0, 12).join("\n");
    const name = inferNameAgent(lines);

    return {
      personal: {
        ...name,
        email: firstMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
        phone: firstMatch(text, /(?:\+?\d[\d\s().-]{7,}\d)/),
        linkedin: firstMatch(text, /https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i),
        github: firstMatch(text, /https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i),
        portfolio: firstMatch(text, /https?:\/\/(?!.*(?:linkedin|github))[^\s)]+/i),
        location: inferLocationAgent(header)
      },
      summary: pickSection(sections, ["summary", "profile", "objective", "about", "self"]).slice(0, 6).join("\n"),
      education: parseExperienceLikeItems(pickSection(sections, ["education", "academic"]), "education"),
      experience: parseExperienceLikeItems(pickSection(sections, ["experience", "employment", "internship", "work"]), "experience"),
      projects: parseExperienceLikeItems(pickSection(sections, ["projects", "project"]), "project"),
      skills: splitListAgent(pickSection(sections, ["skills", "technical"]).join("\n")),
      languages: splitListAgent(pickSection(sections, ["languages", "language"]).join("\n")),
      certifications: splitListAgent(pickSection(sections, ["certifications", "certificates", "licenses"]).join("\n")),
      resumeText: text
    };
  }

  function segmentResume(lines) {
    const sectionNames = {
      summary: [/summary|profile|objective|about/i, /\u4e2a\u4eba\u7b80\u4ecb|\u81ea\u6211\u8bc4\u4ef7|\u6c42\u804c\u610f\u5411/],
      education: [/education|academic|university|college/i, /\u6559\u80b2\u7ecf\u5386|\u6559\u80b2\u80cc\u666f|\u5b66\u5386/],
      experience: [/experience|employment|internship|work history|professional/i, /\u5de5\u4f5c\u7ecf\u5386|\u5b9e\u4e60\u7ecf\u5386|\u804c\u4e1a\u7ecf\u5386/],
      projects: [/projects?|project experience/i, /\u9879\u76ee\u7ecf\u5386|\u9879\u76ee/],
      skills: [/skills?|technical skills|technologies/i, /\u6280\u80fd|\u4e13\u4e1a\u6280\u80fd|\u6280\u672f/],
      languages: [/languages?/i, /\u8bed\u8a00\u80fd\u529b|\u8bed\u8a00/],
      certifications: [/certifications?|certificates?|licenses?/i, /\u8bc1\u4e66|\u8d44\u683c\u8bc1\u4e66/]
    };

    const sections = { header: [] };
    let current = "header";
    for (const line of lines) {
      const heading = Object.entries(sectionNames).find(([, patterns]) => {
        const compact = line.replace(/[:：\s]/g, "");
        return patterns.some((pattern) => pattern.test(line) || pattern.test(compact));
      });
      if (heading && line.length < 50) {
        current = heading[0];
        sections[current] ||= [];
        continue;
      }
      sections[current] ||= [];
      sections[current].push(line);
    }
    return sections;
  }

  function pickSection(sections, names) {
    for (const name of names) {
      if (sections[name]?.length) return sections[name];
    }
    return [];
  }

  function inferNameAgent(lines) {
    const candidate = lines.find((line) => {
      if (/@|http|linkedin|github|\d{3,}/i.test(line)) return false;
      if (/resume|curriculum vitae|education|experience|skills/i.test(line)) return false;
      return line.length >= 2 && line.length <= 60;
    }) || "";
    const cleaned = candidate.replace(/[|,，].*$/, "").trim();
    const chineseName = /^[\u4e00-\u9fa5]{2,5}$/.test(cleaned) ? cleaned : "";
    const englishParts = /^[A-Za-z][A-Za-z\s.'-]{1,60}$/.test(cleaned) ? cleaned.split(/\s+/) : [];
    return {
      fullName: cleaned,
      chineseName,
      firstName: englishParts[0] || "",
      middleName: englishParts.length > 2 ? englishParts.slice(1, -1).join(" ") : "",
      lastName: englishParts.length > 1 ? englishParts[englishParts.length - 1] : ""
    };
  }

  function inferLocationAgent(text) {
    const labeled = firstMatch(text, /(?:location|address|city|所在地|地址|城市)[:：\s]+([^\n]+)/i);
    if (labeled) return labeled.replace(/^(location|address|city|所在地|地址|城市)[:：\s]+/i, "").trim();
    const common = firstMatch(text, /\b(?:Beijing|Shanghai|Shenzhen|Guangzhou|Hangzhou|New York|London|Toronto|Singapore|Hong Kong)\b/i);
    return common;
  }

  function parseExperienceLikeItems(lines, type) {
    if (!lines.length) return [];
    const blocks = splitResumeBlocks(lines).slice(0, 8);
    return blocks.map((block) => parseItemBlock(block, type)).filter((item) => Object.values(item).some(Boolean));
  }

  function splitResumeBlocks(lines) {
    const blocks = [];
    let current = [];
    for (const line of lines) {
      const startsNew = current.length > 0 && (
        hasDateRange(line) ||
        (/^[A-Z][A-Za-z0-9 .,&()'-]{2,80}$/.test(line) && current.length >= 2) ||
        (/^[\u4e00-\u9fa5A-Za-z0-9 .,&()'-]{2,80}$/.test(line) && /公司|大学|学院|项目|University|College|Company/i.test(line))
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
      return {
        school: lines[0] || "",
        degree: findLine(lines, /bachelor|master|phd|doctor|degree|学士|硕士|博士|本科|研究生/i, 1),
        major: findLine(lines, /major|computer|finance|business|engineering|专业/i, 2),
        start: dates.start,
        end: dates.end,
        description: lines.slice(1).join("\n")
      };
    }
    if (type === "project") {
      return {
        name: lines[0] || "",
        role: findLine(lines, /role|owner|lead|developer|designer|负责|角色/i, 1),
        description: lines.slice(1).join("\n"),
        url: firstMatch(text, /https?:\/\/[^\s)]+/i)
      };
    }
    return {
      company: lines[0] || "",
      title: findLine(lines, /intern|engineer|analyst|manager|assistant|developer|research|实习|工程师|分析师|经理|助理/i, 1),
      start: dates.start,
      end: dates.end,
      description: lines.slice(1).join("\n")
    };
  }

  function parseDateRange(text) {
    const match = text.match(/((?:19|20)\d{2}(?:[./-]\d{1,2})?)\s*(?:-|–|~|to|至|到)\s*(present|current|now|至今|(?:19|20)\d{2}(?:[./-]\d{1,2})?)/i);
    return {
      start: match ? match[1] : "",
      end: match ? match[2] : ""
    };
  }

  function hasDateRange(line) {
    return /(?:19|20)\d{2}.*(?:-|–|~|to|至|到).*(?:present|current|now|至今|(?:19|20)\d{2})/i.test(line);
  }

  function findLine(lines, pattern, fallbackIndex) {
    return lines.find((line) => pattern.test(line)) || lines[fallbackIndex] || "";
  }

  function splitListAgent(text) {
    return String(text || "")
      .split(/[,，;；|、\n]/)
      .map((item) => item.replace(/^[-•*]\s*/, "").trim())
      .filter((item) => item && item.length <= 80)
      .slice(0, 60);
  }

  return { parseFile };
})();
