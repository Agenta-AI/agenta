import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown, Code} from "@phosphor-icons/react"

import {platformLogo} from "../channels/icons"

export type PublishTarget = "slack" | "telegram" | "api"

export interface PublishMenuItem {
    key: PublishTarget
    /** True when this target is connected and answering as the agent. */
    live: boolean
    /** True while the host cannot tell yet which drawer to open, e.g. connections loading. */
    disabled?: boolean
}

export interface PublishMenuProps {
    /** The targets to offer, in order. The host drops Slack and Telegram when Channels is off. */
    items: PublishMenuItem[]
    onSelect: (target: PublishTarget) => void
    disabled?: boolean
    className?: string
}

const LABELS: Record<PublishTarget, string> = {
    slack: "Slack",
    telegram: "Telegram",
    api: "API",
}

const targetIcon = (target: PublishTarget) =>
    target === "api" ? <Code size={16} weight="bold" /> : platformLogo(target, 16)

/** "Live in N places", with the singular for one. */
export const liveSummary = (count: number): string =>
    `Live in ${count} ${count === 1 ? "place" : "places"}`

/**
 * The agent header's Publish button: one menu of the places an agent can be reached from,
 * each opening its own drawer. The host owns the drawers and what "live" means for each.
 */
export const PublishMenu = ({items, onSelect, disabled, className}: PublishMenuProps) => {
    const liveCount = items.filter((item) => item.live).length

    return (
        <div className={`flex shrink-0 items-center gap-2 ${className ?? ""}`}>
            {/* A phone header has no room for the sentence beside the agent name and revision, so
            below `sm` the count moves onto the button as a dot and a number. */}
            {liveCount > 0 ? (
                <span
                    className="hidden items-center gap-1.5 whitespace-nowrap text-xs text-colorTextSecondary sm:inline-flex"
                    data-testid="publish-live-summary"
                >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-colorSuccess" />
                    {liveSummary(liveCount)}
                </span>
            ) : null}
            <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={disabled}>
                    <Button
                        size="sm"
                        // The design's one yellow action per screen: the hero-action token.
                        className="bg-hero-action text-hero-action-foreground hover:bg-hero-action-hover"
                        data-testid="publish-button"
                        aria-label={
                            liveCount > 0
                                ? `Publish, ${liveSummary(liveCount).toLowerCase()}`
                                : undefined
                        }
                    >
                        {liveCount > 0 ? (
                            <span
                                aria-hidden
                                className="inline-flex items-center gap-1 text-xs tabular-nums sm:hidden"
                                data-testid="publish-live-count"
                            >
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-colorSuccess" />
                                {liveCount}
                            </span>
                        ) : null}
                        Publish
                        <CaretDown size={12} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                    {items.map((item) => (
                        <DropdownMenuItem
                            key={item.key}
                            disabled={item.disabled}
                            onSelect={() => onSelect(item.key)}
                            className="gap-2 py-1.5"
                            data-testid={`publish-item-${item.key}`}
                        >
                            <span className="flex h-4 w-4 items-center justify-center text-colorText">
                                {targetIcon(item.key)}
                            </span>
                            <span className="flex-1">{LABELS[item.key]}</span>
                            {item.live ? (
                                <span className="inline-flex items-center gap-1 text-xs text-colorSuccess">
                                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-colorSuccess" />
                                    Live
                                </span>
                            ) : (
                                <span className="text-xs text-colorTextTertiary">Set up</span>
                            )}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
