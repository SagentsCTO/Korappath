#!/usr/bin/env python3
"""
Generate comic panel images for a Korappath chapter comic.

Stdlib only: no pip installs. Runs on your Mac and calls an image API with
YOUR key, read from an environment variable. The key is never written to disk
and never goes anywhere near the website.

Folder layout (per comic, e.g. comics/chiyyaram-childhood/):
    panels.json   scene descriptions + cast            (committed)
    refs/         real photos of the family             (git-ignored, NEVER commit)
    sheets/       generated character sheets            (git-ignored by default)
    panels/       generated panel images                (review before committing)

Typical run:
    export GEMINI_API_KEY=...            # or OPENAI_API_KEY with --provider openai
    python3 comics/generate.py chiyyaram-childhood sheets
    #   -> look at sheets/*.png, re-run any you dislike with --only niece --force
    python3 comics/generate.py chiyyaram-childhood panels --only 3
    #   -> once panel 3 looks right, use it to lock the art style for the rest:
    python3 comics/generate.py chiyyaram-childhood panels --style-from 3
    #   -> don't like panel 7? make another version alongside it:
    python3 comics/generate.py chiyyaram-childhood panels --only 7 --again

Add --dry-run to any command to see the exact prompts and reference images
without calling the API (costs nothing, needs no key).

Pictures contain NO text: captions and speech bubbles are added later in the
HTML, so the Malayalam stays exactly as Achan wrote it (image models garble
Malayalam script).
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent

DEFAULT_MODELS = {
    # Model names change often. Override with --model if the API says "not found".
    "gemini": "gemini-nano-banana-2.1",
    "openai": "gpt-image-2.6-sunburst",
}
KEY_ENV = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY"}
PHOTO_EXTS = (".jpg", ".jpeg", ".png", ".webp")
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
EXT_FOR_MIME = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
# OpenAI takes fixed sizes, not aspect ratios.
OPENAI_SIZE = {"4:5": "1024x1536", "3:4": "1024x1536", "2:3": "1024x1536",
               "1:1": "1024x1024", "16:9": "1536x1024", "3:2": "1536x1024", "4:3": "1536x1024"}


# ---------------------------------------------------------------- helpers

def die(msg):
    print(f"\n✗ {msg}", file=sys.stderr)
    sys.exit(1)


def find_image(folder: Path, stem: str):
    """Return the first existing image file named <stem>.<ext> in folder."""
    for ext in PHOTO_EXTS:
        p = folder / f"{stem}{ext}"
        if p.exists():
            return p
    heic = [p for p in folder.glob(f"{stem}.*") if p.suffix.lower() in (".heic", ".heif")]
    if heic:
        die(f"{heic[0].name} is HEIC. Convert it first:\n"
            f"  sips -s format jpeg '{heic[0]}' --out '{folder / (stem + '.jpg')}'")
    return None


def existing_outputs(folder: Path, stem: str):
    return sorted(p for p in folder.glob(f"{stem}*") if p.suffix.lower() in PHOTO_EXTS)


def next_variant_stem(folder: Path, stem: str):
    if not existing_outputs(folder, stem):
        return stem
    i = 2
    while existing_outputs(folder, f"{stem}-v{i}"):
        i += 1
    return f"{stem}-v{i}"


def save(folder: Path, stem: str, data: bytes, mime: str, replace: bool):
    folder.mkdir(parents=True, exist_ok=True)
    if replace:  # remove old copies with any extension so there's one current file
        for old in folder.glob(f"{stem}.*"):
            if old.suffix.lower() in PHOTO_EXTS:
                old.unlink()
    out = folder / f"{stem}{EXT_FOR_MIME.get(mime, '.png')}"
    out.write_bytes(data)
    return out


def post_json(url, headers, body, attempts=3):
    data = json.dumps(body).encode()
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(url, data=data, method="POST",
                                     headers={"Content-Type": "application/json", **headers})
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:800]
            if e.code in (429, 500, 502, 503) and attempt < attempts:
                wait = 20 * attempt
                print(f"    API busy ({e.code}); retrying in {wait}s…")
                time.sleep(wait)
                continue
            raise RuntimeError(f"HTTP {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            if attempt < attempts:
                time.sleep(10)
                continue
            raise RuntimeError(f"Network error: {e.reason}") from None


# ---------------------------------------------------------------- providers
# refs: list of (label, Path). Each provider returns (bytes, mime).

def call_gemini(model, key, prompt, refs, aspect):
    parts = [{"text": prompt}]
    for label, path in refs:
        parts.append({"text": label})
        parts.append({"inlineData": {"mimeType": MIME[path.suffix.lower()],
                                     "data": base64.b64encode(path.read_bytes()).decode()}})
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE"],
                                 "imageConfig": {"aspectRatio": aspect}}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    res = post_json(url, {"x-goog-api-key": key}, body)
    texts = []
    for cand in res.get("candidates", []):
        for part in (cand.get("content") or {}).get("parts", []):
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                return base64.b64decode(blob["data"]), blob.get("mimeType") or blob.get("mime_type", "image/png")
            if part.get("text"):
                texts.append(part["text"])
    reason = (res.get("promptFeedback") or {}).get("blockReason") or \
             ", ".join(c.get("finishReason", "") for c in res.get("candidates", []))
    raise RuntimeError(f"No image returned ({reason or 'no reason given'}). {' '.join(texts)[:400]}")


def call_openai(model, key, prompt, refs, aspect):
    headers = {"Authorization": f"Bearer {key}"}
    size = OPENAI_SIZE.get(aspect, "auto")
    if refs:
        labelled = prompt + "\n\n" + "\n".join(f"Input image {i + 1}: {label}" for i, (label, _) in enumerate(refs))
        images = [{"image_url": f"data:{MIME[p.suffix.lower()]};base64,{base64.b64encode(p.read_bytes()).decode()}"}
                  for _, p in refs]
        body = {"model": model, "prompt": labelled, "images": images, "size": size, "quality": "high"}
        res = post_json("https://api.openai.com/v1/images/edits", headers, body)
    else:
        body = {"model": model, "prompt": prompt, "size": size, "quality": "high"}
        res = post_json("https://api.openai.com/v1/images/generations", headers, body)
    try:
        return base64.b64decode(res["data"][0]["b64_json"]), "image/png"
    except (KeyError, IndexError):
        raise RuntimeError(f"No image returned: {json.dumps(res)[:400]}") from None


PROVIDERS = {"gemini": call_gemini, "openai": call_openai}


# ---------------------------------------------------------------- prompts

def sheet_job(comic_dir, style, cid, info):
    photo = find_image(comic_dir / "refs", cid)
    refs = []
    if photo:
        refs.append(("Reference photo of the real person to base the character on:", photo))
        likeness = ("Base the character closely on the person in the reference photo: keep their "
                    "recognisable face shape, eyes, hair and skin tone, so family members would know "
                    "who it is, but render them fully in the illustrated style (not photographic). ")
    else:
        likeness = ""
    prompt = (f"Character design sheet for an illustrated children's comic. {likeness}"
              f"The character is {info['role']}. Show the same character four times on a plain "
              f"off-white background: front view, three-quarter view, side view and back view, full "
              f"body, neutral friendly expression, consistent clothing in every view.\n\nArt style: {style}")
    return prompt, refs, "1:1", photo


def panel_job(comic_dir, data, panel, style_from):
    cast = data["cast"]
    refs, missing = [], []
    for i, cid in enumerate(panel["cast"]):
        sheet = find_image(comic_dir / "sheets", cid)
        if sheet:
            refs.append((f"Character sheet for {cast[cid]['role']}. Keep this character's face, hair, "
                         f"body proportions and clothing exactly consistent with this sheet.", sheet))
        else:
            missing.append(cid)
    style_ref = None
    if style_from:
        style_ref = find_image(comic_dir / "panels", f"panel-{style_from:02d}")
        if style_ref is None:
            die(f"--style-from {style_from}: panels/panel-{style_from:02d}.png doesn't exist yet")
        if panel["n"] != style_from:
            refs.append(("An earlier finished panel of the same comic. Match its painting technique, "
                         "colour palette, lighting and line quality exactly; do NOT copy its scene "
                         "or composition.", style_ref))
    who = "; ".join(cast[c]["role"] for c in panel["cast"])
    prompt = (f"One single panel of an illustrated children's comic (a single image, not a page "
              f"of multiple panels).\n\nScene: {panel['scene']}\n\nCharacters in this panel: {who}. "
              f"Any other people are background villagers.\n\nArt style: {data['style']}")
    return prompt, refs, panel.get("aspect", "4:5"), missing


# ---------------------------------------------------------------- main

def parse_only(s):
    return [x.strip() for x in s.split(",") if x.strip()] if s else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("comic", help="folder name under comics/, e.g. chiyyaram-childhood")
    ap.add_argument("step", choices=["sheets", "panels"])
    ap.add_argument("--provider", choices=list(PROVIDERS), default="gemini")
    ap.add_argument("--model", help="override the default model name")
    ap.add_argument("--only", help="comma list: cast ids for sheets (niece,nephew) or panel numbers (3,7)")
    ap.add_argument("--force", action="store_true", help="overwrite existing images")
    ap.add_argument("--again", action="store_true", help="keep existing image, save a new -v2/-v3 version beside it")
    ap.add_argument("--style-from", type=int, metavar="N", help="use finished panel N as a style reference")
    ap.add_argument("--dry-run", action="store_true", help="print prompts and refs; don't call the API")
    a = ap.parse_args()

    comic_dir = HERE / a.comic
    cfg = comic_dir / "panels.json"
    if not cfg.exists():
        die(f"{cfg} not found")
    data = json.loads(cfg.read_text(encoding="utf-8"))
    model = a.model or DEFAULT_MODELS[a.provider]
    key = os.environ.get(KEY_ENV[a.provider])
    if not a.dry_run and not key:
        die(f"Set your API key first:  export {KEY_ENV[a.provider]}=...   (or use --dry-run)")
    call = PROVIDERS[a.provider]
    only = parse_only(a.only)

    if a.step == "sheets":
        out_dir, jobs = comic_dir / "sheets", []
        for cid, info in data["cast"].items():
            if only and cid not in only:
                continue
            prompt, refs, aspect, photo = sheet_job(comic_dir, data["style"], cid, info)
            note = f"from photo {photo.name}" if photo else "from description only (no photo in refs/)"
            jobs.append((cid, prompt, refs, aspect, note))
    else:
        out_dir, jobs = comic_dir / "panels", []
        for p in data["panels"]:
            if only and str(p["n"]) not in only:
                continue
            prompt, refs, aspect, missing = panel_job(comic_dir, data, p, a.style_from)
            note = f"{len(refs)} reference image(s)"
            if missing:
                note += f"; ⚠ no character sheet yet for: {', '.join(missing)} (run 'sheets' first)"
            jobs.append((f"panel-{p['n']:02d}", prompt, refs, aspect, note))

    if not jobs:
        die("Nothing matched --only")

    print(f"{a.step}: {len(jobs)} image(s) via {a.provider} / {model}" + ("  [DRY RUN]" if a.dry_run else ""))
    failures = 0
    for stem, prompt, refs, aspect, note in jobs:
        print(f"\n• {stem}  ({aspect}, {note})")
        existing = existing_outputs(out_dir, stem) if out_dir.exists() else []
        existing = [p for p in existing if p.stem == stem]
        target = stem
        if existing and not (a.force or a.again):
            print(f"  skipped: {existing[0].name} exists (use --force to replace or --again for another version)")
            continue
        if existing and a.again:
            target = next_variant_stem(out_dir, stem)
        if a.dry_run:
            print("  PROMPT:\n    " + prompt.replace("\n", "\n    "))
            for label, path in refs:
                print(f"  REF: {path.relative_to(HERE)}  ← {label[:70]}…")
            continue
        try:
            t = time.time()
            img, mime = call(model, key, prompt, refs, aspect)
            out = save(out_dir, target, img, mime, replace=not a.again)
            print(f"  ✓ saved {out.relative_to(HERE)}  ({len(img) // 1024} KB, {time.time() - t:.0f}s)")
        except RuntimeError as e:
            failures += 1
            print(f"  ✗ {e}")

    if failures:
        print(f"\n{failures} image(s) failed; see messages above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
