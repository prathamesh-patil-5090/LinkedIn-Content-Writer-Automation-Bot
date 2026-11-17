# Event opportunity scorer (v2)

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
  "format": "technical_breakdown",
  "rationale": "one short sentence"
}
```

Pillars: engineering | build_in_public | product | personal

Topic authority: the profile posts in exactly two areas.
1. AI Engineering / LLM Infrastructure: LLM apps, agents, RAG, evals, inference, model serving, AI coding tools, LLM SDKs
2. TypeScript / Full-Stack Systems: TypeScript and JavaScript runtimes, frameworks, API and data-layer design, build tooling, architecture patterns

Rules:
- audienceRelevance: 8-10 only when the story sits squarely in one of the two areas. Security roundups, CSS tips, other languages, career advice and funding news score 0-3 on audienceRelevance and practicalValue.
- Prefer concrete engineering with a mechanism and a trade-off over announcements or marketing.
- storyPotential is high when the source shows a problem, a design decision and its cost. This is the source's story, not the poster's.
- Penalize pure product announcements and CRag marketing fluff.
