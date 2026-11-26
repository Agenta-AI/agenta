/** Loading shapes of the "Add MCP server" list (STATE-02): the search row, a group heading, rows. */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {SkeletonBlock} from "@agenta/ui/ui"

import {CatalogRowSkeleton} from "./CatalogRowSkeleton"

/** A group heading (`pt-3`, one subtitle line) over the catalog rows. */
export function McpServerRowsSkeleton({count = 3}: {count?: number}) {
    return (
        <div aria-hidden className="flex flex-col gap-2">
            {/* The zero-width space gives the heading its subtitle line height. */}
            <div className="flex items-center pt-3 text-subtitle">
                {"\u200b"}
                <SkeletonBlock active className="h-3.5 w-20" />
            </div>
            <CatalogRowSkeleton count={count} />
        </div>
    )
}

/** The whole list while its view loads: the search field and Connect server, then the rows. */
export function McpServerListSkeleton() {
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
                <SkeletonBlock active className="h-control w-35 shrink-0 rounded-control" />
            </div>
            <div className="px-4">
                <McpServerRowsSkeleton />
            </div>
        </div>
    )
}
