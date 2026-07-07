import {useMemo, useRef} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {executionController} from "@agenta/playground"
import {useAtomValue} from "jotai"

import {usePlaygroundUIOptional} from "../../context/PlaygroundUIContext"
import type {ExecutionHeaderProps} from "../ExecutionHeader"
import ExecutionHeader from "../ExecutionHeader"

import type {ChatModeProps} from "./assets/ChatMode"
import ChatMode from "./assets/ChatMode"
import type {CompletionModeProps} from "./assets/CompletionMode"
import CompletionMode from "./assets/CompletionMode"

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
    // Per-entity agent detection — NOT app-scoped, so a mixed comparison grid
    // routes each entity by its own type (an app-scoped flag would misroute).
    const isAgent = useAtomValue(
        useMemo(() => executionController.selectors.isAgentMode(entityId), [entityId]),
    )
    const runnableQuery = useAtomValue(
        useMemo(() => workflowMolecule.selectors.query(entityId), [entityId]),
    )
    // Agent surface is injected from OSS (package can't import the app layer).
    const AgentGenerationPanel = usePlaygroundUIOptional()?.AgentGenerationPanel
    const isExecutionLoading = runnableQuery.isPending || isChat === undefined

    // Latch the agent surface so a revision switch never unmounts the live chat conversation.
    // A switch (self-commit or the config-header picker) points `entityId` at a new revision whose
    // flags load a beat later — `isAgent` flips false and the query goes pending, which would drop
    // this panel to the skeleton and tear down the agent chat (aborting the live stream, losing the
    // in-progress turn). Once an agent, we keep rendering the agent panel across that load gap so
    // the switch is just an `entityId` prop update; we only release the latch when the entity has
    // loaded as a definitively non-agent workflow. (Paired with the stable key in MainLayout, which
    // keeps THIS component mounted so the latch survives the switch.)
    const agentSurfaceRef = useRef(false)
    if (isAgent) {
        agentSurfaceRef.current = true
    } else if (!runnableQuery.isPending) {
        agentSurfaceRef.current = false
    }
    if (agentSurfaceRef.current && AgentGenerationPanel) {
        // No ExecutionHeader: it self-nulls for agents (`if (isAgent) return null`), but during the
        // switch load gap `isAgent` is momentarily false, so rendering it would flash the non-agent
        // header + register the run-all shortcut over the agent chat. Agents own their composer.
        return (
            <div className="flex h-full min-h-0 w-full flex-col">
                <div className="min-h-0 flex-1">
                    <AgentGenerationPanel entityId={entityId} />
                </div>
            </div>
        )
    }

    if (isExecutionLoading) {
        return (
            <div className="w-full">
                <div className="h-[48px] border-0 border-b border-solid border-colorBorderSecondary px-4 py-2 bg-[var(--ag-c-FFFFFF)]">
                    <div className="h-6 w-[220px] rounded bg-[var(--ag-rgba-051729-06)] animate-pulse" />
                </div>
                <div className="p-4 flex flex-col gap-3">
                    <div className="h-16 rounded border border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-rgba-051729-02)] animate-pulse" />
                    <div className="h-24 rounded border border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-rgba-051729-02)] animate-pulse" />
                </div>
            </div>
        )
    }

    return (
        // Agent arm fills the column (composer pinned to the bottom) — chat and
        // completion keep their content-height, top-aligned scroll behavior.
        <div className={isAgent ? "flex h-full min-h-0 w-full flex-col" : "w-full"}>
            <ExecutionHeader
                entityId={entityId}
                renderTestsetActions={renderTestsetActions}
                onRepeatCountChange={onRepeatCountChange}
            />
            {isAgent ? (
                // Third arm: agent entities render the injected agent-chat surface,
                // which fills the remaining height. No-op when the slot isn't
                // provided (e.g. EE without the panel).
                AgentGenerationPanel ? (
                    <div className="min-h-0 flex-1">
                        <AgentGenerationPanel entityId={entityId} />
                    </div>
                ) : null
            ) : isChat ? (
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
export {default as ChatTurnView} from "./assets/ChatTurnView"
export {default as CompletionMode} from "./assets/CompletionMode"
export type {CompletionModeProps} from "./assets/CompletionMode"
export {default as ExecutionRow} from "./assets/ExecutionRow"
export type {ExecutionRowProps} from "./assets/ExecutionRow"
export {default as GatewayToolAssistantActions} from "./GatewayToolAssistantActions"
export {default as GatewayToolExecuteButton} from "./GatewayToolExecuteButton"
