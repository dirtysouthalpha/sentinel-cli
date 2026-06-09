export function validateModelString(model: string): { provider: string; model: string } | null {
  const parts = model.split("/");
  if (parts.length === 2) {
    return { provider: parts[0], model: parts[1] };
  }
  if (parts.length === 1) {
    return { provider: "anthropic", model: parts[0] };
  }
  return null;
}

export function validatePath(filePath: string): boolean {
  if (filePath.includes("..")) return false;
  if (filePath.startsWith("/")) return false;
  if (filePath.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(filePath)) return false;
  return true;
}

export function validateCommandName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

export function validateSkillName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

export function validateAgentName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

export function validateThemeName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

export function validateJSON(json: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(json);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: String(err) };
  }
}
