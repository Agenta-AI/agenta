import {useEffect, useRef, type RefObject} from "react"

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {ChatCircleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {liveChatOpenAtom, liveChatUnreadAtom, loadLiveChat, toggleLiveChat} from "./crispChat"

/** Publishes the vars globals.css uses to open Crisp beside the docked rail, level with this icon. */
const useAnchorWindow = (ref: RefObject<HTMLButtonElement | null>) => {
    useEffect(() => {
        const button = ref.current
        const rail = button?.closest("aside")
        if (!button || !rail) return
        const anchor = () => {
            const railBox = rail.getBoundingClientRect()
            // The docked rail is display:none below lg, and the drawer's copy never anchors.
            if (!railBox.width || rail.closest('[data-slot="sheet-content"]')) return
            const root = document.documentElement.style
            root.setProperty("--ag-live-chat-left", `${Math.round(railBox.right + 8)}px`)
            const bottom = window.innerHeight - button.getBoundingClientRect().bottom
            root.setProperty("--ag-live-chat-bottom", `${Math.round(bottom)}px`)
        }
        anchor()
        const observer = new ResizeObserver(anchor)
        observer.observe(rail)
        window.addEventListener("resize", anchor)
        return () => {
            observer.disconnect()
            window.removeEventListener("resize", anchor)
        }
    }, [ref])
}

/** The sidebar's live chat icon, beside Help and drawn like it (SidebarIconMenu's trigger). */
export const LiveChatNavButton = () => {
    const unread = useAtomValue(liveChatUnreadAtom)
    const open = useAtomValue(liveChatOpenAtom)
    const ref = useRef<HTMLButtonElement>(null)
    useAnchorWindow(ref)
    useEffect(() => {
        void loadLiveChat().catch(() => undefined)
    }, [])

    return (
        <TooltipProvider delayDuration={600}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        ref={ref}
                        type="button"
                        data-live-chat-trigger
                        aria-label={unread ? `Live chat, ${unread} unread` : "Live chat"}
                        aria-pressed={open}
                        onClick={toggleLiveChat}
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
