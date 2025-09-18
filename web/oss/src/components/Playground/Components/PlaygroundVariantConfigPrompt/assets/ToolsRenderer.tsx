import React, {useMemo} from "react"

import deepEqual from "fast-deep-equal"

import {getPromptById, getArrayVal} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"

interface Props {
    variantId: string
    compoundKey: string
    viewOnly?: boolean
}

const ToolsRenderer: React.FC<Props> = ({variantId, compoundKey, viewOnly}) => {
    const [, promptId] = compoundKey.split(":", 2)

    const prompts = usePromptsSource(variantId)
    const toolIds = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        const llm = (item?.llmConfig ?? item?.llm_config) as any
        const tools = getArrayVal(llm?.tools)
        return tools.map((t: any) => t?.__id).filter(Boolean)
    }, [prompts, promptId])

    return (
        <>
            {(toolIds || [])?.map((toolId) => (
                <div key={`${variantId}:${toolId}`}>
                    <PlaygroundVariantPropertyControl
                        key={`${variantId}:${toolId}`}
                        variantId={variantId}
                        propertyId={toolId}
                        debug
                        disabled={viewOnly}
                    />
                </div>
            ))}
        </>
    )
}

export default ToolsRenderer
