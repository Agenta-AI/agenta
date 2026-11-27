/** Loading shapes of the agent's sections (STATE-02): the pane's cards and the phone's rows. */
import {SkeletonBlock} from "../../ui/skeleton"

// The pane's cards in order; `add` marks a "+" in the header, `preview` the Instructions text.
const CARDS: {title: number; value?: number; add?: boolean; preview?: boolean}[] = [
    {title: 44, value: 84}, // Model
    {title: 84, value: 64, preview: true}, // Instructions
    {title: 88, value: 72, add: true}, // Integrations
    {title: 76, value: 72, add: true}, // Subagents
    {title: 88, value: 60, add: true}, // MCP servers
    {title: 40, value: 52, add: true}, // Skills
    {title: 68}, // Advanced
]

/** The pane: one muted card per section, a 40 px header with a white 28 px Mark. */
export const AgentSectionCardsSkeleton = () => (
    <div aria-hidden className="flex flex-col gap-2 pt-3">
        {CARDS.map((card, i) => (
            <div key={i} className="-mx-2.5 flex flex-col rounded-lg bg-muted">
                <div className="flex h-10 items-center gap-2 px-2.5">
                    <span className="size-7 shrink-0 rounded-md bg-background" />
                    <SkeletonBlock style={{width: card.title, height: 14}} />
                    <div className="ml-auto flex items-center gap-2">
                        {card.value ? (
                            <SkeletonBlock style={{width: card.value, height: 12}} />
                        ) : null}
                        {card.add ? <SkeletonBlock className="size-3.5" /> : null}
                        <SkeletonBlock className="size-3.5" />
                    </div>
                </div>
                {card.preview ? (
                    <div className="-mt-0.5 flex flex-col gap-1.5 pb-2.5 pl-11.5 pr-2.5">
                        <SkeletonBlock className="h-3 w-full" />
                        <SkeletonBlock className="h-3 w-full" />
                        <SkeletonBlock className="h-3 w-2/3" />
                    </div>
                ) : null}
            </div>
        ))}
    </div>
)

// The phone's rows in their order: title and summary widths.
const ROWS: [number, number][] = [
    [44, 72], // Model
    [84, 120], // Instructions
    [88, 200], // Integrations
    [76, 72], // Subagents
    [88, 64], // MCP servers
    [40, 200], // Skills
    [60, 36], // Secrets
    [84, 56], // Permissions
    [68, 96], // Advanced
]

/** The phone: a two-line row per section, its 32 px Mark on the 16 px line, 8 px apart. */
export const AgentSectionRowsSkeleton = () => (
    <div aria-hidden className="flex flex-col gap-2">
        {ROWS.map(([title, value], i) => (
            <div key={i} className="-mx-2 flex min-h-row-double items-center gap-3 px-2">
                <SkeletonBlock shape="mark" className="size-8 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-5 items-center">
                        <SkeletonBlock style={{width: title, height: 14}} />
                    </div>
                    <div className="flex h-4 items-center">
                        <SkeletonBlock style={{width: value, height: 12}} />
                    </div>
                </div>
                <SkeletonBlock className="size-3.5 shrink-0" />
            </div>
        ))}
    </div>
)
