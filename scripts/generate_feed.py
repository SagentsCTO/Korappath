"""
Regenerates feed.xml from stories.json.

Run manually with: python scripts/generate_feed.py
(Also runs automatically via .github/workflows/generate-feed.yml whenever
stories.json changes on the main branch.)
"""
import json
from datetime import datetime, timezone
from email.utils import format_datetime
import xml.sax.saxutils as sx

BASE = "https://korappath.com"


def parsed_date(story, fallback):
    try:
        return datetime.fromisoformat(story['dateAdded']).replace(tzinfo=timezone.utc)
    except Exception:
        return fallback


def main():
    with open('stories.json', encoding='utf-8') as f:
        stories = json.load(f)

    now = datetime.now(timezone.utc)

    # Only include chapters whose scheduled date has actually arrived —
    # upcoming/future-dated chapters stay out of the public feed until then.
    published = [s for s in stories if parsed_date(s, now) <= now]
    published.sort(key=lambda s: parsed_date(s, now), reverse=True)

    items_xml = []
    for s in published:
        link = f"{BASE}/{s['storyUrl']}"
        title = sx.escape(f"{s['titleMl']} — {s['titleEn']}")
        desc = sx.escape(s.get('excerptEn', ''))
        pub_date = format_datetime(parsed_date(s, now))
        items_xml.append(f"""    <item>
      <title>{title}</title>
      <link>{link}</link>
      <guid isPermaLink="true">{link}</guid>
      <pubDate>{pub_date}</pubDate>
      <description>{desc}</description>
    </item>""")

    last_build = format_datetime(now)
    items_block = chr(10).join(items_xml)

    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Korappath — Stories from the old days</title>
  <link>{BASE}/stories/index.html</link>
  <description>New chapters from the Korappath family archive, in Malayalam with English translation, as they're added.</description>
  <language>en</language>
  <lastBuildDate>{last_build}</lastBuildDate>
{items_block}
</channel>
</rss>
"""

    with open('feed.xml', 'w', encoding='utf-8') as f:
        f.write(feed)

    print(f"Generated feed.xml with {len(published)} item(s)")


if __name__ == '__main__':
    main()
