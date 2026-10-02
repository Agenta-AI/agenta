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

/** Bumped on every open request; the modal nav drawer closes on it, or it would block Crisp. */
export const liveChatRequestAtom = atom(0)
/** Crisp's window is open; the sidebar icon shows its pressed state from it. */
export const liveChatOpenAtom = atom(false)
/** Operator messages the visitor has not read yet. */
export const liveChatUnreadAtom = atom(0)

// Under the kit's overlays (sheet z-40, dialogs z-50), above page content.
const CRISP_Z_INDEX = 30

let crisp: Promise<typeof import("crisp-sdk-web").Crisp> | null = null
// Crisp's `is` (behind isChatOpened) exists only once its client runs.
let ready = false

/** Imported on demand so the SDK stays out of the main bundle. */
export const loadLiveChat = () => {
    crisp ??= import("crisp-sdk-web")
        .catch((error) => {
            // A failed import must not stay cached, or the chat cannot load again until reload.
            crisp = null
            throw error
        })
        .then(({Crisp, ChatboxColors, ChatboxPosition}) => {
            const store = getDefaultStore()
            // Crisp drops handlers queued before its client runs, so bind them once it is ready.
            window.CRISP_READY_TRIGGER = () => {
                ready = true
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
                // Crisp's bubble is hidden, so its window closes like a popover.
                const close = () => Crisp.chat.isChatOpened() && Crisp.chat.close()
                document.addEventListener(
                    "pointerdown",
                    (event) => {
                        const target = event.target as Element | null
                        if (target?.closest("#crisp-chatbox, [data-live-chat-trigger]")) return
                        close()
                    },
                    true,
                )
                document.addEventListener("keydown", (event) => event.key === "Escape" && close())
            }
            Crisp.configure(websiteId())
            // The dashboard can hide the chatbox on phones; this app is the phone surface.
            Crisp.setHideOnMobile(false)
            // Right keeps the phone full view's header close; globals.css moves the lg+ window to the rail.
            Crisp.setPosition(ChatboxPosition.Right)
            Crisp.setZIndex(CRISP_Z_INDEX)
            // Crisp only takes presets: Black matches the light primary; Grey stays legible on dark.
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

export const openLiveChat = () => {
    if (!isLiveChatEnabled()) return
    getDefaultStore().set(liveChatRequestAtom, (count) => count + 1)
    void loadLiveChat()
        .then((Crisp) => {
            Crisp.chat.show()
            Crisp.chat.open()
        })
        .catch(() => undefined)
}

/** The sidebar icon is the only launcher, so it closes the window too. */
export const toggleLiveChat = () => {
    void loadLiveChat()
        .then((Crisp) => (ready && Crisp.chat.isChatOpened() ? Crisp.chat.close() : openLiveChat()))
        .catch(() => undefined)
}
