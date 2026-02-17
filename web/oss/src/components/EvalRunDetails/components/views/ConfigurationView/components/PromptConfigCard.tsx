import {memo, useMemo} from "react"

import {Empty, Typography} from "antd"

import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import {PlaygroundConfigSection} from "@agenta/entity-ui"

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
                <PlaygroundConfigSection
                    revisionId={normalizedVariantId}
                    disabled
                    useServerData
                />
            </OSSdrillInUIProvider>
        </div>
    )
}

export default memo(PromptConfigCard)
