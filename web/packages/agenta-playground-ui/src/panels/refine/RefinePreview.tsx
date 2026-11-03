import {useMemo} from "react"

import {ChatMessageEditor} from "@agenta/ui/chat-message"
import dynamic from "next/dynamic"

import type {PromptTemplate} from "./refinePromptApi"

// The diff loads only when the user turns it on.
const DiffView = dynamic(() => import("@agenta/ui/editor").then((module) => module.DiffView), {
    ssr: false,
})

export interface RefinePreviewProps {
    promptKey: string
    original: PromptTemplate | null
    working: PromptTemplate | null
    /** Grows with each result, so the editors start again from the new text. */
    version: number
    showDiff: boolean
    /** A round is running: its result will replace the messages, so they cannot be edited. */
    busy: boolean
    onEditMessage: (index: number, field: "role" | "content", value: string) => void
}

/** The right side of the refine dialog: the refined messages to edit, or their diff. */
export const RefinePreview = ({
    promptKey,
    original,
    working,
    version,
    showDiff,
    busy,
    onEditMessage,
}: RefinePreviewProps) => {
    // Only the messages change, so only they are compared.
    const originalJson = useMemo(
        () => JSON.stringify(original?.messages ?? [], null, 2),
        [original],
    )
    const workingJson = useMemo(() => JSON.stringify(working?.messages ?? [], null, 2), [working])

    if (!working) {
        return (
            <div className="flex flex-1 items-center justify-center px-4">
                <p className="m-0 text-center text-xs text-muted-foreground">
                    Submit instructions to see the refined prompt
                </p>
            </div>
        )
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {showDiff ? (
                <DiffView
                    language="json"
                    original={originalJson}
                    modified={workingJson}
                    enableFolding
                    foldThreshold={3}
                />
            ) : (
                <div className="flex flex-col gap-3">
                    {working.messages.map((message, index) => (
                        <ChatMessageEditor
                            key={`v${version}-${index}`}
                            id={`refine-preview-${promptKey}-v${version}-${index}`}
                            role={message.role}
                            text={message.content}
                            disabled={busy}
                            onChangeRole={(value) => onEditMessage(index, "role", value)}
                            onChangeText={(value) => onEditMessage(index, "content", value)}
                            placeholder="Enter message content…"
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
