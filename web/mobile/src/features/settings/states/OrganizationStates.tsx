// States for the Access & Security tab, which is driven by the organization query. It used to
// `return null` for all three of loading, error and no-flags, so a slow query and a failed one
// were both a blank tab with nothing to read and nothing to press.

export const OrganizationLoading = () => (
    <p className="text-muted-foreground p-6 text-xs">Loading organization settings…</p>
)

/** Settled, but the organization carries no flags — nothing to configure rather than an error. */
export const OrganizationNoFlags = () => (
    <p className="text-muted-foreground p-6 text-xs">
        This organization has no access settings to configure.
    </p>
)
