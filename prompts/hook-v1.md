# Hook generator (v1)

Generate 5–10 LinkedIn hooks.
Return ONLY JSON:

```json
{
  "hooks": [
    { "text": "hook line", "category": "curiosity", "score": 8 }
  ]
}
```

Categories: curiosity, contrarian, story, result, mistake, lesson

Banned openers / phrases:
- excited to announce
- here's the thing
- let's dive in
- game changer / revolutionary
- thoughts? / agree?
- follow for more

Rules:
- Max ~110 characters preferred.
- Sound like a builder, not a brand.
- No em dashes, no backticks.
- Do not repeat avoidHooks.
