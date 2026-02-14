import {Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import LastTurnFooterControls from "@/oss/components/Playground/Components/ChatCommon/LastTurnFooterControls"
import {
    isComparisonViewAtom,
    moleculeBackedPromptsAtomFamily,
} from "@/oss/components/Playground/state/atoms"
import {
    generationInputRowIdsAtom,
    generationRowIdsAtom,
} from "@/oss/components/Playground/state/atoms/generationProperties"
import {
    addChatTurnAtom,
    cancelChatTurnAtom,
    runChatTurnAtom,
} from "@/oss/state/newPlayground/chat/actions"

import PromptMessageConfig from "../../../PromptMessageConfig"
import GenerationChatTurnNormalized from "../GenerationChatTurnNormalized"
import GenerationCompletionRow from "../GenerationCompletionRow"

import type {GenerationChatProps} from "./types"

const GenerationChat = ({variantId, viewAs}: GenerationChatProps) => {
    const isComparisonView = useAtomValue(isComparisonViewAtom)
    // Completion-style variable inputs for chat use normalized input rows with a derived fallback
    const inputRowIds = useAtomValue(generationInputRowIdsAtom) as string[]
    const turnIds = useAtomValue(generationRowIdsAtom)

    // Config messages (read-only, single view only) - use molecule-backed prompts
    const prompts = useAtomValue(
        variantId ? moleculeBackedPromptsAtomFamily(variantId) : atom([]),
    ) as any[]
    const configMessages = (prompts || []).flatMap((p: any) => p?.messages?.value || [])

    return (
        <section className="flex flex-col">
            {/**
             * Variables
             * only displayed in single view state
             * meaning when there's
             */}
            {!!variantId &&
                inputRowIds.map((inputRowId) => (
                    <GenerationCompletionRow
                        key={inputRowId}
                        variantId={variantId}
                        rowId={inputRowId}
                        inputOnly={true}
                        className={clsx([
                            {
                                "bg-[#f5f7fa] border-0 border-r border-solid border-[rgba(5,23,41,0.06)]":
                                    isComparisonView,
                            },
                        ])}
                    />
                ))}

            {/* Chat turns */}
            <div
                className={clsx([
                    "flex flex-col gap-4 p-4 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    {"!border-none !p-0 !gap-0": isComparisonView},
                ])}
            >
                <div className="flex flex-col gap-1">
                    {!isComparisonView && (
                        <div className="shrink-0 top-[48px] sticky bg-colorBgContainer z-[10] w-full">
                            <Typography>Chat</Typography>
                        </div>
                    )}
                    <div className={clsx(["flex flex-col gap-2", {"!gap-0": isComparisonView}])}>
                        {!isComparisonView &&
                            (configMessages || []).map((m: any) => {
                                const contentStr = Array.isArray(m?.content?.value)
                                    ? m.content.value
                                          .map((p: any) => p?.text?.value || p?.text || "")
                                          .join(" ")
                                    : m?.content?.value || ""
                                return (
                                    <PromptMessageConfig
                                        key={`${m?.__id}:${contentStr}`}
                                        variantId={variantId as string}
                                        messageId={m?.__id}
                                        viewOnly
                                        state="readOnly"
                                        isMessageDeletable={false}
                                        editorClassName="w-full"
                                        defaultMinimized
                                        showMinimizeOnly
                                    />
                                )
                            })}
                        {turnIds.map((turnId) => (
                            <GenerationChatTurnNormalized
                                key={turnId}
                                turnId={turnId}
                                variantId={variantId as string}
                                withControls={false}
                            />
                        ))}
                        {turnIds.length > 0 ? (
                            <FooterControlsSingle
                                variantId={variantId as string}
                                lastLogicalId={turnIds[turnIds.length - 1]}
                            />
                        ) : null}
                    </div>
                </div>
            </div>
        </section>
    )
}

const FooterControlsSingle = ({
    variantId,
    lastLogicalId,
}: {
    variantId: string
    lastLogicalId: string
}) => {
    const addTurn = useSetAtom(addChatTurnAtom)
    const runTurn = useSetAtom(runChatTurnAtom)
    const cancelTurn = useSetAtom(cancelChatTurnAtom)
    return (
        <LastTurnFooterControls
            logicalId={lastLogicalId}
            onRun={() => runTurn({turnId: lastLogicalId, variantId})}
            onCancelAll={() => cancelTurn({turnId: lastLogicalId, variantId})}
            onAddMessage={() => addTurn()}
            className="p-3"
        />
    )
}

export default GenerationChat
