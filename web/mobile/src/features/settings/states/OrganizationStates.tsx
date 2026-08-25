// States for the Access & Security tab, which is driven by the organization query. It used to
// `return null` for all three of loading, error and no-flags, so a slow query and a failed one
// were both a blank tab with nothing to read and nothing to press.

import {Button} from "@/components/ui/button"

export const OrganizationLoading = () => (
    <p className="text-muted-foreground p-6 text-xs">Loading organization settings…</p>
)

export const OrganizationError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-muted-foreground m-0 text-xs">
            Couldn&apos;t load this organization&apos;s settings.
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

/** Settled, but the organization carries no flags — nothing to configure rather than an error. */
export const OrganizationNoFlags = () => (
    <p className="text-muted-foreground p-6 text-xs">
        This organization has no access settings to configure.
    </p>
)
