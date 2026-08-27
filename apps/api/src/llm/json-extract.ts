export function stripReasoningNoise(text: string): string {
  let s = text ?? '';

  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  s = s.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  s = s.replace(/<think>[\s\S]*?(?=[{[])/gi, '');
  s = s.replace(/<thinking>[\s\S]*?(?=[{[])/gi, '');
  s = s.replace(/<\/?think>/gi, '');
  s = s.replace(/<\/?thinking>/gi, '');
  s = s.replace(/<\/?reasoning>/gi, '');
  s = s.replace(/<\|[^|]+\|>/g, '');

  return s.trim();
}

/** Best-effort cleanup for near-JSON model output. */
export function repairLooseJson(text: string): string {
  let s = text.trim();
  // Trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  // Smart quotes
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  // If truncated object/array, close open braces/brackets.
  const opens = (s.match(/[{[]/g) || []).length;
  const closes = (s.match(/[}\]]/g) || []).length;
  if (opens > closes) {
    // Drop a dangling incomplete string/key at the end
    s = s.replace(/,\s*"[^"]*$/g, '');
    s = s.replace(/:\s*"[^"]*$/g, ': ""');
    s = s.replace(/,\s*$/g, '');
    const stack: string[] = [];
    let inStr = false;
    let esc = false;
    for (const ch of s) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    while (stack.length) s += stack.pop();
  }
  return s;
}

export function extractJson(text: string): unknown {
  let s = stripReasoningNoise(text);
  s = s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const attempts = [s];
  const objStart = s.indexOf('{');
  const objEnd = s.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    attempts.push(s.slice(objStart, objEnd + 1));
  } else if (objStart >= 0) {
    // Truncated object — take from first { and repair
    attempts.push(repairLooseJson(s.slice(objStart)));
  }
  const arrStart = s.indexOf('[');
  const arrEnd = s.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    attempts.push(s.slice(arrStart, arrEnd + 1));
  }

  const repaired = attempts.flatMap((chunk) => {
    const r = repairLooseJson(chunk);
    return r === chunk ? [chunk] : [chunk, r];
  });

  let lastErr: Error | null = null;
  for (const chunk of repaired) {
    if (!chunk.trim()) continue;
    try {
      return JSON.parse(chunk);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    lastErr
      ? `No JSON object in model output (${lastErr.message})`
      : 'No JSON object in model output',
  );
}

export function isJsonModeError(message: string) {
  return /failed to (generate|validate) json|json_validate_failed|could not parse json|no json object/i.test(
    message,
  );
}
