/**
 * FilesWindowModal — the chat-mode Files WINDOW (build-spec E3): a centered window over the
 * conversation (no drawer, no route change) holding the Files surface — grid of recent-first
 * tiles / list (the Build two-pane explorer), search + sort, count·size footer. Opened from the
 * context rail ("View all files" / the ↗ icon); a tile (click or space on focus) opens Quick
 * Look ON TOP of it; esc closes top-most first.
 *
 * Same request-atom pattern as Quick Look: openers just set the atom; the host (mounted once
 * per conversation) knows the session.
 */
import {Modal} from "antd"
import {atom, useAtom, useAtomValue} from "jotai"

import FilesWindow from "./FilesWindow"
import {driveQuickLookAtom} from "./quickLook"

export const filesWindowOpenAtom = atom(false)

export function FilesWindowModal({sessionId}: {sessionId: string}) {
    const [open, setOpen] = useAtom(filesWindowOpenAtom)
    // Quick Look stacks on top; while it's open, esc must close IT, not this window too.
    const quickLookOpen = Boolean(useAtomValue(driveQuickLookAtom))

    return (
        <Modal
            open={open}
            onCancel={() => setOpen(false)}
            footer={null}
            width={760}
            centered
            destroyOnHidden
            keyboard={!quickLookOpen}
            styles={{body: {padding: 0}}}
        >
            <div className="flex h-[62vh] min-h-[320px] flex-col overflow-hidden pt-4">
                <FilesWindow sessionId={sessionId} />
            </div>
        </Modal>
    )
}
