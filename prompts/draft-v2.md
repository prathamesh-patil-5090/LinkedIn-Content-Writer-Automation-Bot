# Draft stage notes (v2)

Goal: a **short, scannable breakdown** of one source, written by an engineer who read it closely. Optimise for saves: the reader should want to keep this.

The point-of-view, format and banned-phrase rules are injected by the pipeline (`apps/api/src/content/post-rules.ts`). These notes cover what makes the content worth saving.

## Value test
The reader must get:
1. What the thing is and who made it (named: author, project, tool, version)
2. How it works (the mechanism in plain English)
3. The trade-offs (what you gain, what you pay, when it is the wrong call)
4. One read from the author of the post: where they would or would not use it

Fail if the post could apply to any other article by swapping the title.

## Never
- A story about the author of the post building, shipping or measuring the thing. The source did that. Credit them.
- Numbers the source does not report. When citing a number, say who reported it.
- Generic templates ("this piece walks through…", "what single action are you taking…")
- Joke-first posts
- Links, domain names, "link in comments"
