import {Button} from "@agenta/ui/ui"
import {ChartBar, Plus} from "@phosphor-icons/react"

const GHOST = Array.from(
    {length: 30},
    (_, i) =>
        18 + 50 * (0.5 + 0.5 * Math.sin(i * 0.55 + 0.4)) * (0.7 + 0.3 * Math.sin(i * 1.7 + 0.8)),
)

const GhostCard = ({height}: {height: number}) => (
    <div className="flex flex-col gap-3 rounded-xl bg-muted p-5" aria-hidden>
        <span className="h-3 w-16 rounded bg-accent" />
        <span className="h-6 w-28 rounded bg-accent" />
        <div className="flex items-end gap-1" style={{height}}>
            {GHOST.map((h, i) => (
                <span key={i} className="flex-1 rounded-sm bg-accent" style={{height: `${h}%`}} />
            ))}
        </div>
    </div>
)

/** A project with no agents yet: placeholder charts behind one call to action. */
export const UsageEmptyState = ({onCreateAgent}: {onCreateAgent?: () => void}) => (
    <div className="relative">
        <div className="flex flex-col gap-4 opacity-70">
            <GhostCard height={210} />
            <GhostCard height={150} />
        </div>
        <div className="absolute inset-0 flex items-start justify-center pt-20">
            <div className="flex w-[400px] max-w-[calc(100%-32px)] flex-col items-center gap-3 rounded-2xl border border-solid border-border bg-background px-8 py-7 text-center shadow-lg">
                <span className="grid size-11 place-items-center rounded-xl bg-muted">
                    <ChartBar size={20} />
                </span>
                <span className="text-lg font-semibold">Your usage will show up here</span>
                <p className="m-0 text-sm text-muted-foreground">
                    Once your agents start running, you’ll see what they cost, how often they run,
                    and how reliably they finish.
                </p>
                {onCreateAgent ? (
                    <Button onClick={onCreateAgent}>
                        <Plus data-icon="inline-start" />
                        Create an agent
                    </Button>
                ) : null}
                <span className="text-xs text-muted-foreground">
                    New runs appear here within about a minute.
                </span>
            </div>
        </div>
    </div>
)
