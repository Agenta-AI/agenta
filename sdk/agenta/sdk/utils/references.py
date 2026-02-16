from uuid import UUID
import re
import unicodedata


def get_slug_from_name_and_id(
    name: str,
    id: UUID,  # pylint: disable=redefined-builtin
) -> str:
    # Normalize Unicode (e.g., é → e)
    name = unicodedata.normalize("NFKD", name)
    # Remove non-ASCII characters
    name = name.encode("ascii", "ignore").decode("ascii")
    # Lowercase and remove non-word characters except hyphens and spaces
    name = re.sub(r"[^\w\s-]", "", name.lower())
    # Replace any sequence of hyphens or whitespace with a single hyphen
    name = re.sub(r"[-\s]+", "-", name)
    # Trim leading/trailing hyphens
    name = name.strip("-")
    # Last 12 characters of the ID
    slug = f"{name}-{id.hex[-12:]}"

    return slug.lower()
