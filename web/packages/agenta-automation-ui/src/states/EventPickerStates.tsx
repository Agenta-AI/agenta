import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {Lightning, MagnifyingGlass, Plug} from "@phosphor-icons/react"

/**
 * The event picker's right pane when it has nothing to list.
 *
 * Three different facts share this shape, and telling them apart is the whole point: an app the
 * catalog has no events for is not the same as a search that matched none of them, and neither
 * is the same as a workspace with no app connected. Saying "no events" to all three sends the
 * reader looking for a fault that is not there.
 *
 * Same frame as the other empty states in this package — a glyph in a rounded muted square, a
 * line that names the fact, a line that says what to do — centred in the column it fills rather
 * than pinned to its top, where it would read as a row that failed to render.
 */
const EventPickerEmptyFrame = ({
    icon,
    title,
    body,
    action,
}: {
    icon: React.ReactNode
    title: string
    body: string
    action?: React.ReactNode
}) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-8 py-12 text-center">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted">
            {icon}
        </span>
        <p className="m-0 text-[14px] font-medium text-foreground">{title}</p>
        <p className="m-0 max-w-[38ch] text-[13px] leading-snug text-muted-foreground">{body}</p>
        {action}
    </div>
)

/** The app is connected and the catalog simply lists nothing to watch for. */
export const EventListEmpty = ({
    appLabel,
    logo,
    logoLoading = false,
}: {
    appLabel: string
    /** The app's own mark, so the frame names the app the way the rail does. */
    logo?: string | null
    logoLoading?: boolean
}) => {
    const t = useT(automationsEditorCatalog)
    return (
        <EventPickerEmptyFrame
            icon={
                logo ? (
                    <img
                        src={logo}
                        alt=""
                        aria-hidden
                        className="size-5 rounded-[4px] object-contain"
                    />
                ) : logoLoading ? (
                    <SkeletonBlock active className="size-5 rounded-[4px]" />
                ) : (
                    <Lightning aria-hidden size={19} className="text-muted-foreground" />
                )
            }
            title={t("automations.editor.noEventsTitle")}
            body={t("automations.editor.noEventsBody", {app: appLabel})}
        />
    )
}

/** The search narrowed this app's events to none. The query is the cause, so it is quotable. */
export const EventSearchEmpty = ({
    query,
    appLabel,
    hasMore = false,
    loadingMore = false,
    onLoadMore,
    onClear,
}: {
    query: string
    appLabel: string
    /** The catalog is paged; nothing has matched in what is loaded, but more may be coming. */
    hasMore?: boolean
    loadingMore?: boolean
    onLoadMore?: () => void
    onClear: () => void
}) => {
    const t = useT(automationsEditorCatalog)
    return (
        <EventPickerEmptyFrame
            icon={<MagnifyingGlass aria-hidden size={19} className="text-muted-foreground" />}
            title={
                hasMore
                    ? t("automations.editor.nothingYetFor", {query})
                    : t("automations.editor.noAppEventsMatch", {app: appLabel, query})
            }
            body={
                hasMore
                    ? t("automations.editor.moreNotLoaded", {app: appLabel})
                    : t("automations.editor.searchCoversApp")
            }
            action={
                <span className="mt-1 flex items-center gap-2">
                    {hasMore ? (
                        <Button
                            type="button"
                            size="sm"
                            className="text-xs font-normal"
                            disabled={loadingMore}
                            onClick={onLoadMore}
                        >
                            {loadingMore
                                ? t("automations.editor.looking")
                                : t("automations.editor.lookFurther")}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs font-normal"
                        onClick={onClear}
                    >
                        {t("automations.editor.clearSearch")}
                    </Button>
                </span>
            }
        />
    )
}

/** Nothing is connected yet, so there is no catalog to search in the first place. */
export const EventPickerNoApps = ({onConnect}: {onConnect: () => void}) => {
    const t = useT(automationsEditorCatalog)
    return (
        <EventPickerEmptyFrame
            icon={<Plug aria-hidden size={19} className="text-muted-foreground" />}
            title={t("automations.editor.noAppsConnected")}
            body={t("automations.editor.noAppsConnectedBody")}
            action={
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 text-xs font-normal"
                    onClick={onConnect}
                >
                    {t("automations.editor.connectApp")}
                </Button>
            }
        />
    )
}
