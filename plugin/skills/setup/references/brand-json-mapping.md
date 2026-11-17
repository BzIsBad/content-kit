# From interview answers to `brand.json`

`brand.json` is the part of the brand the video tool reads. Its shape is fixed by the contract (`docs/spec/contracts.md`, section 2 in the kit repo). `kit.mjs add-brand` writes a starter file. Setup then fills it from the interview using the table below, and checks it with `kit.mjs validate`.

Rules that apply throughout:

- Keep every key the starter file has. Change values; don't add or remove keys. Anything not covered by an answer keeps the default below.
- Paths are relative to the brand folder, with forward slashes: `assets/logo-light.png`, never `C:\...` or `./assets/...`.
- Only point at a file that exists. Check it before you write the path.
- The client never sees this file unless they ask. Talk about "your video settings", not JSON.
- `brand-guide.md` is the source of truth for people. If the two ever disagree, the guide wins: fix `brand.json` to match and tell the client what changed.

## Mapping

| Field | From | Rule | Default if skipped |
| --- | --- | --- | --- |
| `schemaVersion` | — | Always `1` | `1` |
| `slug` | 1a (name) | Lowercase, letters, digits and hyphens only; spaces and symbols become one hyphen; no hyphen at either end; keep it short (2–3 words). "Fetch & Fluff Grooming" → `fetch-fluff`. Show it to the client as "the short name I'll use for folders" and let them change it. It's also the start of the skill name (`fetch-fluff-reel`), so pick something they'd recognise. Never change it after the brand folder exists. | — (required) |
| `name` | 1a | Exactly as written publicly, capitals and punctuation included | — (required) |
| `teamSize` | W2 | Whole number, 1 or more | `1` |
| `colors.primary` | 4a | The main brand colour. `#RRGGBB`, uppercase | `#1F2A44` |
| `colors.secondary` | 4a | The second colour, usually a light or neutral one | `#F4EDE4` |
| `colors.accent` | 4a | The one they said should stand out. Used for the word that's being spoken in highlighted captions | `#E0703A` |
| `colors.text` | 4a | Caption text colour. White unless they want something else; it must be readable over video | `#FFFFFF` |
| `colors.textOutline` | 4a | Caption outline. Black unless the text colour is dark, then white | `#000000` |
| `fonts.headline.family` | 4c | The font name as they gave it | `"Montserrat"` |
| `fonts.headline.file` | 4c | `assets/fonts/<file>` if the file is there, otherwise `null` (the kit uses a stand-in) | `null` |
| `fonts.body.family` / `.file` | 4c | Same rules | `"Inter"` / `null` |
| `logo.onDark` | 4b | The logo version that reads on a dark background (usually the light or white one) | `null` |
| `logo.onLight` | 4b | The version that reads on a light background. If they have only one logo, use it for both, and check it in the test clip | `null` |
| `captions.style` | 5a | "each word lights up" → `word-highlight`; "a line at a time" → `phrase`; "no captions" → `none` | `word-highlight` |
| `captions.position` | 5a | "lower down" → `lower-third`; "middle" → `center` | `lower-third` |
| `captions.maxWordsPerLine` | 5b | Quick pacing → `3`; normal → `4`; calm → `5`. Keep between 2 and 6 | `4` |
| `captions.uppercase` | 2d / 5a | `true` only if they say they like all-caps captions | `false` |
| `captions.fontSizePct` | — | Leave the default unless the test clip shows captions too big or small; then move it by 0.5 at a time, between 4 and 7 | `5.5` |
| `reel.watermark.sizePct` | test clip | The corner logo's width, as a percent of the video's width. "Too small" → add 4; "too big" → take 4 off. Keep between 8 and 35 | `18` |
| `reel.*` | Recipe questions | See `questions` in `recipes/reel/recipe.json`; each question names its field | see recipe |
| `music.defaultTrack` | 5c | `assets/music/<file>` if they gave a track they have the right to use, otherwise `null` | `null` |
| `music.volumeDb` | 5c | `-18` (quiet under speech). "Louder" → `-12`; "barely there" → `-24` | `-18` |

## Colours: getting codes from what they give you

- **They give codes:** use them. Accept `#abc` and expand to `#AABBCC`.
- **They give names:** pick a sensible code, show the list, and ask them to confirm before writing it.
- **They give a logo or a screenshot of their site:** open the image, pick the main colours, show them as a list, and ask them to confirm.
- **They have no colours:** say that's fine, use the defaults, and note in the guide that the colours are placeholders.

## Things that are deliberately not in `brand.json`

Voice, hooks, never-dos, approvals, examples and pacing in words live only in `brand-guide.md`. When skills are generated, they're written into the brand's skill in plain words (see [generate-skills.md](generate-skills.md)). The video tool doesn't need them; the editor (Claude) does.

## Worked example (invented brand)

Answers: brand "Fetch & Fluff Grooming"; team of 2; navy `#1B2B4B`, cream `#F7F1E6`, coral `#F06A4D` as the accent; one white logo `assets/logo-white.png`; no font files but uses "Poppins"; each word lights up, lower down; quick pacing; no music; videos 30–45 s (the kit allows 15 to 90); mostly filmed upright; logo in the top-right corner; end line "Book at fetchfluff.example".

```json
{
  "schemaVersion": 1,
  "slug": "fetch-fluff",
  "name": "Fetch & Fluff Grooming",
  "teamSize": 2,
  "colors": {
    "primary": "#1B2B4B",
    "secondary": "#F7F1E6",
    "accent": "#F06A4D",
    "text": "#FFFFFF",
    "textOutline": "#000000"
  },
  "fonts": {
    "headline": { "family": "Poppins", "file": null },
    "body": { "family": "Poppins", "file": null }
  },
  "logo": { "onDark": "assets/logo-white.png", "onLight": "assets/logo-white.png" },
  "captions": {
    "style": "word-highlight",
    "position": "lower-third",
    "maxWordsPerLine": 3,
    "uppercase": false,
    "fontSizePct": 5.5
  },
  "reel": {
    "minSeconds": 30,
    "maxSeconds": 45,
    "framing": "crop-center",
    "watermark": { "enabled": true, "corner": "top-right", "opacity": 0.9, "sizePct": 18 },
    "endCard": { "enabled": true, "seconds": 2, "cta": "Book at fetchfluff.example" }
  },
  "music": { "defaultTrack": null, "volumeDb": -18 }
}
```

The white logo is used on both backgrounds here. The end card sits on the navy primary colour, so it reads, but flag it when you show the test clip: "Your logo is white, so it'll disappear on light footage. If you have a dark version, drop it in and I'll use it there."
