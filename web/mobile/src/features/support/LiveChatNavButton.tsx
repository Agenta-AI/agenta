import type {MouseEvent} from "react"

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {ChatCircleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {liveChatOpenAtom, liveChatUnreadAtom, toggleLiveChat} from "./crispChat"

/** Anchors Crisp's window beside the docked rail, bottom-aligned with this icon (globals.css). */
const anchorWindow = (event: MouseEvent<HTMLButtonElement>) => {
    const rail = event.currentTarget.closest("aside")?.getBoundingClientRect()
    const icon = event.currentTarget.getBoundingClientRect()
    const root = document.documentElement.style
    if (rail) root.setProperty("--ag-live-chat-left", `${Math.round(rail.right + 8)}px`)
    root.setProperty("--ag-live-chat-bottom", `${Math.round(window.innerHeight - icon.bottom)}px`)
}

/** The sidebar's live chat icon, beside Help and drawn like it (SidebarIconMenu's trigger). */
export const LiveChatNavButton = () => {
    const unread = useAtomValue(liveChatUnreadAtom)
    const open = useAtomValue(liveChatOpenAtom)

    return (
        <TooltipProvider delayDuration={600}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        data-live-chat-trigger
                        aria-label={unread ? `Live chat, ${unread} unread` : "Live chat"}
                        aria-pressed={open}
                        onClick={(event) => {
                            anchorWindow(event)
                            toggleLiveChat()
                        }}
                        className="text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText aria-pressed:bg-colorFillTertiary aria-pressed:text-colorText relative flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent [font-family:inherit]"
                    >
                        <ChatCircleIcon size={16} />
                        {unread ? (
                            <span className="bg-error ring-background absolute top-1 right-1 size-1.5 rounded-full ring-2" />
                        ) : null}
                    </button>
                </TooltipTrigger>
                <TooltipContent side="top">Live chat</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
