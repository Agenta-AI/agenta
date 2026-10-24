"""Email address normalization shared by the sign-up checks."""

# Google delivers both domains to one mailbox and ignores dots in the local part:
# `us.er@googlemail.com` is `user@gmail.com`.
GMAIL_DOMAIN = "gmail.com"
GMAIL_ALIASES = frozenset({"gmail.com", "googlemail.com"})


def normalize_email(email: str) -> str:
    """The provider-normalized form: lowercased and stripped, a `+tag` suffix dropped
    from the local part for every domain, and for Gmail the dots removed from the local
    part and `googlemail.com` folded into `gmail.com`. So `User+a@gmail.com`,
    `user+b@gmail.com`, `us.er@gmail.com` and `user@googlemail.com` are one address. An
    address without exactly one `@` is only lowercased and stripped."""
    normalized = email.strip().lower()
    if normalized.count("@") != 1:
        return normalized
    local, domain = normalized.split("@", 1)
    local = local.partition("+")[0]
    if domain in GMAIL_ALIASES:
        local = local.replace(".", "")
        domain = GMAIL_DOMAIN
    return f"{local}@{domain}"
