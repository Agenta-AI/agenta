import {useEffect, useMemo} from "react"

import {Alert} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {useAtomValue, useSetAtom} from "jotai"
import {selectAtom} from "jotai/utils"

import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {
    promptsAtomFamily,
    promptVariablesByPromptAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"

import type {PromptCollapseContentProps} from "../types"

import ActionsOutputRenderer from "./ActionsOutputRenderer"
import MessagesRenderer from "./MessagesRenderer"
import ToolsRenderer from "./ToolsRenderer"

/**
 * PlaygroundVariantConfigPromptCollapseContent renders the configuration interface
 * for a single prompt's messages.
 *
 * Features:
 * - Displays a list of configurable messages for the prompt
 * - Allows adding new messages
 * - Manages message configurations through the playground state
 *
 * @component
 */

const isCustomAtom = selectAtom(currentAppContextAtom, (ctx) => ctx.appType === "custom", deepEqual)
const PlaygroundVariantConfigPromptCollapseContent: React.FC<PromptCollapseContentProps> = ({
    variantId,
    promptId,
    className,
    viewOnly,
    ...props
}) => {
    // Minimal subscriptions by stable key `${revisionId}:${promptId}`
    const compoundKey = `${variantId}:${promptId}`

    // Seed local prompts cache once to avoid first-edit race between derived and local state
    const seedPrompts = useSetAtom(promptsAtomFamily(variantId))
    useEffect(() => {
        seedPrompts((draft: any) => draft)
        // run once per variantId mount
    }, [variantId])

    const promptVars = useAtomValue(
        useMemo(
            () => promptVariablesByPromptAtomFamily({revisionId: variantId, promptId}),
            [variantId, promptId],
        ),
    ) as string[]
    const hasVariable = (promptVars?.length || 0) > 0
    const isCustom = useAtomValue(isCustomAtom)

    return (
        <div className={clsx("flex flex-col gap-2 pt-3", className)} {...props}>
            <MessagesRenderer
                variantId={variantId}
                compoundKey={compoundKey}
                promptId={promptId}
                viewOnly={viewOnly}
            />
            <ToolsRenderer variantId={variantId} compoundKey={compoundKey} viewOnly={viewOnly} />

            {!isCustom && !hasVariable && !viewOnly && (
                <Alert
                    closable
                    message={
                        <>
                            Insert a <span className="font-semibold">{"{{variable}}"}</span> in your
                            template to create an input.
                        </>
                    }
                    type="info"
                    showIcon
                />
            )}

            <ActionsOutputRenderer
                variantId={variantId}
                compoundKey={compoundKey}
                viewOnly={viewOnly}
            />
        </div>
    )
}

export default PlaygroundVariantConfigPromptCollapseContent
