// @ts-nocheck
import {useCallback} from "react"

import {SwapOutlined} from "@ant-design/icons"
import {Rocket} from "@phosphor-icons/react"
import {Button, Space, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {openVariantDrawerAtom} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/store/variantDrawerStore"
import {openComparisonModalAtom} from "@/oss/components/VariantsComponents/Modals/VariantComparisonModal/store/comparisonModalStore"
import {comparisonSelectionScopeAtom} from "@/oss/components/VariantsComponents/Modals/VariantComparisonModal/store/comparisonModalStore"
import VariantsTable from "@/oss/components/VariantsComponents/Table"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {variantsPendingAtom} from "@/oss/state/loadingSelectors"
import {playgroundNavigationRequestAtom} from "@/oss/state/variant/atoms/navigation"
import {selectedVariantsCountAtom} from "@/oss/state/variant/atoms/selection"
import {
    recentRevisionsAtom,
    recentRevisionsTableRowsAtom,
} from "@/oss/state/variant/selectors/variant"

const {Title} = Typography

const VariantsOverview = () => {
    const router = useRouter()
    const appId = router.query.app_id as string
    const [, setQueryVariant] = useQueryParam("revisions")

    // Drawer open/close is handled in VariantDrawerWrapper based on URL param
    const openComparisonModal = useSetAtom(openComparisonModalAtom)
    const setComparisonSelectionScope = useSetAtom(comparisonSelectionScopeAtom)
    const isVariantLoading = useAtomValue(variantsPendingAtom)
    const slicedVariantList = useAtomValue(recentRevisionsTableRowsAtom)
    const selectionScope = "overview/recent"
    const selectedCount = useAtomValue(selectedVariantsCountAtom(selectionScope))
    const requestPlaygroundNav = useSetAtom(playgroundNavigationRequestAtom)
    const openVariantDrawer = useSetAtom(openVariantDrawerAtom)

    const handleNavigation = useCallback(
        (record?: EnhancedVariant) => {
            requestPlaygroundNav(
                record ? {appId, selectedKeys: [record._revisionId ?? record.id]} : {appId},
            )
        },
        [appId, requestPlaygroundNav],
    )

    return (
        <div className={clsx(["flex flex-col gap-2", "[&_>_div_h1.ant-typography]:text-xs"])}>
            <div className="flex items-center justify-between">
                <Space>
                    <Title>Recent Prompts</Title>
                    <Button>
                        <Link href={`/apps/${appId}/variants`}>View all</Link>
                    </Button>
                </Space>

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
                    setQueryVariant(JSON.stringify([variant._revisionId ?? variant.id]))
                    // Open the drawer via atoms with an explicit selectedVariantId
                    openVariantDrawer({
                        type: "variant",
                        variantsAtom: recentRevisionsAtom,
                        selectedVariantId: variant._revisionId ?? variant.id,
                    })
                }}
                selectionScope={selectionScope}
                isLoading={isVariantLoading}
                handleOpenDetails={(record) => {
                    // Cosmetic URL update for deep linking
                    setQueryVariant(JSON.stringify([record._revisionId ?? record.id]))
                    // Open the drawer via atoms with an explicit selectedVariantId
                    openVariantDrawer({
                        type: "variant",
                        variantsAtom: recentRevisionsAtom,
                        selectedVariantId: record._revisionId ?? record.id,
                    })
                }}
                handleOpenInPlayground={(record) => {
                    handleNavigation(record)
                }}
            />
        </div>
    )
}

export default VariantsOverview
