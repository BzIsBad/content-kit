# The brand interview

This is the script for getting to know a brand. The `setup` and `add-brand` skills both use it. The answers end up in two files: `brand-guide.md` (for people, and for Claude when it edits) and `brand.json` (the settings the video tool reads). The exact mapping to `brand.json` is in [brand-json-mapping.md](brand-json-mapping.md).

## Contents

1. How to run it
2. What "good enough" means
3. When to stop and clarify
4. Workspace questions (asked once)
5. Brand questions, by guide section (asked per brand)
6. Recipe questions
7. Examples and files
8. Saving as you go, and picking up where you left off

## 1. How to run it

- **One question per message.** Wait for the answer before you ask the next one. A wall of questions feels like a form; one at a time feels like a conversation, and you get better answers.
- **Say why when it isn't obvious.** One short clause: "so I know how long to make your videos". People answer better when they know what the answer is for.
- **Use their words.** Write down what they said, tidied but not rewritten. Their phrasing is the voice you're trying to capture.
- **Offer an example answer** when a question is abstract ("Three words for how you sound, like *warm, quick, a bit cheeky*").
- **Let them skip.** If they don't know yet, write `_(not answered yet)_` in the guide, use the default from the mapping, and move on. Tell them they can fill it in later by asking you to update the brand guide.
- **Keep the pace.** The whole interview should take 20 to 40 minutes per brand. If an answer already covers a later question, don't ask it again; confirm it in one line instead ("You mentioned you never swear on camera, so I've put that under never-do.").
- **No jargon.** Don't say JSON, hex code, schema, render, slug, config or parameter to the client. Say "colour code", "setting", "short name", "make the video".
- **Every few sections, play it back.** "Here's what I've got so far for your voice: ... Anything wrong?" This catches misunderstandings early.

## 2. What "good enough" means

An answer is good enough when you could make an editing choice from it without guessing. Test each answer against that. Concretely:

| Kind of answer | Good enough | Not yet |
| --- | --- | --- |
| Describing words | Specific and different from each other: "warm, quick, a bit cheeky" | Generic: "professional, engaging, high quality" (every brand says this) |
| A rule | Something you could check a video against: "no more than 2 emojis", "never show a client's face without a yes from them" | A feeling: "keep it classy" |
| A colour | A colour code, a file it can be read from, or a named colour they confirm when you show the code you picked | "Our blue" |
| A length | Numbers: "30 to 60 seconds" | "Short" |
| An example | A file or link **plus** what they like or dislike about it | A link with no reason |
| An approval rule | Who, for what, how fast: "my partner checks anything with a price in it, same day" | "We check things" |

Most sections need two or three good-enough answers, not perfection. When a section has them, move on.

## 3. When to stop and clarify

Stop and ask a follow-up, instead of guessing, when:

- **The answer is generic** (see the table). Ask for the opposite: "What would *un*professional look like for you?" or "Can you point to a post that gets this right?"
- **Two answers disagree.** "Earlier you said calm and slow, but your favourite example cuts every second. Which should I follow?"
- **It would change an edit and you'd be guessing.** Lengths, colours, what's off-limits, who has to approve: always confirm.
- **It names a person, a client, a claim or a number** (a price, a result, a medical or legal claim). Ask whether it needs approval before posting, and note it under section 9.

Don't clarify things that don't change an edit. One follow-up per question is usually enough. If the second answer is still vague, write down what they said, mark it `_(rough, check later)_`, and move on.

## 4. Workspace questions (asked once, before the first brand)

**W1. Brands.** "What's the name of your business? And do you post under more than one name, like a second business or a separate page?"
- Good enough: a list of one or more brand names, exactly as they're written publicly.
- Each name becomes a brand. Interview them one at a time; finish one before starting the next.

