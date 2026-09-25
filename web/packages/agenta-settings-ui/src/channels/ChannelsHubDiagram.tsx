import {AgentMark} from "./AgentMark"

export interface ChannelsHubDiagramTarget {
    key: string
    name: string
    icon: React.ReactNode
    live: boolean
}

const W = 200
/** One target row, and the gap between rows; the lines end on the rows' centres. */
const ROW = 20
const GAP = 4

/** The hub's header picture: this agent on the left, one line to each place it can answer. */
export const ChannelsHubDiagram = ({
    agentId,
    targets,
}: {
    /** Draws this agent's own icon; without one, a robot. */
    agentId?: string
    targets: ChannelsHubDiagramTarget[]
}) => {
    const H = Math.max(ROW, targets.length * ROW + (targets.length - 1) * GAP)
    const ys = targets.map((_, i) => ROW / 2 + i * (ROW + GAP))
    return (
        <div
            className="-mx-4 -mt-4 flex items-center justify-center border-0 border-b border-solid border-border bg-muted bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] bg-[size:14px_14px] px-5 py-3.5"
            data-testid="channels-hub-diagram"
        >
            <div className="relative flex w-[76px] flex-none justify-center">
                <AgentMark agentId={agentId} size={30} className="shadow-sm" />
                <span className="absolute inset-x-0 top-[35px] whitespace-nowrap text-center text-[10.5px] font-medium text-muted-foreground">
                    This agent
                </span>
            </div>
            <svg
                width={W}
                height={H}
                viewBox={`0 0 ${W} ${H}`}
                className="block flex-none overflow-visible text-foreground"
                aria-hidden="true"
            >
                <defs>
                    {/* A darker arrowhead for live lines, a lighter one for the rest. */}
                    {[
                        {id: "channels-hub-arrow", opacity: 0.6},
                        {id: "channels-hub-arrow-idle", opacity: 0.4},
                    ].map((arrow) => (
                        <marker
                            key={arrow.id}
                            id={arrow.id}
                            viewBox="0 0 8 8"
                            refX={6}
                            refY={4}
                            markerWidth={7}
                            markerHeight={7}
                            orient="auto-start-reverse"
                        >
                            <path
                                d="M1 1 L6 4 L1 7"
                                fill="none"
                                stroke="currentColor"
                                strokeOpacity={arrow.opacity}
                                strokeWidth={1.4}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </marker>
                    ))}
                </defs>
                {targets.map((target, i) => (
                    <path
                        key={target.key}
                        d={`M6 ${H / 2} C${W * 0.55} ${H / 2} ${W * 0.45} ${ys[i]} ${W - 6} ${ys[i]}`}
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity={target.live ? 0.45 : 0.3}
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        markerStart={`url(#channels-hub-arrow${target.live ? "" : "-idle"})`}
                        markerEnd={`url(#channels-hub-arrow${target.live ? "" : "-idle"})`}
                    />
                ))}
            </svg>
            <div className="flex w-24 flex-none flex-col gap-1">
                {targets.map((target) => (
                    <div key={target.key} className="flex h-5 items-center gap-2">
                        <span className="flex size-5 items-center justify-center rounded-[5px] bg-background shadow-sm">
                            {target.icon}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground">
                            {target.name}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
