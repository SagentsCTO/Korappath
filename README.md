# Korappath

**A living archive of the Korappath family and household — Chiyyaram, Thrissur District, Kerala.**

🔗 [korappath.com](https://korappath.com)

## What this is

The Korappath tharavad has stood alongside Thrissur's growth for generations, but its history has only ever been passed down by word of mouth. This site is an attempt to change that — a place to collect photographs, documents, stories, and a family tree before the people who remember them firsthand are gone.

This archive follows the **Chiyyaram branch** of the family specifically. Other Korappath branches trace back to the same root but split off in earlier generations and settled elsewhere — they are not the focus of this site.

It's built and maintained by family, for family, and for anyone tracing their way back to this household.

## Site structure

The homepage is organized around the four wings of a traditional Kerala *nalukettu* house, arranged around a central courtyard:

| Wing | Malayalam | Section |
|------|-----------|---------|
| North | Vadakkini | History — origins of the household and its place in Thrissur |
| East | Kizhakkini | People — a living family tree |
| South | Thekkini | The House — architecture and photos of the building itself |
| West | Padinjattini | Gallery — photographs and documents |

## How to contribute

You don't need a GitHub account or any technical knowledge to add to this archive.

**If you have a photo, document, or story:** use the submission form linked from the "Add a memory" button on the homepage. Submissions are reviewed before anything is added to the site, just to keep names, dates, and details accurate.

**If you're comfortable with GitHub:** pull requests are welcome for corrections, additional pages, or design improvements. Please open an issue first for anything beyond a small fix, so we can discuss it.

## Editing the family tree

The tree at `family-tree-explore.html` renders from `family-data.json`. To add a person, add an object to the `people` array:

```json
{
  "id": "unique_id",
  "name": "Full name",
  "parentId": "id_of_their_parent_in_this_file",
  "spouse": "Spouse's name (optional)",
  "born": "1920 (optional)",
  "died": "1988 (optional)",
  "location": "Chiyyaram (optional)",
  "story": "Anything worth remembering about them",
  "photo": "URL to a photo (optional)"
}
```

The root ancestor should have `"parentId": null`. Everyone else's `parentId` points to their parent's `id`. Spouses aren't separate tree nodes — they're shown attached to their partner's box.

`family-tree.html` and `family-tree-collapsible.html` are earlier iterations kept in the repo for reference — they're not linked from the live site and can be deleted once you're confident `family-tree-explore.html` covers what you need.

## Adding a story

Stories live in `stories.json`, listed newest-first automatically by the `dateAdded` field. To add one:

1. Copy `stories/sample-story.html` to a new file (e.g. `stories/the-old-house.html`)
2. Replace the placeholder Malayalam and English text, one `<p>` per paragraph
3. Add an entry to `stories.json`:

```json
{
  "id": "the-old-house",
  "titleEn": "English title",
  "titleMl": "മലയാളം തലക്കെട്ട്",
  "excerptEn": "A one- or two-sentence teaser for the listing page.",
  "author": "Full name",
  "period": "Roughly when the story took place",
  "dateAdded": "YYYY-MM-DD",
  "photo": "",
  "storyUrl": "stories/the-old-house.html"
}
```

`dateAdded` is when the story was recorded/added here — not necessarily when the events happened (that's what `period` is for).

## Comments and form submissions

Every form on the site (chapter comments, photo/story submissions, the Write a Story page, tree photos and access requests) goes to a small Cloudflare Worker, and you get an email for each one. Review them all at **https://dash.korappath.com**:

- **Comments:** tap Approve and the comment appears on the chapter straight away. Reject, Unpublish and Delete are there too.
- **Submissions:** read them, view or download any photo, then mark them done (or delete them).

Setup and details: `workers/comments/README.md`.

## Email notifications for new chapters

`feed.xml` is an RSS feed generated automatically from `stories.json` — a GitHub Action (`.github/workflows/generate-feed.yml`) regenerates it every time `stories.json` changes on the main branch and commits it back to the repo. You never need to touch `feed.xml` by hand; just upload an updated `stories.json` as usual, and the feed catches up within a minute or two.

Family members get emailed automatically through **Follow.it** (free), which watches the feed and sends an email whenever a new item appears:

1. Go to follow.it and create a feed using `https://korappath.com/feed.xml`
2. Follow.it gives you a shareable subscribe link
3. Replace the placeholder link in `stories/index.html` (search for `YOUR_FOLLOW_IT_LINK`) with your real one, and re-upload that file
4. Share the same link directly with family via WhatsApp/email if you want — they just enter their email once, no account needed

## Tech

Plain HTML/CSS, no framework or build step — kept intentionally simple so the site is easy to maintain and archive for the long term. Hosted on GitHub Pages, domain via Cloudflare.

## A note on accuracy

Family memory doesn't always agree on dates, spellings, or details — this archive will sometimes hold competing versions of a story rather than force a single "official" one. Where something is uncertain, it'll be marked as such rather than presented as settled fact.

---

*Maintained by the Korappath family. Questions or contributions: see the submission form on [korappath.com](https://korappath.com).*
