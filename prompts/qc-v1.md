# Quality gate (v1)

Evaluate a LinkedIn post for autonomous publish.
Be **calibrated**, not harsh. A normal first-person builder post with a concrete lesson should **pass**.

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

Scoring calibration (0–10):
- Solid builder voice → authenticity **6–8**, not 1–3
- Normal prose without clichés → aiGenericness **1–3** (higher = worse)
- Only invent-metrics risk when the post asserts precise % / user counts with no measurement cue
- Do **not** fail for informal tone, humour, short paragraphs, or missing corporate polish
- Do **not** call a grounded engineering anecdote "incoherent" just because it is casual

Fail (`pass=false`) only when clearly true:
- Cliché LinkedIn openers / hype phrases
- Pure product marketing with no engineering lesson
- Invented vanity metrics
- Empty / near-empty body

aiGenericness and repetition: higher = worse.
Positive dimensions: higher = better.
