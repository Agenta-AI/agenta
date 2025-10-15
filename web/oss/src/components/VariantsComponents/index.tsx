// @ts-nocheck
import {useCallback, useMemo, useState} from "react"

import {SwapOutlined} from "@ant-design/icons"
import {Rocket} from "@phosphor-icons/react"
import {Button, Input, Radio, Space, Typography} from "antd"
import {getDefaultStore, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useAppId} from "@/oss/hooks/useAppId"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {formatDate24} from "@/oss/lib/helpers/dateTimeHelper"
import {variantsPendingAtom} from "@/oss/state/loadingSelectors"
import {promptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {useQueryParamState} from "@/oss/state/appState"
import {selectedVariantsCountAtom} from "@/oss/state/variant/atoms/selection"
import {
    modelNameByRevisionIdAtomFamily,
    revisionListAtom,
    variantDisplayNameByIdAtomFamily,
} from "@/oss/state/variant/selectors/variant"

import {useStyles} from "./assets/styles"
import {
    openComparisonModalAtom,
    comparisonSelectionScopeAtom,
} from "./Modals/VariantComparisonModal/store/comparisonModalStore"
import VariantsTable from "./Table"

// Comparison modal is opened via atoms; no local deploy/delete modals here

const VariantsDashboard = () => {
    const appId = useAppId()
    const router = useRouter()
    const classes = useStyles()
    const [, setQueryVariant] = useQueryParamState("revisionId")
    const [displayMode, setDisplayMode] = useQueryParam("displayMode", "flat")
    const [searchTerm, setSearchTerm] = useState("")
    const {baseAppURL} = useURL()
    // Data: use all revisions list and map once to table rows (no slicing)
    const revisions = useAtomValue(revisionListAtom)
    const isVariantLoading = useAtomValue(variantsPendingAtom)
    const baseRows = useMemo(() => {
        const store = getDefaultStore()
        return (revisions || []).map((r: any) => {
            const ts = r.updatedAtTimestamp ?? r.createdAtTimestamp
            const modelName = store.get(modelNameByRevisionIdAtomFamily(r.id))
            const variantName = store.get(variantDisplayNameByIdAtomFamily(r.variantId))
            return {
                id: r.id,
                variantId: r.variantId,
                variantName,
                commitMessage: r.commitMessage ?? r.commit_message ?? null,
                createdAt: formatDate24(ts),
                createdAtTimestamp: ts,
                modifiedBy: r.modifiedBy ?? r.modified_by ?? r.createdBy ?? r.created_by,
                modelName,
                _revisionId: r.id,
            }
        })
    }, [revisions])

    const filteredRows = useMemo(() => {
        if (!searchTerm) return baseRows
        const q = searchTerm.toLowerCase()
        return baseRows.filter((r: any) => (r.variantName || "").toLowerCase().includes(q))
    }, [baseRows, searchTerm])

    const tableRows = useMemo(() => {
        if (displayMode !== "grouped") return filteredRows
        // Group revisions by variantId; parent row uses latest revision id
        const byVariant: Record<string, any[]> = {}
        filteredRows.forEach((r: any) => {
            ;(byVariant[r.variantId] ||= []).push(r)
        })
        const groups: any[] = []
        Object.values(byVariant).forEach((arr) => {
            const sorted = [...arr].sort(
                (a, b) => (b.createdAtTimestamp || 0) - (a.createdAtTimestamp || 0),
            )
            const latest = sorted[0]
            const children = sorted.slice(1)
            groups.push({
                ...latest,
                _parentVariant: true,
                children,
            })
        })
        return groups
    }, [filteredRows, displayMode])

    // Selection/compare using global atoms with a stable scope
    const selectionScope = "variants/dashboard"
    const selectedCount = useAtomValue(selectedVariantsCountAtom(selectionScope))
    const openComparisonModal = useSetAtom(openComparisonModalAtom)
    const setComparisonSelectionScope = useSetAtom(comparisonSelectionScopeAtom)
    const {goToPlayground} = usePlaygroundNavigation()
    const prefetchPlayground = useCallback(async () => {
        if (appId) {
            router.prefetch(`${baseAppURL}/${appId}/playground`).catch(() => {})
        }
    }, [appId, baseAppURL, router])

    const handleNavigation = useCallback(
        async (record?: any) => {
            // Try to prefetch chunks before navigating for a seamless transition
            prefetchPlayground()
            // Prewarm prompts for the selected revision specifically
            const store = getDefaultStore()
            const revId = record?._revisionId ?? record?.id
            if (revId) {
                store.get(promptsAtomFamily(revId))
            }
            if (revId) {
                goToPlayground(revId)
            } else {
                goToPlayground()
            }
        },
        [goToPlayground, prefetchPlayground],
    )

    const handleOpenDetails = useCallback(
        (record: any) => {
            const revId = record._revisionId ?? record.id
            if (!revId) return
            // Shallow URL patch lets the route listener atom open the drawer
            setQueryVariant(revId, {shallow: true})
        },
        [setQueryVariant],
    )

    return (
        <>
            <div className={classes.container}>
                <Typography.Text className="text-[16px] font-medium">Variants</Typography.Text>

                <Space direction="vertical">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1">
                            <Input.Search
                                placeholder="Search"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="md:max-w-[300px] lg:max-w-[400px] lg:w-[400px]"
                                allowClear
                            />
                            <Radio.Group
                                value={displayMode}
                                onChange={(e) => setDisplayMode(e.target.value)}
                                className="flex-shrink-0"
                            >
                                <Radio.Button value="grouped">Variants</Radio.Button>
                                <Radio.Button value="flat">Revisions</Radio.Button>
                            </Radio.Group>
                        </div>

                        <div className="flex items-center gap-3">
                            {selectedCount > 0 && (
                                <Typography.Text type="secondary" className="flex-shrink-0">
                                    {selectedCount} selected
                                </Typography.Text>
                            )}

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
                                onMouseEnter={prefetchPlayground}
                                onClick={() => handleNavigation()}
                            >
                                Playground
                            </Button>
                        </div>
                    </div>

                    <VariantsTable
                        enableColumnResize
                        showEnvBadges
                        showStableName
                        variants={tableRows}
                        isLoading={isVariantLoading}
                        selectionScope={selectionScope}
                        onRowClick={handleOpenDetails}
                        handleOpenDetails={handleOpenDetails}
                        handleOpenInPlayground={(record) => handleNavigation(record)}
                    />
                </Space>
            </div>
        </>
    )
}

export default VariantsDashboard
