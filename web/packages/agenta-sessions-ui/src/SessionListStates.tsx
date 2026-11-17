import {useT} from "@agenta/i18n"
import sessionsListStatesCatalog from "@agenta/i18n/catalogs/sessions.listStates"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

/** Mirrors a row's geometry so real rows replace it without shifting the list. */
export const SessionListSkeleton = ({rows = 8}: {rows?: number}) => {
    const t = useT(sessionsListStatesCatalog)
    return (
        <div aria-busy="true" aria-label={t("sessions.listStates.loading")}>
            {Array.from({length: rows}, (_, index) => (
                <div
                    key={index}
                    className="flex items-center gap-3 px-3 py-2 border-solid border-0 border-b border-colorBorderSecondary"
                >
                    <span className="shrink-0 w-2 h-2 rounded-full bg-colorFillSecondary" />
                    <SkeletonBlock active className="h-4 min-w-0 flex-1" />
                    {/* Hidden below `sm`, mirroring the two columns SessionRow drops there. */}
                    <SkeletonBlock active className="hidden h-4 w-40 flex-none sm:block" />
                    <SkeletonBlock active className="hidden h-4 w-24 flex-none sm:block" />
                </div>
            ))}
        </div>
    )
}

export const SessionListEmpty = ({
    filtered,
    onClearFilters,
}: {
    filtered: boolean
    onClearFilters: () => void
}) => {
    const t = useT(sessionsListStatesCatalog)
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <MagnifyingGlassIcon size={24} className="text-colorTextQuaternary" />
            <p className="m-0 text-xs text-colorTextSecondary">
                {filtered ? t("sessions.listStates.noMatch") : t("sessions.listStates.noSessions")}
            </p>
            {filtered ? (
                <Button variant="link" onClick={onClearFilters}>
                    {t("sessions.listStates.clearFilters")}
                </Button>
            ) : (
                <p className="m-0 text-xs text-colorTextTertiary">
                    {t("sessions.listStates.startConversation")}
                </p>
            )}
        </div>
    )
}

/** One group's pager. Each group loads its own next page, in place. */
export const SessionListLoadMore = ({
    loading,
    onClick,
}: {
    loading: boolean
    onClick: () => void
}) => {
    const t = useT(sessionsListStatesCatalog)
    return (
        <div className="flex justify-center py-3">
            <Button variant="outline" disabled={loading} onClick={onClick}>
                {loading ? t("sessions.listStates.loadingMore") : t("sessions.listStates.loadMore")}
            </Button>
        </div>
    )
}

/** A list group's heading. Plain (non-motion) so `sticky` is never fighting a transform. */
export const SessionGroupHeader = ({label}: {label: string}) => (
    <div className="sticky top-0 z-20 bg-colorBgContainer pb-1 pt-4">
        <p className="m-0 px-2 pt-1 text-xs uppercase tracking-wide text-colorTextTertiary">
            {label}
        </p>
    </div>
)
