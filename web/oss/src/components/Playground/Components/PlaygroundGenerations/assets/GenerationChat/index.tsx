import {Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {atom} from "jotai"

import {inputRowIdsStrictAtom, isComparisonViewAtom} from "@/oss/components/Playground/state/atoms"
import {generationRowIdsCompatAtom} from "@/oss/state/generation/compat"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"

import PromptMessageConfig from "../../../PromptMessageConfig"
import GenerationChatTurnNormalized from "../GenerationChatTurnNormalized"
import GenerationCompletionRow from "../GenerationCompletionRow"

import type {GenerationChatProps} from "./types"

const GenerationChat = ({variantId, viewAs}: GenerationChatProps) => {
    const isComparisonView = useAtomValue(isComparisonViewAtom)
    const inputRowIds = useAtomValue(inputRowIdsStrictAtom)
    // Normalized: row ids are turns in chat mode
    const turnIds = useAtomValue(generationRowIdsCompatAtom)

    // Config messages (read-only, single view only)
    const prompts = useAtomValue(variantId ? promptsAtomFamily(variantId) : atom([])) as any[]
    const configMessages = (prompts || []).flatMap((p: any) => p?.messages?.value || [])

    return (
        <section className="flex flex-col">
            {/**
             * Variables
             * only displayed in single view state
             * meaning when there's
             */}
            {!!variantId &&
                inputRowIds.map((inputRowId) => {
                    console.log("inputRowId", inputRowId, inputRowIds)
                    return (
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
                    )
                })}

            {/* Chat turns */}
            <div
                className={clsx([
                    "flex flex-col gap-4 p-4 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    {"!border-none !p-0 !gap-0": isComparisonView},
                ])}
            >
                <div className="flex flex-col gap-1">
                    {!isComparisonView && <Typography>Chat</Typography>}
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
                                        disabled
                                        state="readOnly"
                                        isMessageDeletable={false}
                                        editorClassName="w-full"
                                    />
                                )
                            })}
                        {turnIds.map((turnId, index) => (
                            <GenerationChatTurnNormalized
                                key={turnId}
                                turnId={turnId}
                                variantId={variantId as string}
                                withControls={index === turnIds.length - 1}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </section>
    )
}

export default GenerationChat
