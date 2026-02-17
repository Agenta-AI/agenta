/**
 * PreviewPanel - Right panel for previewing the refined prompt
 *
 * Shows:
 * - Editable message list (same as original prompt format)
 * - Or diff view when diff toggle is on (controlled by parent)
 *
 * The `promptVersion` prop is used as part of editor keys to force
 * remount when a new AI refinement result arrives (SharedEditor uses
 * initialValue and does not update reactively).
 */

import {useCallback, useMemo} from "react"

import {Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import DiffView from "@/oss/components/Editor/DiffView"
import MessageEditor from "@/oss/components/Playground/Components/ChatCommon/MessageEditor"

import {
    originalPromptSnapshotAtomFamily,
    refineDiffViewAtomFamily,
    workingPromptAtomFamily,
} from "../store/refinePromptStore"

interface PreviewPanelProps {
    variantId: string
    promptId: string
    promptVersion: number
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({promptId, promptVersion}) => {
    const showDiff = useAtomValue(refineDiffViewAtomFamily(promptId))
    const [workingPrompt, setWorkingPrompt] = useAtom(workingPromptAtomFamily(promptId))
    const originalPrompt = useAtomValue(originalPromptSnapshotAtomFamily(promptId))

    const handleMessageChange = useCallback(
        (index: number, field: "role" | "content", value: string) => {
            setWorkingPrompt((prev) => {
                if (!prev) return prev

                const newMessages = [...prev.messages]
                newMessages[index] = {
                    ...newMessages[index],
                    [field]: value,
                }

                return {
                    ...prev,
                    messages: newMessages,
                }
            })
        },
        [setWorkingPrompt],
    )

    // Only diff messages — template_format and other fields are not refined
    const originalJson = useMemo(() => {
        if (!originalPrompt) return "[]"
        return JSON.stringify(originalPrompt.messages, null, 2)
    }, [originalPrompt])

    const workingJson = useMemo(() => {
        if (!workingPrompt) return "[]"
        return JSON.stringify(workingPrompt.messages, null, 2)
    }, [workingPrompt])

    if (!workingPrompt) {
        return (
            <div className="flex h-full items-center justify-center">
                <Typography.Text type="secondary" className="text-[11px]">
                    No refined prompt yet
                </Typography.Text>
            </div>
        )
    }

    return (
        <div className="p-4">
            {showDiff ? (
                <DiffView
                    language="json"
                    original={originalJson}
                    modified={workingJson}
                    className=""
                    enableFolding
                    foldThreshold={3}
                />
            ) : (
                <div className="flex flex-col gap-3">
                    {workingPrompt.messages.map((message, index) => (
                        <MessageEditor
                            key={`v${promptVersion}-${index}`}
                            id={`refine-preview-${promptId}-v${promptVersion}-${index}`}
                            role={message.role}
                            text={
                                typeof message.content === "string"
                                    ? message.content
                                    : JSON.stringify(message.content, null, 2)
                            }
                            onChangeRole={(v) => handleMessageChange(index, "role", v)}
                            onChangeText={(v) => handleMessageChange(index, "content", v)}
                            placeholder="Enter message content…"
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

export default PreviewPanel
