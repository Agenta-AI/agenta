# Postgres stores neither `text` nor `jsonb` containing U+0000: one NUL fails the INSERT with
# `UntranslatableCharacterError` (SQLSTATE 22P05).
_NUL = "\x00"


def strip_nul(value):
    """Drop every U+0000 from a JSON value, in dict keys as well as string values."""
    if isinstance(value, str):
        return value.replace(_NUL, "")
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            clean_key = strip_nul(key) if isinstance(key, str) else key
            if clean_key in result and clean_key != key:
                # Stripping made this key collide with one already kept. The kept entry wins:
                # a NUL-bearing key must never displace a clean one (``"ty\x00pe"`` overwriting
                # ``"type"`` would corrupt the discriminator reconstruction relies on). A clean
                # key reaching here later still overwrites, since ``clean_key == key`` then.
                continue
            result[clean_key] = strip_nul(item)
        return result
    if isinstance(value, list):
        return [strip_nul(item) for item in value]
    if isinstance(value, tuple):
        return tuple(strip_nul(item) for item in value)
    return value
