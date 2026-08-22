export function stripReasoning(text: string) {
  let s = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
    .replace(/<\|[^|]+\|>/g, '');
  // Unclosed Qwen / gpt-oss think dump — drop until JSON or end
  s = s.replace(/<(think|reasoning|thought)>[\s\S]*?(?=\{|\[|$)/gi, '');
  return s.trim();
}

export function extractJson(text: string): unknown {
  let s = stripReasoning(text);
  s = s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!s || /^</.test(s) || !/[{[]/.test(s)) {
    throw new Error('Model returned reasoning with no JSON');
  }
  const leading = s.search(/[{[]/);
  if (leading > 0) s = s.slice(leading);

  const attempts = [s, repairJson(s)];
  const objStart = s.indexOf('{');
  const objEnd = s.lastIndexOf('}');
  if (objStart >= 0 && objEnd > objStart) {
    const slice = s.slice(objStart, objEnd + 1);
    attempts.push(slice, repairJson(slice));
  } else if (objStart >= 0) {
    attempts.push(repairJson(s.slice(objStart)));
  }
  const arrStart = s.indexOf('[');
  const arrEnd = s.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    const slice = s.slice(arrStart, arrEnd + 1);
    attempts.push(slice, repairJson(slice));
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

/** Groq models often copy schema hints like `1-10` or truncate the object. */
export function repairJson(input: string) {
  let s = input
    .replace(/\u0000/g, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/:\s*(\d+)\s*-\s*\d+/g, ': $1')
    .replace(/:\s*[N?](?=\s*[,}])/g, ': 5')
    .replace(/,\s*([}\]])/g, '$1');

  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (const ch of s) {
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
  }
  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');
  while (stack.length) s += stack.pop();
  return s.replace(/,\s*([}\]])/g, '$1');
}

export function isJsonModeError(message: string) {
  return /failed to (generate|validate) json|json_validate_failed|could not parse json|unexpected (end of json|token)|reasoning with no json/i.test(
    message,
  );
}
