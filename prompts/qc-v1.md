# Quality gate (v1)

Evaluate a LinkedIn post for publish readiness.
Prefer **clear teaching** over humour. A solid builder post should pass.

Return ONLY JSON:

```json
{
  "scores": {
    "technicalAccuracy": 7,
    "authenticity": 7,
    "hook": 7,
    "educationalValue": 7,
    "originality": 7,
    "readability": 7,
    "storytelling": 7,
    "relevance": 7,
    "aiGenericness": 2,
    "repetition": 2,
    "factualGrounding": 7
  },
  "pass": true,
  "reasons": ["short reasons"],
  "feedback": "rewrite guidance if fail"
}
```

Pass when the reader can answer:
1. What changed (named tool/report/release)
2. Why a builder should care
3. What to do this week (one concrete action)

Fail (`pass=false`) when:
- Joke-first / vague vibes with no named action
- Cliché LinkedIn openers / hype phrases
- Invented vanity metrics
- Empty marketing with no engineering lesson

aiGenericness and repetition: higher = worse.
Positive dimensions: higher = better. Be calibrated (authenticity 6–8 for normal first-person builder voice).
