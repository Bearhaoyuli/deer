# Live Highlights · Fan Archive

A fan-made archive of the best live moments (Douyin `57391519748`), Aug → Nov 2026.
Static site on GitHub Pages; the repo itself is the database. No server, no build step.

## Add moments (fan editors)

1. Open the site → **Fan login**.
2. Create a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new):
   repository access = only this repo, permission **Contents: Read and write**.
3. Paste it. It is kept in your browser only (localStorage).
4. Drag photos / clips / audio anywhere on the page (or paste a screenshot, or use **+ Upload**).
   Set title, date, tags, featured → **Publish**. Use **+ Quote** for text moments.
5. Each publish is a commit. Pages redeploys in ~1 minute.

Hover a card → **Edit** to change text, date, tags, featured, or remove it.

To give another fan edit access: add them as a collaborator on the repo; they make their own token.

## Files

| Path | What |
|------|------|
| `data/config.json` | creator name, tagline, Douyin ID, date range, chapter titles, repo |
| `data/memories.json` | all moments (`image` / `video` / `audio` / `quote`) |
| `media/YYYY-MM/` | uploaded files |
| `media/samples/` | placeholder art — delete once real content exists |

Moment shape:

```json
{ "id": "abc", "date": "2026-10-18", "type": "image", "src": "media/2026-10/abc-photo.jpg",
  "title": "Concert night", "text": "…", "tags": ["music"], "by": "fan name", "featured": true }
```

## Limits

- Files over 45MB are rejected (GitHub caps files at 100MB). Compress long clips first.
- HEIC photos don't render in most browsers — export as JPG.
- Repo should stay under ~1GB for Pages; for lots of video, host clips elsewhere and put the URL in `src`.

## Run locally

```bash
python3 -m http.server 5173
```
