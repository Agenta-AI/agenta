import {useEffect, useRef} from "react"

import {useT} from "@agenta/i18n"
import scenariosCatalog from "@agenta/i18n/catalogs/evaluations.scenarios"
import {Button} from "@agenta/ui/ui"

/**
 * The end of the list: how many rows show, and Load more. Reaching it (or the end of the table's
 * own scroll) loads the next page; the button does the same for keyboard users and for a browser
 * that cannot watch the scroll.
 */
export const ScenariosLoadMore = ({
    loading,
    onLoadMore,
    shown,
    total,
    watchScroll = true,
}: {
    loading: boolean
    onLoadMore: () => void
    shown: number
    /** All rows of the run, when known. */
    total: number | null
    /** Load when the footer scrolls into view. Off under a table that loads from its own scroll. */
    watchScroll?: boolean
}) => {
    const t = useT(scenariosCatalog)
    const sentinel = useRef<HTMLDivElement>(null)
    const latest = useRef(onLoadMore)
    latest.current = onLoadMore

    useEffect(() => {
        const node = sentinel.current
        if (!node || loading || !watchScroll || typeof IntersectionObserver === "undefined") return
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) latest.current()
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [loading, watchScroll])

    return (
        <div ref={sentinel} className="flex items-center justify-center gap-3 py-3">
            {total !== null && total > shown ? (
                <span className="text-meta text-muted-foreground">
                    {t("evaluations.scenarios.showing", {shown, total})}
                </span>
            ) : null}
            <Button variant="outline" size="sm" disabled={loading} onClick={onLoadMore}>
                {loading ? t("evaluations.scenarios.loading") : t("evaluations.scenarios.loadMore")}
            </Button>
        </div>
    )
}
