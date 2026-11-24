import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

import {READY_REQUESTS} from "./quickActions"

/** The ready requests of a new chat about one agent; a pick fills the composer and sends nothing. */
export const QuickActions = ({
    agentName,
    onPick,
}: {
    agentName: string
    onPick: (text: string) => void
    phone?: boolean
}) => {
    const t = useT(builderPanelCatalog)
    // Two-line rows (`row-double`, 48 px), 8 px apart (ROW-04), with the hover fill and no box
    // around them (SURF-01/02). The same size on every window (SIZE-02).
    return (
        <div className="flex flex-col gap-2" data-testid="builder-ready-requests">
            {READY_REQUESTS.map((entry) => (
                <button
                    key={entry.title}
                    type="button"
                    onClick={() => onPick(t(entry.request, {agent: agentName}))}
                    className="focus-ring flex min-h-row-double w-full cursor-pointer flex-col justify-center rounded-md border-0 bg-transparent px-3 py-1.5 text-left hover:bg-accent"
                >
                    <span className="text-label text-foreground">{t(entry.title)}</span>
                    <span className="w-full truncate text-meta text-muted-foreground">{t(entry.line)}</span>
                </button>
            ))}
        </div>
    )
}
