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

## Tech

Plain HTML/CSS, no framework or build step — kept intentionally simple so the site is easy to maintain and archive for the long term. Hosted on GitHub Pages, domain via Cloudflare.

## A note on accuracy

Family memory doesn't always agree on dates, spellings, or details — this archive will sometimes hold competing versions of a story rather than force a single "official" one. Where something is uncertain, it'll be marked as such rather than presented as settled fact.

---

*Maintained by the Korappath family. Questions or contributions: see the submission form on [korappath.com](https://korappath.com).*
