chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(["profile", "fieldMemory"]);
  const defaultProfile = {
    personal: {
      firstName: "",
      middleName: "",
      lastName: "",
      fullName: "",
      chineseName: "",
      preferredName: "",
      email: "",
      phone: "",
      location: "",
      address: "",
      nationality: "",
      linkedin: "",
      github: "",
      portfolio: ""
    },
    summary: "",
    workAuthorization: "",
    visaSponsorship: "",
    relocation: "",
    desiredSalary: "",
    noticePeriod: "",
    availabilityDate: "",
    education: [],
    experience: [],
    projects: [],
    certifications: [],
    languages: [],
    skills: [],
    resumeText: "",
    resumeFiles: []
  };
  if (!current.profile) {
    await chrome.storage.local.set({ profile: defaultProfile });
  } else {
    await chrome.storage.local.set({ profile: mergeDefaults(defaultProfile, current.profile) });
  }
  if (!current.fieldMemory) {
    await chrome.storage.local.set({ fieldMemory: {} });
  }
});

function mergeDefaults(defaults, current) {
  if (Array.isArray(defaults)) return Array.isArray(current) ? current : defaults;
  if (!defaults || typeof defaults !== "object") return current ?? defaults;
  const merged = { ...defaults, ...(current || {}) };
  Object.keys(defaults).forEach((key) => {
    merged[key] = mergeDefaults(defaults[key], current?.[key]);
  });
  return merged;
}
