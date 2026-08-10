/** Mirrors the resolved layout (two buttons + a field) so nothing shifts. */
export const AuthMethodsSkeleton = () => (
    <div className="flex w-full flex-col gap-3" aria-hidden>
        <div className="bg-muted h-11 w-full animate-pulse rounded-md" />
        <div className="bg-muted h-11 w-full animate-pulse rounded-md" />
        <div className="bg-muted h-11 w-full animate-pulse rounded-md" />
    </div>
)
