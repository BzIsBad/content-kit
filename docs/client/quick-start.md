# Your content kit: quick start

This turns the Claude app on your computer into a video editor that knows your brand. You tell it about your business once. After that, you drop in a long recording, say what you want, and get back a short vertical video (15 to 90 seconds) with captions, your logo and your colours, ready to post.

Everything it makes stays on your computer, in a folder you own.

## What you need

- A Mac with macOS 15 (Sequoia) or newer, or a Windows 10 or 11 PC. (On the few PCs with an ARM chip, it needs Windows 11.)
- The Claude desktop app, on a Pro plan or higher.
- About 20 GB of free space, and an internet connection for the first setup.
- About an hour the first time: 10 minutes for setup, then 20 to 40 minutes of questions about your brand.
- Have these handy if you can: your logo, your brand colours, a few posts you love and a few that are "not you".

## Set it up (once)

1. **Make a new folder** for your videos, somewhere that doesn't sync to the cloud. Your home folder is a good spot; call it something like **Content**. Not in Dropbox, Google Drive, OneDrive or iCloud: big video files and syncing don't get along.
2. **Open the Claude app**, go to the **Code** tab, and open that folder.
3. **Add the kit.** Type these two lines, one at a time:
   ```
   /plugin marketplace add bzisbad/content-kit
   /plugin install content-kit@content-kit
   ```
4. **Say "set me up".** Claude checks your computer, installs what it needs (no passwords, nothing outside one folder), and then asks you about your brand, one question at a time. Answer in your own words. "I don't know yet" is fine.
5. **Watch the test clip.** Claude makes a five-second clip in your colours. Tell it if anything looks off.

When it's done, you'll have a brand guide, a test clip, and a skill named after your brand, like `/yourbrand-reel`.

## Make a video (every time)

1. **Drop your recording** into `brands/<your-brand>/raw/`. Straight off your phone or camera is fine.
2. **Say what you want**, in plain words: *"Make a 45-second reel from today's recording. Use the part about spring prep."*
3. **Look at it.** Your video lands in `brands/<your-brand>/exports/`.
4. **Say what to change**: *"Start with the before-and-after shot, and cut the bit where I check my notes."* Claude makes a new version and keeps the old one. It also writes down anything worth remembering, so the next video starts better.

## Good to know

- **Your original recordings are never changed or deleted.**
- **Claude never posts anything for you.** You post when you're happy.
- **Nothing is locked in.** The folder, the brand guide and the skills are plain files on your computer. Copy them, back them up, take them anywhere.
- **The video tool is free for small teams.** If three or more people work in your business (and it isn't a non-profit), you may need your own licence for it later, depending on how you use it. Setup mentions it if it applies; it never holds anything up.
- **If something stops working**, say *"check my video setup"*. Claude finds the problem and fixes what it can.
- **More than one business?** Say *"add another brand"*.
- **Something's changed about your brand?** Say *"update the brand guide for <brand>"*, then *"update the <brand> video skill"*.

## Need a hand?

Get in touch with whoever set this up with you.