**W2. Team size.** "How many people work in the business, counting you? Count anyone who might make videos with this, part-time or not."
- Good enough: a whole number.
- Maps to `teamSize`. If they run several brands as one business, it's the same number for each.
- Then ask: "Is the business a registered charity or non-profit?" (yes / no).
- **The licence note.** The video tool inside this kit (Remotion) is free for small teams. If the team is **3 or more** and the business isn't a non-profit, the business may need its own paid licence for it later, depending on what they use it for. Mention it once, in one or two plain sentences, then carry on. It never stops or slows setup, and don't suggest anyone else will pay for it or sort it out. Something like:
  > "One thing to know for later: the video tool inside this kit is free for small teams, and with N people you may need your own licence for it at some point, depending on how you use it. Nothing to do now. It doesn't affect setting up."
- Write the note into section 1 of the guide, so it's there when they need it.

**W3. Where the files will live.** Only if the workspace check found a problem (a cloud-synced folder): see the setup skill. Otherwise skip.

## 5. Brand questions (per brand)

Ask them in this order. The number in brackets is the guide section the answer goes in. Fields in `code` are the `brand.json` settings it feeds; see the mapping file for the exact rules.

### Section 1: Snapshot

**1a.** "In one sentence, what does {brand} do and for whom?"
- Good enough: says what they sell or do, and who for. "Mobile dog grooming for busy families in the north suburbs."
- Feeds `name` (confirm the exact spelling and capitals here) and the short name for folders (`slug`).

**1b.** "Who's watching your videos? Tell me about your best customer: who they are and what they care about."
- Good enough: two or three specifics (age range, situation, what they worry about or want).

**1c.** "What are the three to five things you post about most?" (Example: *before-and-afters, quick tips, behind the scenes, customer stories*.)
- Good enough: three to five topics. These are the content pillars.

### Section 2: Voice

**2a.** "Three words for how you sound." (Example: *warm, quick, a bit cheeky*.)
- Clarify if generic (see section 2 of this file).

**2b.** "Any words or phrases you say a lot, the ones people would recognise as you?"

