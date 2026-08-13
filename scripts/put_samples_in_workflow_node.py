import json
from pathlib import Path

path = Path(r"d:/linkedin-bot/workflows/linkedin-daily-knowledge-post.json")
samples_path = Path(r"d:/linkedin-bot/prompts/meghan-voice-samples.md")
data = json.loads(path.read_text(encoding="utf-8"))
samples_md = samples_path.read_text(encoding="utf-8")

# Extract sample bodies from markdown (between ## Sample sections)
# Store full markdown as voice_bank for the workflow node
voice_bank = samples_md.strip()

nodes = data["nodes"]
names = {n["name"] for n in nodes}

# Insert Set node with samples BEFORE Founder Voice
set_node = {
    "parameters": {
        "mode": "manual",
        "duplicateItem": False,
        "assignments": {
            "assignments": [
                {
                    "id": "voice-bank",
                    "name": "meghan_voice_samples",
                    "value": voice_bank,
                    "type": "string",
                },
                {
                    "id": "voice-name",
                    "name": "founder_name",
                    "value": "Meghan Vaze",
                    "type": "string",
                },
                {
                    "id": "company",
                    "name": "company",
                    "value": "Unovative",
                    "type": "string",
                },
            ]
        },
        "options": {
            "includeOtherFields": True,
        },
    },
    "id": "meghan-voice-bank",
    "name": "Meghan Voice Samples (edit here)",
    "type": "n8n-nodes-base.set",
    "typeVersion": 3.4,
    "position": [1600, 400],
    "notes": "Paste more of Meghan's real LinkedIn posts into meghan_voice_samples. Founder Voice Agent reads this field.",
}

if "Meghan Voice Samples (edit here)" not in names:
    idx = next(i for i, n in enumerate(nodes) if n["name"] == "⚠️ Content Agent (3 Drafts)")
    nodes.insert(idx + 1, set_node)

# Slim Founder Voice prompt: instruct to use samples from the Set node
founder = next(n for n in nodes if n["name"] == "⚠️ Founder Voice: Meghan Vaze")
founder["parameters"]["messages"]["values"][0]["content"] = """You are the Founder Voice Agent for Meghan Vaze (Founder & CEO, Unovative).

Rewrite the BEST of the three drafts into ONE final LinkedIn post that sounds like Meghan wrote it himself.

CRITICAL: Mimic the REAL writing samples provided in meghan_voice_samples (rhythm, sentence length, structure, punctuation). Do NOT copy their topics verbatim. Do NOT invent fake personal stories.

WHO MEGHAN IS:
- Founder & CEO of Unovative — turns ideas into reality via digital design & development
- Product consultant: hybrid apps, SaaS, ecommerce, Indian & Vietnamese tech startups
- Builder journey: diploma → YouTube → early startups → product work → Unovative
- Mumbai / India based; ships with clients and product teams

COPY THESE PATTERNS FROM THE SAMPLES:
- Hook/title that reframes a common belief
- Short sentences + frequent line breaks
- Bullet lists with • or -
- “I’ve seen…”, small real anecdote, or “How I fix this”
- Numbered frameworks when useful
- Sharp closing one-liner
- Product + human/psychology angle when natural
- Journey tone only when the topic fits

HARD AVOIDS:
- Corporate fluff / brochure tone / news rewrite
- Invented Unovative metrics or fake client stories
- “Thrilled to announce”, “I’m excited to share”, “fast-paced world”
- Buzzwords: synergy, disrupt, game-changer, revolutionary

Select the strongest draft, rewrite fully in Meghan’s voice.
Target 180–280 words. LinkedIn formatting.

Return ONLY valid JSON (no markdown fences):
{
  "chosen_style": "operator_playbook|journey_lesson|product_insight",
  "post_text": "final linkedin post",
  "hook": "first line",
  "image_prompt": "refined image prompt",
  "hashtags": ["#a", "#b", "#c"],
  "source_title": "original story title",
  "source_link": "url"
}"""

# User message must include samples from Set node + drafts
founder["parameters"]["messages"]["values"][1]["content"] = """===== MEGHAN REAL VOICE SAMPLES (few-shot) =====
{{ $('Meghan Voice Samples (edit here)').first().json.meghan_voice_samples }}
===== END SAMPLES =====

Content agent drafts:
{{ $json.message?.content || $json.text || JSON.stringify($json) }}

Ranking context (for source title/link):
{{ $('⚠️ Ranking Agent (Pick 1)').first().json.message?.content || $('⚠️ Ranking Agent (Pick 1)').first().json.text || '' }}"""

# Also inject samples into regenerate agent user message for consistency
regen = next(n for n in nodes if n["name"] == "⚠️ Regenerate Post Agent")
# Keep system short; add samples in user message
vals = regen["parameters"]["messages"]["values"]
vals[1]["content"] = """===== MEGHAN REAL VOICE SAMPLES (few-shot) =====
{{ $('Meghan Voice Samples (edit here)').first().json.meghan_voice_samples }}
===== END SAMPLES =====

Previous post:
{{ $('Parse Approval Response').first().json.post_text }}

Feedback:
{{ $('Parse Approval Response').first().json.feedback || 'Make it sharper, more specific, less generic.' }}

Original ranking/story context:
{{ $('⚠️ Ranking Agent (Pick 1)').first().json.message?.content || $('⚠️ Ranking Agent (Pick 1)').first().json.text || '' }}"""

# Rewire: Content -> Voice Samples Set -> Founder Voice
conns = data["connections"]
conns["⚠️ Content Agent (3 Drafts)"] = {
    "main": [[{"node": "Meghan Voice Samples (edit here)", "type": "main", "index": 0}]]
}
conns["Meghan Voice Samples (edit here)"] = {
    "main": [[{"node": "⚠️ Founder Voice: Meghan Vaze", "type": "main", "index": 0}]]
}

# Setup sticky
sticky = next((n for n in nodes if n["name"] == "Setup Notes"), None)
if sticky:
    sticky["parameters"]["content"] = """## LinkedIn Daily Knowledge Pipeline

**Voice data is IN this workflow** — node: `Meghan Voice Samples (edit here)`

Paste more Meghan LinkedIn posts into that node's `meghan_voice_samples` field. Founder Voice + Regenerate both read it.

**Flow:**
Cron/Manual → RSS → Research → Rank → Content → Voice Samples → Meghan Voice → Image → Telegram → Publish / Regenerate

**Before activating:**
1. Connect OpenAI, Telegram, LinkedIn credentials (⚠️ nodes)
2. Set Telegram Chat ID
3. Test with Manual Trigger first"""

path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

# verify
d = json.loads(path.read_text(encoding="utf-8"))
setn = next(n for n in d["nodes"] if n["name"] == "Meghan Voice Samples (edit here)")
val = setn["parameters"]["assignments"]["assignments"][0]["value"]
print("OK")
print("voice node present:", True)
print("samples_chars:", len(val))
print("has Physiology:", "Physiology of User Stress" in val)
print("Content connects to:", d["connections"]["⚠️ Content Agent (3 Drafts)"]["main"][0][0]["node"])
print("Samples connect to:", d["connections"]["Meghan Voice Samples (edit here)"]["main"][0][0]["node"])
fv = next(n for n in d["nodes"] if "Founder Voice" in n["name"])
print("Founder user msg references samples node:", "Meghan Voice Samples" in fv["parameters"]["messages"]["values"][1]["content"])
