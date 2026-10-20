import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ChatsCircle, NotePencil, X} from "@phosphor-icons/react"

import {EmbedAvatar} from "./EmbedAvatar"
import type {EmbedAppearance} from "./embedConfig"

/** The agent's name and avatar, with the conversation list and "New chat". */
export const EmbedHeader = ({
    appearance,
    listOpen,
    canStartNew,
    hasHistory,
    onToggleList,
    onNewChat,
}: {
    appearance: EmbedAppearance
    listOpen: boolean
    canStartNew: boolean
    hasHistory: boolean
    onToggleList: () => void
    onNewChat: () => void
}) => (
    <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <EmbedAvatar appearance={appearance} />
        <h1 className="m-0 min-w-0 grow truncate text-sm font-medium text-foreground">
            {appearance.name}
        </h1>
        {hasHistory ? (
            <SimpleTooltip title="Conversations">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={listOpen ? "Close conversations" : "Conversations"}
                    aria-expanded={listOpen}
                    onClick={onToggleList}
                >
                    {listOpen ? <X /> : <ChatsCircle />}
                </Button>
            </SimpleTooltip>
        ) : null}
        <SimpleTooltip title="New chat">
            {/* A disabled button gets no pointer events, so the span carries the hover. */}
            <span className="inline-flex">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="New chat"
                    disabled={!canStartNew}
                    onClick={onNewChat}
                >
                    <NotePencil />
                </Button>
            </span>
        </SimpleTooltip>
    </header>
)
