/** Loading shapes of the catalog lists (STATE-02): rows, a group, the whole list with its search. */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {cn, SkeletonBlock} from "@agenta/ui/ui"

/** Rows in the shape of a CatalogListRow: a 48 px row, the 32 px Mark, a name and one line. */
export function CatalogRowSkeleton({count = 6}: {count?: number}) {
    return (
        <div aria-hidden className="flex flex-col gap-2">
            {Array.from({length: count}).map((_, i) => (
                <div key={i} className="flex h-row-double items-center gap-3">
                    <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
                    <div className="flex flex-1 flex-col gap-1.5">
                        <SkeletonBlock active className="h-3.5 w-1/3" />
                        <SkeletonBlock active className="h-3 w-2/3" />
                    </div>
                </div>
            ))}
        </div>
    )
}

/** A group: the `pt-3` subtitle heading, then its rows 8 px under it. */
export function CatalogGroupSkeleton({rows}: {rows: number}) {
    return (
        <div aria-hidden className="flex flex-col gap-2">
            {/* The zero-width space gives the heading its subtitle line height. */}
            <div className="flex items-center pt-3 text-subtitle">
                {"​"}
                <SkeletonBlock active className="h-3.5 w-20" />
            </div>
            <CatalogRowSkeleton count={rows} />
        </div>
    )
}

/**
 * A catalog view while it loads: the search row with its optional action (a width class), then
 * one group per entry of `groups`, each with that many rows.
 */
export function CatalogListSkeleton({groups, action}: {groups: number[]; action?: string}) {
    const t = useT(commonCatalog)
    return (
        <div
            role="status"
            aria-busy
            aria-label={t("common.loading")}
            // pt-3: where the view body puts the search row.
            className="flex min-h-0 flex-1 flex-col pt-3"
        >
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-1">
                <SkeletonBlock active className="h-control min-w-0 flex-1 rounded-control" />
                {action ? (
                    <SkeletonBlock
                        active
                        className={cn("h-control shrink-0 rounded-control", action)}
                    />
                ) : null}
            </div>
            <div className="flex min-h-0 flex-col gap-2 overflow-hidden px-4">
                {groups.map((rows, i) => (
                    <CatalogGroupSkeleton key={i} rows={rows} />
                ))}
            </div>
        </div>
    )
}
