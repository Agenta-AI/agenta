import os
import re
from typing import Union, Dict, Set
import sys

database = sys.argv[1]

MIGRATIONS_DIR = f"./{database}/versions/"

revision_pattern = re.compile(r'revision\s*:\s*str\s*=\s*"([a-f0-9]+)"')
down_revision_pattern = re.compile(
    r'down_revision\s*:\s*Union\[str,\s*None\]\s*=\s*(?:"([^"]+)"|None)'
)

revisions: Dict[str, Union[str, None]] = {}
all_down_revisions: Set[str] = set()

for filename in os.listdir(MIGRATIONS_DIR):
    if not filename.endswith(".py"):
        continue

    print("---------")
    print("file:", filename)

    with open(os.path.join(MIGRATIONS_DIR, filename), encoding="utf-8") as f:
        content = f.read()
        revision_match = revision_pattern.search(content)
        down_revision_match = down_revision_pattern.search(content)

        print("revision:", revision_match)
        print("down_revision:", down_revision_match)
        if revision_match:
            revision = revision_match.group(1)
            down_revision = (
                down_revision_match.group(1) if down_revision_match else None
            )
            if down_revision in ("None", ""):
                down_revision = None
            revisions[revision] = down_revision
            if down_revision:
                all_down_revisions.add(down_revision)

# head(s) = revisions that are not anyone's down_revision
heads = [rev for rev in revisions if rev not in all_down_revisions]

print("Heads:", heads)
