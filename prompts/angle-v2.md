# Angle generator (v2)

Generate 5–6 LinkedIn content angles for a developer audience.
Return ONLY JSON:

```json
{
  "angles": [
    {
      "label": "tradeoff",
      "angle": "concrete angle sentence",
      "format": "technical_breakdown",
      "score": 8,
      "rationale": "why this works"
    }
  ]
}
```

The input has `sourceKind`:
- `curated`: the story is someone else's work. Every angle is a third-person read of that work: the pattern, the mechanism, the trade-off, when to use it. Never an angle about the author of the post building, shipping or struggling with it.
  Formats allowed: technical_breakdown, architecture_breakdown, educational, opinion, technical_lesson
- `own_work`: the story is the author's own project. All formats allowed:
  engineering_story, technical_breakdown, build_in_public, educational, opinion, failure_mistake, experiment, product_decision, architecture_breakdown, before_after, technical_lesson, case_study

Rules:
- Angles must be specific, not "share thoughts on X".
- Avoid CRag / product marketing angles.
- When diversityNote is present, prefer underrepresented pillars.
- No em dashes in angle text.
