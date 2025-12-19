// @ts-nocheck
import {useCallback} from "react"

import {SwapOutlined} from "@ant-design/icons"
import {Rocket} from "@phosphor-icons/react"
import {Button, Space, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"

import {openComparisonModalAtom} from "@/oss/components/VariantsComponents/Modals/VariantComparisonModal/store/comparisonModalStore"
import {comparisonSelectionScopeAtom} from "@/oss/components/VariantsComponents/Modals/VariantComparisonModal/store/comparisonModalStore"
import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQuery} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {variantsPendingAtom} from "@/oss/state/loadingSelectors"
import {selectedVariantsCountAtom} from "@/oss/state/variant/atoms/selection"
import {recentRevisionsTableRowsAtom} from "@/oss/state/variant/selectors/variant"

const {Title} = Typography

const VariantsOverview = () => {
    const [, updateQuery] = useQuery()
    const {appURL} = useURL()

    // Drawer open/close is handled in VariantDrawerWrapper based on URL param
    const openComparisonModal = useSetAtom(openComparisonModalAtom)
    const setComparisonSelectionScope = useSetAtom(comparisonSelectionScopeAtom)
    const isVariantLoading = useAtomValue(variantsPendingAtom)
    const slicedVariantList = useAtomValue(recentRevisionsTableRowsAtom)
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
                <Title level={3}>Recent Prompts</Title>

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
                onRowClick={(variant) => {
                    // Cosmetic URL update for deep linking
                    updateQuery({
                        revisionId: variant._revisionId ?? variant.id,
                        drawerType: "variant",
                    })
                    // Open the drawer via atoms with an explicit selectedVariantId
                }}
                selectionScope={selectionScope}
                isLoading={isVariantLoading}
                handleOpenDetails={(record) => {
                    // Cosmetic URL update for deep linking
                    updateQuery({
                        revisionId: record._revisionId ?? record.id,
                        drawerType: "variant",
                    })
                    // Open the drawer via atoms with an explicit selectedVariantId
                }}
                handleOpenInPlayground={(record) => {
                    handleNavigation(record)
                }}
            />
            <Button className="w-fit self-end">
                <Link href={`${appURL}/variants`}>View all</Link>
            </Button>
        </div>
    )
}

export default VariantsOverview
