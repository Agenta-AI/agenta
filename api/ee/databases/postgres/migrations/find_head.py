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
filenames: Dict[str, str] = {}
all_down_revisions: Set[str] = set()

for filename in os.listdir(MIGRATIONS_DIR):
    if not filename.endswith(".py"):
        continue

    with open(os.path.join(MIGRATIONS_DIR, filename), encoding="utf-8") as f:
        content = f.read()
        revision_match = revision_pattern.search(content)
        down_revision_match = down_revision_pattern.search(content)

        if revision_match:
            revision = revision_match.group(1)
            down_revision = (
                down_revision_match.group(1) if down_revision_match else None
            )
            if down_revision in ("None", ""):
                down_revision = None
            revisions[revision] = down_revision
            filenames[revision] = filename
            if down_revision:
                all_down_revisions.add(down_revision)

# head(s) = revisions that are not anyone's down_revision
heads = [rev for rev in revisions if rev not in all_down_revisions]


def build_tree_forward(
    revision: str,
    revisions: Dict,
    filenames: Dict,
    visited: Set[str],
    prefix: str = "",
    is_fork: bool = False,
) -> None:
    """Build and print the migration tree recursively, going from parents to children."""
    if revision in visited:
        return
    visited.add(revision)

    # Print the current node
    if is_fork:
        connector = "├── "
        new_prefix = prefix + "│   "
    else:
        connector = "└── "
        new_prefix = prefix

    filename = filenames.get(revision, "")
    print(f"{prefix}{connector}{filename}")

    # Find all revisions that have this one as their down_revision (children)
    children = [rev for rev in revisions if revisions[rev] == revision]

    if children:
        # Sort children for consistent output
        children.sort()
        for i, child in enumerate(children):
            is_last_child = i == len(children) - 1
            # Only pass is_fork=True if this is not the last child (there's a fork)
            build_tree_forward(
                child, revisions, filenames, visited, new_prefix, not is_last_child
            )


# Find root migrations (those with no down_revision pointing to them)
roots = [rev for rev in revisions if revisions[rev] is None]

# Print full tree
print("Migration History Tree:")
print()

visited: Set[str] = set()
roots.sort()
for root in roots:
    visited.add(root)
    filename = filenames.get(root, "")
    print(f"└── {filename}")

    # Build tree from this root forward
    children = [rev for rev in revisions if revisions[rev] == root]
    children.sort()

    for i, child in enumerate(children):
        is_last_child = i == len(children) - 1
        build_tree_forward(child, revisions, filenames, visited, "", not is_last_child)

print()
print(f"Heads: {heads}")
