"use client"

import {memo, useCallback, useMemo, useState} from "react"

import {playgroundController} from "@agenta/playground"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {PlaygroundConfigSection} from "@agenta/entity-ui"

import BaseRunnableConfigSection from "./assets/BaseRunnableConfigSection"
import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import type {VariantConfigComponentProps} from "./types"

const RefinePromptModal = dynamic(
    () => import("../Modals/RefinePromptModal"),
    {ssr: false},
)

/**
 * PlaygroundVariantConfig manages the configuration interface for a single variant.
 *
 * Routes to entity-type specific config sections:
 * - legacyAppRevision: PlaygroundConfigSection (schema-driven)
 * - baseRunnable: BaseRunnableConfigSection (read-only key-value display)
 */

const PlaygroundVariantConfig: React.FC<
    VariantConfigComponentProps & {
        embedded?: boolean
        variantNameOverride?: string
        revisionOverride?: number | string | null
    }
> = ({variantId, className, embedded, variantNameOverride, revisionOverride, ...divProps}) => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const entityType = nodes.find((n) => n.entityId === variantId)?.entityType

    // Refine prompt modal state
    const [refineModalOpen, setRefineModalOpen] = useState(false)
    const [refinePromptKey, setRefinePromptKey] = useState<string | null>(null)

    const handleRefinePrompt = useCallback((promptKey: string) => {
        setRefinePromptKey(promptKey)
        setRefineModalOpen(true)
    }, [])

    const handleRefineClose = useCallback(() => {
        setRefineModalOpen(false)
        setRefinePromptKey(null)
    }, [])

    if (entityType === "baseRunnable") {
        return (
            <div className={clsx("w-full", "relative", "flex flex-col", className)} {...divProps}>
                <BaseRunnableConfigSection entityId={variantId} />
            </div>
        )
    }

    return (
        <div
            className={clsx(
                "w-full",
                "relative",
                "flex flex-col",
                className,
            )}
            {...divProps}
        >
            <PlaygroundVariantConfigHeader
                variantId={variantId}
                embedded={embedded}
                variantNameOverride={variantNameOverride}
                revisionOverride={revisionOverride}
            />
            <PlaygroundConfigSection
                revisionId={variantId}
                onRefinePrompt={handleRefinePrompt}
            />
            {refinePromptKey && (
                <RefinePromptModal
                    open={refineModalOpen}
                    onClose={handleRefineClose}
                    revisionId={variantId}
                    promptKey={refinePromptKey}
                />
            )}
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
