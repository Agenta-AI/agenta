import {useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {executionController} from "@agenta/playground"
import {useAtomValue} from "jotai"

import ExecutionHeader from "../ExecutionHeader"
import type {ExecutionHeaderProps} from "../ExecutionHeader"

import ChatMode from "./assets/ChatMode"
import type {ChatModeProps} from "./assets/ChatMode"
import CompletionMode from "./assets/CompletionMode"
import type {CompletionModeProps} from "./assets/CompletionMode"

export interface PlaygroundGenerationsProps {
    entityId: string
    /** Render slot for testset menu in header */
    renderTestsetActions?: ExecutionHeaderProps["renderTestsetActions"]
    /** Render slot for testset drawer button in SingleLayout */
    renderTestsetButton?: CompletionModeProps["renderTestsetButton"]
    /** Render slot for last-turn footer controls in chat */
    renderLastTurnFooter?: ChatModeProps["renderLastTurnFooter"]
    /** Render slot for controls bar in chat turns */
    renderControlsBar?: ChatModeProps["renderControlsBar"]
    /** Optional analytics callback */
    onRepeatCountChange?: ExecutionHeaderProps["onRepeatCountChange"]
    /** App type for variable control adapter */
    appType?: string
}

const PlaygroundGenerations: React.FC<PlaygroundGenerationsProps> = ({
    entityId,
    renderTestsetActions,
    renderTestsetButton,
    renderLastTurnFooter,
    renderControlsBar,
    onRepeatCountChange,
    appType,
}) => {
    // Use app-level chat mode detection (first revision) for rendering mode
    const isChat = useAtomValue(useMemo(() => executionController.selectors.isChatMode, []))
    const runnableQuery = useAtomValue(useMemo(() => runnableBridge.query(entityId), [entityId]))
    const isExecutionLoading = runnableQuery.isPending || isChat === undefined

    if (isExecutionLoading) {
        return (
            <div className="w-full">
                <div className="h-[48px] border-0 border-b border-solid border-colorBorderSecondary px-4 py-2 bg-white">
                    <div className="h-6 w-[220px] rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                </div>
                <div className="p-4 flex flex-col gap-3">
                    <div className="h-16 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                    <div className="h-24 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                </div>
            </div>
        )
    }

    return (
        <div className="w-full">
            <ExecutionHeader
                entityId={entityId}
                renderTestsetActions={renderTestsetActions}
                onRepeatCountChange={onRepeatCountChange}
            />
            {isChat ? (
                <ChatMode
                    entityId={entityId}
                    renderLastTurnFooter={renderLastTurnFooter}
                    renderControlsBar={renderControlsBar}
                />
            ) : (
                <CompletionMode
                    entityId={entityId}
                    withControls
                    appType={appType}
                    renderTestsetButton={renderTestsetButton}
                />
            )}
        </div>
    )
}

export default PlaygroundGenerations

// Re-export sub-components (canonical names only)
export {default as ChatMode} from "./assets/ChatMode"
export type {ChatModeProps} from "./assets/ChatMode"
export {default as CompletionMode} from "./assets/CompletionMode"
export type {CompletionModeProps} from "./assets/CompletionMode"
export {default as ExecutionRow} from "./assets/ExecutionRow"
export type {ExecutionRowProps} from "./assets/ExecutionRow"
export {default as ChatTurnView} from "./assets/ChatTurnView"
