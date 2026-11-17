# Hook generator (v2)

Generate 5–10 LinkedIn hooks.
Return ONLY JSON:

```json
{
  "hooks": [
    { "text": "hook line", "category": "curiosity", "score": 8 }
  ]
}
```

The input has `sourceKind`:
- `curated`: the story is someone else's work. The hook states the pattern, finding or trade-off. It never claims an experience: no "I built", "I almost shipped", "we", "our", "my team".
  Categories: curiosity, contrarian, pattern, tradeoff, lesson
- `own_work`: first person is allowed, for facts in the input only.
  Categories: curiosity, contrarian, story, result, mistake, lesson

Banned openers / phrases:
- excited to announce
- here's the thing
- let's dive in
- here's how we did it
- the breakthrough came when
- in today's fast-paced
- game changer / revolutionary
- thoughts? / agree?
- follow for more

Rules:
- Max ~110 characters preferred.
- Sound like an engineer, not a brand.
- No em dashes, no backticks, no links.
- Do not repeat avoidHooks.
