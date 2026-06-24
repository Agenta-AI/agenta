"""Backfill corrected public docs URLs into the vector-store payloads, in place.

The public URL is derived from each doc's file path + frontmatter `slug` (see `loaders.py`:
Docusaurus strips numeric ordering prefixes, and an absolute frontmatter `slug` overrides
the path). Older ingests stored stale URLs (kept the `NN-` prefix, ignored frontmatter
slugs) that 404. This rewrites ONLY the `url` payload field — no re-embedding, no model
cost — by re-deriving URLs with the current loader and matching points by `file_path`.

    python -m ingest.fix_urls --source ../../../docs/docs --base-url https://docs.agenta.ai
"""

import argparse
import os
from collections import defaultdict

from dotenv import load_dotenv
from qdrant_client import QdrantClient

from .loaders import load_mdx


def main():
    parser = argparse.ArgumentParser(description="Backfill corrected doc URLs in Qdrant")
    parser.add_argument("--source", required=True, help="Path to docs directory")
    parser.add_argument("--base-url", required=True, help="Base URL for doc links")
    parser.add_argument("--collection", default=None, help="Collection (default: from env)")
    args = parser.parse_args()

    load_dotenv()
    collection = args.collection or os.getenv("COLLECTION_NAME", "docs_collection")

    url_by_path = {d.file_path: d.url for d in load_mdx(args.source, args.base_url)}
    print(f"Re-derived {len(url_by_path)} URLs from {args.source}")

    client = QdrantClient(url=os.getenv("QDRANT_URL"), api_key=os.getenv("QDRANT_API_KEY"))

    pending: dict[str, list] = defaultdict(list)  # correct_url -> [point ids needing it]
    scanned = 0
    offset = None
    while True:
        points, offset = client.scroll(
            collection, limit=256, with_payload=True, offset=offset
        )
        for p in points:
            scanned += 1
            correct = url_by_path.get(p.payload.get("file_path"))
            if correct and correct != p.payload.get("url"):
                pending[correct].append(p.id)
        if offset is None:
            break

    updated = 0
    for url, ids in pending.items():
        client.set_payload(collection, payload={"url": url}, points=ids)
        updated += len(ids)

    print(
        f"Scanned {scanned} points; updated {updated} URLs across "
        f"{len(pending)} docs in '{collection}'."
    )


if __name__ == "__main__":
    main()
