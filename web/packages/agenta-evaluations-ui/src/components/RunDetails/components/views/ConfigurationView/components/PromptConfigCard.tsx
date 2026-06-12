/* eslint-disable @typescript-eslint/no-explicit-any -- relocated eval run-details view; OSS-owned loose payload shapes (see §11.4) */
import {memo, useMemo} from "react"

import {PlaygroundConfigSection} from "@agenta/entity-ui"
import {Empty, Typography} from "antd"

import {useHostComponent} from "../../../../../../host/hostRegistry"

import PromptConfigCardSkeleton from "./PromptConfigCardSkeleton"

const {Text} = Typography

interface PromptConfigCardProps {
    variantId?: string | null
    parameters?: Record<string, any> | null | undefined
    customProperties?: Record<string, any> | null
    isLoading?: boolean
    hasSnapshot?: boolean
    className?: string
}

const PromptConfigCard = ({variantId, isLoading = false, className}: PromptConfigCardProps) => {
    const OSSdrillInUIProvider = useHostComponent("OSSdrillInUIProvider")
    const normalizedVariantId = useMemo(() => (variantId ? String(variantId) : ""), [variantId])

    if (isLoading) {
        return <PromptConfigCardSkeleton />
    }

    if (!normalizedVariantId) {
        return (
            <div className={className}>
                <div className="flex items-center justify-center py-8 px-4">
                    <Empty
                        description={
                            <Text type="secondary" className="text-center">
                                Prompt configuration unavailable because the revision identifier is
                                missing.
                            </Text>
                        }
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className={className}>
            <OSSdrillInUIProvider>
                <PlaygroundConfigSection revisionId={normalizedVariantId} disabled useServerData />
            </OSSdrillInUIProvider>
        </div>
    )
}

export default memo(PromptConfigCard)
