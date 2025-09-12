import React, {useMemo} from "react"

import {useSetAtom} from "jotai"

import {getPromptById, getLLMConfig} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"
import {
    addPromptMessageMutationAtomFamily,
    addPromptToolMutationAtomFamily,
} from "@/oss/components/Playground/state/atoms"

import AddButton from "../../../assets/AddButton"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"

interface Props {
    variantId: string
    compoundKey: string
    viewOnly?: boolean
}

const ActionsOutputRenderer: React.FC<Props> = ({variantId, compoundKey, viewOnly}) => {
    const addNewMessage = useSetAtom(addPromptMessageMutationAtomFamily(compoundKey))
    const addNewTool = useSetAtom(addPromptToolMutationAtomFamily(compoundKey))
    const [, promptId] = compoundKey.split(":", 2)
    const prompts = usePromptsSource(variantId)

    const responseFormatInfo = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const llm = getLLMConfig(item)
        const enhancedId = llm?.responseFormat?.__id || llm?.response_format?.__id
        const raw = llm?.response_format || llm?.responseFormat
        return {enhancedId, raw}
    }, [prompts, promptId])
    const responseFormatId = responseFormatInfo.enhancedId as string | undefined
    return (
        <div className="flex items-center gap-1 flex-wrap w-full">
            {!viewOnly && (
                <>
                    <AddButton
                        className="mt-2"
                        size="small"
                        label="Message"
                        onClick={addNewMessage}
                    />
                    <AddButton className="mt-2" size="small" label="Tool" onClick={addNewTool} />
                </>
            )}
            <div>
                {responseFormatId ? (
                    <PlaygroundVariantPropertyControl
                        variantId={variantId}
                        propertyId={responseFormatId}
                        viewOnly={viewOnly}
                        disabled={viewOnly}
                    />
                ) : (
                    // Fallback for immutable/raw params (no property id)
                    <span className="text-[#7E8B99] text-[12px] leading-[20px] block">
                        {(() => {
                            const t = (responseFormatInfo.raw || {})?.type
                            if (!t || t === "text") return "Default (text)"
                            if (t === "json_object") return "JSON mode"
                            if (t === "json_schema") return "JSON schema"
                            return String(t)
                        })()}
                    </span>
                )}
            </div>
        </div>
    )
}

export default ActionsOutputRenderer
