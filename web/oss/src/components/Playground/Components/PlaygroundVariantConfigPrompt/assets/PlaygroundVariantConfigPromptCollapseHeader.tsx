import {useCallback, useEffect, useMemo, useState} from "react"

import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {Wand2} from "lucide-react"
import dynamic from "next/dynamic"

import {getPromptById} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"
import {aiServicesApi} from "@/oss/services/aiServices/api"

import type {PromptCollapseHeaderProps} from "../types"

const {Text} = Typography

// Load model config component dynamically
const PlaygroundVariantModelConfig = dynamic(() => import("../../PlaygroundVariantModelConfig"), {
    ssr: false,
})

// Load refine prompt modal dynamically
const RefinePromptModal = dynamic(() => import("../../Modals/RefinePromptModal"), {ssr: false})

/**
 * PlaygroundVariantConfigPromptCollapseHeader renders the header section of a prompt configuration collapse.
 *
 * Features:
 * - Displays prompt label
 * - Integrates model configuration component
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantConfigPromptCollapseHeader
 *   variantId="variant-123"
 *   promptIndex={0}
 * />
 * ```
 */
const PlaygroundVariantConfigPromptCollapseHeader: React.FC<PromptCollapseHeaderProps> = ({
    variantId,
    className,
    promptId,
    viewOnly,
    ...props
}) => {
    const [refineModalOpen, setRefineModalOpen] = useState(false)
    const [aiServicesEnabled, setAiServicesEnabled] = useState<boolean | null>(null)
    const prompts = usePromptsSource(variantId)
    const promptName = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        return (item?.__name as string | undefined) ?? "Prompt"
    }, [prompts, promptId])

    // Check AI services status on mount
    useEffect(() => {
        let mounted = true
        aiServicesApi
            .getStatus()
            .then((status) => {
                if (mounted) setAiServicesEnabled(status.enabled)
            })
            .catch(() => {
                if (mounted) setAiServicesEnabled(false)
            })
        return () => {
            mounted = false
        }
    }, [])

    const handleRefineClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation() // Prevent collapse toggle
            if (aiServicesEnabled) {
                setRefineModalOpen(true)
            }
        },
        [aiServicesEnabled],
    )

    const handleRefineClose = useCallback(() => {
        setRefineModalOpen(false)
    }, [])

    const isDisabled = !aiServicesEnabled
    const tooltipTitle = isDisabled ? "AI services not available" : "Refine prompt with AI"

    return (
        <>
            <div className={clsx("w-full flex items-center justify-between", className)} {...props}>
                <Text className="capitalize whitespace-nowrap">{promptName || "Prompt"}</Text>
                <div className="flex items-center gap-2">
                    {!viewOnly && (
                        <Tooltip title={tooltipTitle}>
                            <Button
                                type="text"
                                size="small"
                                icon={<Wand2 className="h-4 w-4" aria-hidden="true" />}
                                onClick={handleRefineClick}
                                disabled={isDisabled}
                                aria-label="Refine prompt with AI"
                                className={clsx(
                                    "flex items-center justify-center",
                                    isDisabled
                                        ? "opacity-30 cursor-not-allowed"
                                        : "opacity-60 hover:opacity-100",
                                )}
                            />
                        </Tooltip>
                    )}
                    <PlaygroundVariantModelConfig
                        variantId={variantId}
                        promptId={promptId}
                        viewOnly={viewOnly}
                    />
                </div>
            </div>
            <RefinePromptModal
                open={refineModalOpen}
                onClose={handleRefineClose}
                variantId={variantId}
                promptId={promptId}
            />
        </>
    )
}

// Memoize the component to prevent unnecessary re-renders
export default PlaygroundVariantConfigPromptCollapseHeader
