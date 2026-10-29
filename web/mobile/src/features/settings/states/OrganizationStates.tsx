import {SkeletonBlock} from "@agenta/ui/ui"

// States for the Access & Security tab, which is driven by the organization query. It used to
// `return null` for all three of loading, error and no-flags, so a slow query and a failed one
// were both a blank tab with nothing to read and nothing to press.

const SkeletonSection = ({rows}: {rows: number}) => (
    <section className="flex flex-col gap-3" aria-hidden>
        <div className="flex flex-col gap-1.5">
            <SkeletonBlock active className="h-[18px] w-28 rounded" />
            <SkeletonBlock active className="h-4 w-72 max-w-full rounded" />
        </div>
        <div className="flex flex-col divide-y divide-solid divide-border overflow-hidden rounded-[10px] border border-solid border-border">
            {Array.from({length: rows}, (_, index) => (
                <div key={index} className="flex items-center justify-between gap-6 px-[18px] py-4">
                    <div className="flex flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-4 w-40 rounded" />
                        <SkeletonBlock active className="h-3.5 w-80 max-w-full rounded" />
                    </div>
                    <SkeletonBlock active className="h-5 w-9 shrink-0 rounded-full" />
                </div>
            ))}
        </div>
    </section>
)

/** The page's own shape while flags and entitlements load: sign-in, membership, admin. */
export const OrganizationLoading = () => (
    <div className="flex flex-col gap-8" role="status" aria-label="Loading organization settings">
        <SkeletonSection rows={3} />
        <SkeletonSection rows={2} />
        <SkeletonSection rows={1} />
    </div>
)

/** Settled, but the organization carries no flags — nothing to configure rather than an error. */
export const OrganizationNoFlags = () => (
    <p className="text-muted-foreground p-6 text-xs">
        This organization has no access settings to configure.
    </p>
)
