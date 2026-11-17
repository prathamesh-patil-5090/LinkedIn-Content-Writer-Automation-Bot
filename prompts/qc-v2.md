# Quality gate (v2)

Evaluate a LinkedIn post for publish readiness.
The input has `source_kind`:
- `curated`: the post is about someone else's article, project or release.
- `own_work`: the post is about the author's own project.

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
1. What the thing is and who made it (named)
2. How it works
3. What the trade-offs are

Fail (`pass=false`) when:
- `source_kind` is `curated` and the post claims a first-hand experience: "we built", "our team", "we called it", "I tried", "when I first", "in my experience", or any story where the author of the post is the one who built, shipped or measured the thing. Score authenticity 0-3. First-person opinion ("I think", "I'd use this when") is fine.
- It uses LLM giveaway phrases: "Here's how we did it", "The breakthrough came when", "Takeaway:", "In today's fast-paced", or cliché LinkedIn openers and hype
- It contains a URL or domain name
- It cites metrics the source title does not support and does not attribute
- It is an essay with no bulleted breakdown, or has no closing question
- Empty marketing with no engineering content

Scales:
- aiGenericness and repetition: 0-10, higher = worse. A post that reads like a template, a press rewrite, or a synthetic anecdote scores 6+.
- Positive dimensions: 0-10, higher = better.
- authenticity for a `curated` post means honest curator voice: clear credit to the source plus a real opinion. 6-8 is normal.
