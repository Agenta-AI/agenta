import type {MutableRefObject} from "react"

import {ChatComposer} from "@agenta/chat/components"
import type {useComposerAttachments} from "@agenta/chat/hooks"
import {useT} from "@agenta/i18n"
import agentsFirstRun from "@agenta/i18n/catalogs/agents.firstRun"
import type {RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {Button} from "@agenta/ui/ui"
import {ArrowRight} from "lucide-react"

/**
 * The create surface's composer: describe an agent, send, and it exists.
 *
 * `HomeTaskComposer` cannot serve this — it runs a task with an agent that ALREADY exists, and
 * with none to pick it disables itself. So this binds the same underlying `ChatComposer` to the
 * create path instead: the first submit runs the shared mint+commit core, stashes what was typed
 * as the session's pending task, and lands in the chat that sends it. From there the connect-model
 * gate takes over — on a keyless project the message parks and the strip asks for a key.
 */
export const FirstRunComposer = ({
    inputRef,
    attachments,
    creating,
    onCreate,
}: {
    /** Owned by the screen, so it can refill the editor after a failed create. */
    inputRef: MutableRefObject<RichChatInputHandle | null>
    /** Owned by the screen: staged files ride into the create alongside the text. */
    attachments: ReturnType<typeof useComposerAttachments>
    creating: boolean
    onCreate: (text: string) => Promise<void>
}) => {
    const t = useT(agentsFirstRun)
    const start = async (text: string) => {
        if (!text.trim()) return
        await onCreate(text)
    }

    return (
        // One box: `ChatComposer` renders two siblings (a usually-empty rejections dock plus the
        // input), and the screen's gap-* column was paying a full gap around the invisible one.
        <div className="flex flex-col">
            <ChatComposer
                inputRef={inputRef}
                onSubmit={start}
                attachments={attachments}
                placeholder={t("agents.firstRun.placeholder")}
                disabled={creating}
                composerDisabled={creating}
                // The desktop names the action instead of showing a bare send arrow: this composer
                // CREATES an agent, it does not send a message to one that exists.
                hideSendButton
                trailing={
                    <Button
                        size="sm"
                        disabled={creating}
                        onClick={() => void start(inputRef.current?.getMarkdown() ?? "")}
                    >
                        {creating ? t("agents.firstRun.creating") : t("agents.firstRun.create")}
                        <ArrowRight size={14} />
                    </Button>
                }
            />
        </div>
    )
}
