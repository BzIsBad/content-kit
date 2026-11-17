<!-- content-kit:workspace -->
# Your video workspace

This folder is where your videos get made. Everything in it is yours: your brand guides, your footage, your finished videos, and the skills Claude uses to edit for you. You can copy it, back it up, or move it to another computer.

## Your brands

{{BRANDS}}

## How to use it

1. **Drop your recording** into the brand's `raw` folder (for example `brands/<your-brand>/raw/`). A long video straight off your phone or camera is fine.
2. **Ask for a video** in plain words, like "Make a reel from yesterday's recording about winter prep, aim for 45 seconds." You can also type `/` and pick the brand's video skill.
3. **Look at what comes back.** Finished videos land in the brand's `exports` folder, named after the job with a version number.
4. **Say what to change** in your own words. Claude makes a new version and keeps the old one. Anything that should apply next time gets written down in the brand's `docs/lessons.md`, so the next video starts better.

Other things you can say:
- "Check my video setup" if something seems broken.
- "Add another brand" to set up a new one.
- "Update the brand guide for <brand>" when something about your brand changes. Then "update the <brand> video skill" so the edits follow it.

## What's in each brand folder

| Folder or file | What it's for |
| --- | --- |
| `brand-guide.md` | How your brand looks and sounds. Edit it any time. |
| `brand.json` | The same settings in the form the video tool reads. Claude keeps it in step with the guide. |
| `assets/` | Your logo, fonts and music |
| `examples/` | Posts you like, and posts that are "not you" |
| `raw/` | Your original recordings. Claude never changes or deletes these. |
| `jobs/` | One folder per video request. The `work` folder inside each one can be deleted to free up space. |
| `exports/` | Your finished videos |
| `docs/lessons.md` | What your feedback has taught Claude |

## How Claude works in this folder

- Edit videos only through the content kit's commands and each brand's video skill.
- Never change, move or delete anything in a `raw` folder, or a finished video in `exports` that has already been handed over.
- Never post, upload or share anything anywhere. Posting is always the owner's call.
- Follow each brand's guide, especially its "Never do" and "Who approves" sections, and that brand's `docs/lessons.md`.
- Talk in plain words. No technical terms unless asked.
- Keep each brand's files in its own folder. Don't mix footage or settings between brands.

_Set up by the content kit {{KIT_VERSION}} on {{GENERATED_ON}}. You can add your own notes below the line; the kit leaves them alone when it updates this file._

<!-- content-kit:end -->
