"""List the model presets a Codex CLI build carries in its binary.

Usage:
    python codex_bundled_models.py <path to the codex binary>

Get a binary without installing it:
    npm pack @openai/codex@<version>-linux-x64 && tar xzf openai-codex-*.tgz
    # binary: package/vendor/x86_64-unknown-linux-musl/bin/codex

The script only reads the file. It does not run Codex, so it needs no login. A ChatGPT
account can still hide a listed model from an older client, so confirm a new model with
one live turn before you ship it.

Columns: slug, display name, visibility (``list`` shows in the picker, ``hide`` does not),
priority (lower is first), context window (a Codex default, not the model's limit), and
the description.
"""

import re
import sys

FIELDS = (
    "slug",
    "display_name",
    "visibility",
    "priority",
    "context_window",
    "description",
)
LINE = re.compile(r'\s*"(' + "|".join(FIELDS) + r')": ?(.*?),?\s*$')


def printable_strings(data: bytes, min_len: int = 4):
    for match in re.finditer(rb"[\x20-\x7e\t]{%d,}" % min_len, data):
        yield match.group().decode("ascii")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    with open(sys.argv[1], "rb") as handle:
        data = handle.read()

    models: dict[str, dict[str, str]] = {}
    current = None
    for text in printable_strings(data):
        match = LINE.match(text)
        if not match:
            continue
        key, value = match.groups()
        value = value.strip('"')
        if key == "slug":
            current = value
            models.setdefault(current, {})
        elif current is not None and key not in models[current]:
            models[current][key] = value

    def sort_key(item):
        priority = item[1].get("priority", "999")
        return int(priority) if priority.isdigit() else 999

    for slug, info in sorted(models.items(), key=sort_key):
        print(
            "\t".join(
                [
                    slug,
                    info.get("display_name", ""),
                    info.get("visibility", ""),
                    info.get("priority", ""),
                    info.get("context_window", ""),
                    info.get("description", "")[:90],
                ]
            )
        )


if __name__ == "__main__":
    main()
