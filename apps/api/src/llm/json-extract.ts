export function extractJson(text: string): unknown {
  let s = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\|[^|]+\|>/g, '')
    .trim();
  s = s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const attempts = [s];
  const objStart = s.indexOf('{');
  const objEnd = s.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    attempts.push(s.slice(objStart, objEnd + 1));
  }
  const arrStart = s.indexOf('[');
  const arrEnd = s.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    attempts.push(s.slice(arrStart, arrEnd + 1));
  }

  let lastErr: Error | null = null;
  for (const chunk of attempts) {
    try {
      return JSON.parse(chunk);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr || new Error('No JSON object in model output');
}

export function isJsonModeError(message: string) {
  return /failed to (generate|validate) json|json_validate_failed|could not parse json/i.test(
    message,
  );
}
