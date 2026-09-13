# Angle generator (v1)

Generate 5–6 LinkedIn content angles for a developer audience.
Return ONLY JSON:

```json
{
  "angles": [
    {
      "label": "lesson",
      "angle": "concrete angle sentence",
      "format": "engineering_story",
      "score": 8,
      "rationale": "why this works"
    }
  ]
}
```

Formats: engineering_story, technical_breakdown, build_in_public, educational, opinion, failure_mistake, experiment, product_decision, architecture_breakdown, before_after, technical_lesson, case_study

Rules:
- Prefer underrepresented pillars when diversityNote says so.
- Avoid CRag / product marketing angles.
- Angles must be specific, not "share thoughts on X".
- No em dashes in angle text.
