import {isEE} from "@agenta/shared/api"
import {atom, getDefaultStore} from "jotai"

import {getEnv} from "@/lib/env"

declare global {
    interface Window {
        CRISP_READY_TRIGGER?: () => void
    }
}

const websiteId = () => getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID")

/** Cloud only, like the desktop rail, and only where a Crisp website is configured. */
export const isLiveChatEnabled = (): boolean => isEE() && Boolean(websiteId())

export const liveChatOpenAtom = atom(false)
export const liveChatUnreadAtom = atom(0)

// Under the kit's overlays (sheet z-40, dialogs z-50), above page content.
const CRISP_Z_INDEX = 30

const store = getDefaultStore()
let crisp: Promise<typeof import("crisp-sdk-web").Crisp> | null = null

export const loadLiveChat = () => {
    crisp ??= import("crisp-sdk-web")
        .catch((error) => {
            crisp = null
            throw error
        })
        .then(({Crisp, ChatboxColors, ChatboxPosition}) => {
            // Crisp drops handlers queued before its client runs, so bind them once it is ready.
            window.CRISP_READY_TRIGGER = () => {
                const syncUnread = () =>
                    store.set(liveChatUnreadAtom, Crisp.chat.unreadCount() || 0)
                syncUnread()
                Crisp.message.onMessageReceived(syncUnread)
                Crisp.chat.onChatOpened(() => {
                    store.set(liveChatOpenAtom, true)
                    store.set(liveChatUnreadAtom, 0)
                })
                Crisp.chat.onChatClosed(() => {
                    store.set(liveChatOpenAtom, false)
                    syncUnread()
                })
                store.set(liveChatOpenAtom, Crisp.chat.isChatOpened())
            }

            // Crisp's bubble is hidden, so its window closes like a popover.
            const close = () => store.get(liveChatOpenAtom) && Crisp.chat.close()
            document.addEventListener(
                "pointerdown",
                (event) => {
                    const target = event.target as Element | null
                    if (!target?.closest("#crisp-chatbox, [data-live-chat-trigger]")) close()
                },
                true,
            )
            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && document.activeElement?.closest("#crisp-chatbox"))
                    close()
            })

            Crisp.configure(websiteId())
            // The dashboard can hide the chatbox on phones; this app is the phone surface.
            Crisp.setHideOnMobile(false)
            // Right keeps the phone full view's header X; globals.css moves the lg+ window.
            Crisp.setPosition(ChatboxPosition.Right)
            Crisp.setZIndex(CRISP_Z_INDEX)
            // Crisp only takes presets: Black matches the light primary, Grey reads on dark.
            let color: string | null = null
            const syncColor = () => {
                const next = document.documentElement.classList.contains("dark")
                    ? ChatboxColors.Grey
                    : ChatboxColors.Black
                if (next !== color) Crisp.setColorTheme((color = next))
            }
            syncColor()
            new MutationObserver(syncColor).observe(document.documentElement, {
                attributeFilter: ["class"],
            })
            return Crisp
        })
    return crisp
}

export const toggleLiveChat = () => {
    void loadLiveChat()
        .then((Crisp) => (store.get(liveChatOpenAtom) ? Crisp.chat.close() : Crisp.chat.open()))
        .catch(() => undefined)
}

/** Closes a loaded chat, for when the organization loses live chat mid-session. */
export const closeLiveChat = () => {
    void crisp?.then((Crisp) => Crisp.chat.close()).catch(() => undefined)
}
