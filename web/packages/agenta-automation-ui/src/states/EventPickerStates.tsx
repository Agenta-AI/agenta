import {Button} from "@agenta/ui/ui"
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
export const EventListEmpty = ({appLabel}: {appLabel: string}) => (
    <EventPickerEmptyFrame
        icon={<Lightning aria-hidden size={19} className="text-muted-foreground" />}
        title="No events to watch"
        body={`${appLabel} is connected, but it publishes nothing this automation can run on. Pick another app from the list.`}
    />
)

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
}) => (
    <EventPickerEmptyFrame
        icon={<MagnifyingGlass aria-hidden size={19} className="text-muted-foreground" />}
        title={hasMore ? `Nothing yet for “${query}”` : `No ${appLabel} events match “${query}”`}
        body={
            hasMore
                ? `More of ${appLabel}'s catalog has not loaded. Look further, or clear the search.`
                : "The search covers this app only. Clear it to see everything it publishes, or pick another app."
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
                        {loadingMore ? "Looking…" : "Look further"}
                    </Button>
                ) : null}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs font-normal"
                    onClick={onClear}
                >
                    Clear search
                </Button>
            </span>
        }
    />
)

/** Nothing is connected yet, so there is no catalog to search in the first place. */
export const EventPickerNoApps = ({onConnect}: {onConnect: () => void}) => (
    <EventPickerEmptyFrame
        icon={<Plug aria-hidden size={19} className="text-muted-foreground" />}
        title="No apps connected"
        body="Connect an app and this automation can run whenever something happens in it."
        action={
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 text-xs font-normal"
                onClick={onConnect}
            >
                Connect an app
            </Button>
        }
    />
)