**2c.** "Any words you never want to use?" (Example: *cheap, guys, slay*, or industry words your customers don't know.)
- These also go in section 8.

**2d.** "How do you write captions? Long or short sentences, emojis or not, any punctuation you love or hate?"
- Good enough: a rule you could check. "Short sentences, two emojis at most, no exclamation marks."

**2e.** "Could you paste two or three captions you've written that sound most like you?"
- Optional, but these are gold. Copy them in exactly.

### Section 3: Hooks and calls to action

**3a.** "When a video does well for you, what's usually in the first two or three seconds?" (Example: *a question, the finished result, a bold claim, a mistake people make*.)
- Good enough: one or more hook styles, ideally with a real example line.

**3b.** "When someone finishes watching, what do you want them to do?" (Book, buy, call, visit, follow.)
- Then: "How would you say that in a few words, for the end of your videos?" (Example: *Book at fetchgrooming.example*.)
- Good enough: one short line, under about 40 characters, that works on screen.
- Feeds `reel.endCard.cta`.

### Section 4: Look

**4a. Colours.** "What are your brand colours? If you have the colour codes, great. If not, I can read them from your logo or website."
- Good enough: two to five colours, each with a colour code, and which one should stand out (the accent).
- If they only have names ("navy and coral"), propose codes, show them as a list ("navy #1F2A44, coral #E0703A"), and ask them to confirm. If they give a logo, look at it and pick the codes from it, then confirm.
- Feeds `colors.*`.

**4b. Logo.** "Do you have your logo as a file? Please drop it into the `brands/{slug}/assets/` folder I've made. If you have a light version for dark backgrounds and a dark version for light ones, add both."
- Look at each file once it's there. Ask which version goes on dark backgrounds if it isn't obvious.
- Good enough: at least one logo file, ideally a PNG with a see-through background. A logo on a solid white box will look like a sticker; say so kindly and suggest they find a version without the box.
- Feeds `logo.*`.

**4c. Fonts.** "Do you use particular fonts? If you have the font files (they end in .ttf or .otf), drop them into `brands/{slug}/assets/fonts/`."
- Good enough: a font name for headlines and for everything else, or "no idea". If they have a name but no file, note it; the kit uses a clean stand-in font until the file is added.
- Feeds `fonts.*`.

**4d.** "How would you describe the look of your photos and videos? Bright or moody, close-up or wide, polished or casual?"

### Section 5: Video style

**5a. Captions.** "For the words on screen, which do you like best: each word lighting up as it's said, a full line at a time, or no captions at all?"
- Show it as three plain choices. Most people pick the first; it's the default.
- Then: "Lower down on the screen, or in the middle?" Default: lower down.
- Feeds `captions.*`.

**5b. Pacing.** "How fast should your videos feel? Some brands cut every second or two; others let a moment breathe."
- Good enough: something you could edit to. "Quick: a new shot every 2–3 seconds, no long pauses."

**5c. Music.** "Do you use music under your videos? If you have a track you own or have paid to use, drop it in `brands/{slug}/assets/music/`."
- Only use music they have the right to use. Don't download or suggest songs; trending songs are added in the app when posting, not baked into the video.
- Feeds `music.*`.

**5d.** "Anything you love or hate in other people's videos? Zooms, transitions, emojis on screen, text all over the place?"

Recipe questions for video length, framing and the end card come next: see section 6.

### Section 6: Platform rules

**6a.** "Where do you post: Instagram, TikTok, Facebook, YouTube Shorts, somewhere else? Which matters most?"

**6b.** "For each, anything specific? How long your captions are, how many hashtags, which days you post?"
- Fill the table in the guide. Blank cells are fine.

### Section 7: Examples (the most important section)

See section 7 of this file. Ask for:
- **7a.** Two to five posts they're proud of, or that did well, and why. Numbers if they have them (views, saves, bookings).
- **7b.** Two or three posts that are "not us": theirs or anyone's, and what's wrong with them.

Examples teach more than any description. Don't skip this section unless they truly have nothing; if so, ask them to send some later and say plainly that the first videos will get better once they do.

### Section 8: Never do

**8a.** "What should never appear in your videos? Words, topics, things on screen?"
**8b.** "Anything about people on camera? For example, customers who haven't said yes, kids, other staff."
**8c.** "Any claims you have to be careful with: prices, results, before-and-afters, health, money?"
- Good enough: a list of checkable rules. Combine with 2c.

### Section 9: Who approves

**9a.** "Before a video goes out, does anyone need to see it? Who, and for what kind of video?"
**9b.** "How fast do you usually need it back?"
- Good enough: "Nobody, I post myself" is a fine answer. Otherwise who, for what, how fast.

## 6. Recipe questions

Each recipe can add questions. Read `questions` in every `recipe.json` under `PLUGIN_ROOT/recipes/` (`PLUGIN_ROOT` is the plugin folder the skill you came from names) and ask them in the section they name, in the order given. Each question carries its own wording, good-enough bar and the `brand.json` field it feeds, so follow it as written. For v1 that's the `reel` recipe: video length, framing, watermark and the end card.

## 7. Examples and files

- **Where things go.** Examples into `brands/{slug}/examples/`; logo into `assets/`; fonts into `assets/fonts/`; music into `assets/music/`. Create those subfolders if they're missing. Tell them they can drag files straight into the folder in their file browser.
- **Links work too.** If they paste a link, write it in the guide's examples table. Don't download videos from social platforms.
- **Look at what they give you.** Open images yourself. For a video, you can't watch it, but you can pull a few frames with the kit's `frames` command later; for now, ask what they like about it.
- **Notes stay with the example.** Write a matching line in section 7 of the guide: the file name, then why it works or why it's "not us".
- **Never use a client's real footage or customer photos as an example in the guide without asking.** Linking to their own public post is fine.

## 8. Saving as you go, and picking up where you left off

- Right after 1a, create the brand folder (the setup skill shows how) and copy the brand guide template into `brands/{slug}/brand-guide.md`.
- After each section, write the answers into that section of the guide. Don't wait until the end. If the session stops, nothing is lost.
- Leave unanswered items as `_(not answered yet)_`.
- To resume, read the guide and start at the first section that still has `_(not answered yet)_` in a required place. Say where you're picking up: "Last time we got through your colours. Next is video style."
