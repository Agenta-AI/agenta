import {useCallback} from "react"

import {SwapOutlined} from "@ant-design/icons"
import {Rocket} from "@phosphor-icons/react"
import {Button, Space, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"

import {
    recentRevisionsOverviewAtom,
    playgroundRevisionsReadyAtom,
} from "@/oss/components/Playground/state/atoms/variants"
import {
    openComparisonModalAtom,
    comparisonSelectionScopeAtom,
} from "@/oss/components/VariantsComponents/Modals/VariantComparisonModal/store/comparisonModalStore"
import {selectedVariantsCountAtom} from "@/oss/components/VariantsComponents/store/selectionAtoms"
import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQuery} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

const {Title} = Typography

const VariantsOverview = () => {
    const [, updateQuery] = useQuery()
    const {appURL} = useURL()

    // Drawer open/close is handled in VariantDrawerWrapper based on URL param
    const openComparisonModal = useSetAtom(openComparisonModalAtom)
    const setComparisonSelectionScope = useSetAtom(comparisonSelectionScopeAtom)
    const isRevisionsReady = useAtomValue(playgroundRevisionsReadyAtom)
    const slicedVariantList = useAtomValue(recentRevisionsOverviewAtom)
    const selectionScope = "overview/recent"
    const selectedCount = useAtomValue(selectedVariantsCountAtom(selectionScope))
    const {goToPlayground} = usePlaygroundNavigation()

    const handleNavigation = useCallback(
        (record?: EnhancedVariant) => {
            const revisionId = record ? ((record as any)?._revisionId ?? record.id) : undefined
            if (revisionId) {
                goToPlayground(revisionId)
            } else {
                goToPlayground()
            }
        },
        [goToPlayground],
    )

    return (
        <div className={clsx(["flex flex-col gap-2", "[&_>_div_h1.ant-typography]:text-xs"])}>
            <div className="flex items-center justify-between">
                <Title level={3} className="!m-0">
                    Recent Prompts
                </Title>

                <Space>
                    <Button
                        type="link"
                        disabled={selectedCount !== 2}
                        icon={<SwapOutlined />}
                        onClick={() => {
                            setComparisonSelectionScope(selectionScope)
                            openComparisonModal()
                        }}
                    >
                        Compare
                    </Button>

                    <Button
                        type="primary"
                        icon={<Rocket size={14} className="mt-[3px]" />}
                        onClick={() => handleNavigation()}
                    >
                        Playground
                    </Button>
                </Space>
            </div>

            <VariantsTable
                showEnvBadges
                showStableName
                variants={slicedVariantList}
                onRowClick={(variant: EnhancedVariant) => {
                    // Cosmetic URL update for deep linking
                    updateQuery({
                        revisionId: (variant as any)._revisionId ?? variant.id,
                        drawerType: "variant",
                    })
                }}
                selectionScope={selectionScope}
                isLoading={!isRevisionsReady}
                handleOpenDetails={(record: EnhancedVariant) => {
                    // Cosmetic URL update for deep linking
                    updateQuery({
                        revisionId: (record as any)._revisionId ?? record.id,
                        drawerType: "variant",
                    })
                }}
                handleOpenInPlayground={(record: EnhancedVariant) => {
                    handleNavigation(record)
                }}
            />
            <div className="flex justify-end">
                <Link href={`${appURL}/variants`} prefetch className="underline">
                    View all prompts →
                </Link>
            </div>
        </div>
    )
}

export default VariantsOverview
