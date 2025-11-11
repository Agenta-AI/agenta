from typing import Optional, Tuple


async def parse_service_uri(
    uri: str,
) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    if not uri or not uri.strip():
        return None, None, None, None

    # uri ~ [<provider>|empty]:<kind>:<key>:[<version>|'latest'|empty]

    parts = uri.split(":")

    if len(parts) != 4:
        return None, None, None, None

    return tuple(parts)
