import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {Segmented} from "@agenta/ui/ui"
import {useAtom} from "jotai"

/**
 * Build / Chat, the playground's mode switch.
 *
 * "chat" maximizes the chat pane (config hidden, session rail shown); "build" is the two-panel
 * edit view. `chatPanelMaximizedAtom` is the single source of truth — the layout, the config pane
 * and the chat panel all read it, so this control only has to write it.
 */
export const PlaygroundModeSwitch = ({className}: {className?: string}) => {
    const [chatMaximized, setChatMaximized] = useAtom(chatPanelMaximizedAtom)

    return (
        <Segmented
            aria-label="Playground mode"
            className={className}
            value={chatMaximized ? "chat" : "build"}
            onChange={(value) => setChatMaximized(value === "chat")}
            options={[
                {label: "Build", value: "build"},
                {label: "Chat", value: "chat"},
            ]}
        />
    )
}
