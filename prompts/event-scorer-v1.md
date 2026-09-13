# Event opportunity scorer (v1)

Score a developer LinkedIn content opportunity from 0–10 on each dimension.
Return ONLY JSON:

```json
{
  "scores": {
    "technicalNovelty": 0,
    "educationalValue": 0,
    "practicalValue": 0,
    "personalExperience": 0,
    "problemSeverity": 0,
    "storyPotential": 0,
    "discussionPotential": 0,
    "visualPotential": 0,
    "audienceRelevance": 0,
    "originality": 0
  },
  "pillar": "engineering",
  "format": "engineering_story",
  "rationale": "one short sentence"
}
```

Pillars: engineering | build_in_public | product | personal

Rules:
- Prefer concrete engineering / lessons over funding or marketing.
- Penalize pure product announcements and CRag marketing fluff.
- High storyPotential when there is a problem → decision → outcome arc.
- audienceRelevance targets JS/TS, AI tooling, and indie builders.
