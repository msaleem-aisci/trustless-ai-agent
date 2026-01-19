export function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function clamp(num, min, max) {
  return Math.min(Math.max(num, min), max);
}
