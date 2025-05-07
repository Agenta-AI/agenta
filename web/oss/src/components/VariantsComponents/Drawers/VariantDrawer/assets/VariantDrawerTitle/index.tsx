import {memo, useCallback, useMemo} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, Rocket} from "@phosphor-icons/react"
import {Button} from "antd"
import {useRouter} from "next/router"

import CommitVariantChangesButton from "@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import DeployVariantButton from "@/oss/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {useQueryParam} from "@/oss/hooks/useQuery"
import {useVariants} from "@/oss/lib/hooks/useVariants"

import {VariantDrawerTitleProps} from "../types"

const VariantDrawerTitle = ({
    selectedVariant,
    onClose,
    variants,
    isDirty,
    selectedDrawerVariant,
    isLoading,
}: VariantDrawerTitleProps) => {
    const {appStatus} = usePlayground({
        stateSelector: (state) => ({
            appStatus: state.appStatus,
        }),
    })
    const appId = useAppId()
    const router = useRouter()
    const {currentApp} = useAppsData()
    // @ts-ignore
    const {mutate: fetchAllVariants} = useVariants(currentApp)({appId})
    const [_, setQueryVariant] = useQueryParam("revisions")
    const [displayMode] = useQueryParam("displayMode")

    const selectedParent = useMemo(
        () => variants.find((v) => v.id === selectedVariant?._parentVariant.id),
        [variants, selectedVariant],
    )

    const selectedVariantIndex = useMemo(() => {
        if (selectedDrawerVariant && !selectedDrawerVariant._parentVariant) {
            return variants?.findIndex((v) => v.id === selectedVariant?._parentVariant?.id)
        }
        if (displayMode && displayMode !== "flat") {
            if (selectedParent) {
                return selectedParent.revisions?.findIndex((r) => r.id === selectedVariant?.id)
            }
            return variants?.findIndex((v) => v.id === selectedVariant?.id)
        }
        return variants?.findIndex((v) => v.id === selectedVariant?.id)
    }, [selectedVariant, variants, selectedDrawerVariant, selectedParent, displayMode])

    const loadPrevVariant = useCallback(() => {
        if (selectedVariantIndex === undefined || selectedVariantIndex <= 0) return
        if (displayMode && displayMode !== "flat") {
            if (selectedDrawerVariant && selectedDrawerVariant._parentVariant) {
                setQueryVariant(
                    JSON.stringify([selectedParent?.revisions?.[selectedVariantIndex - 1]?.id]),
                )
            } else {
                setQueryVariant(JSON.stringify([variants?.[selectedVariantIndex - 1]?.id]))
            }
        } else {
            setQueryVariant(JSON.stringify([variants?.[selectedVariantIndex - 1]?.id]))
        }
    }, [
        selectedVariantIndex,
        displayMode,
        selectedDrawerVariant,
        selectedParent,
        variants,
        setQueryVariant,
    ])

    const loadNextVariant = useCallback(() => {
        if (selectedVariantIndex === undefined) return
        if (displayMode && displayMode !== "flat") {
            if (selectedDrawerVariant && selectedDrawerVariant._parentVariant) {
                if (
                    selectedParent?.revisions &&
                    selectedVariantIndex < selectedParent.revisions.length - 1
                ) {
                    setQueryVariant(
                        JSON.stringify([selectedParent.revisions[selectedVariantIndex + 1]?.id]),
                    )
                }
            } else if (selectedVariantIndex < (variants?.length ?? 0) - 1) {
                setQueryVariant(JSON.stringify([variants[selectedVariantIndex + 1]?.id]))
            }
        } else if (selectedVariantIndex < (variants?.length ?? 0) - 1) {
            setQueryVariant(JSON.stringify([variants[selectedVariantIndex + 1]?.id]))
        }
    }, [
        selectedVariantIndex,
        displayMode,
        selectedDrawerVariant,
        selectedParent,
        variants,
        setQueryVariant,
    ])

    const isDisableNext = useMemo(() => {
        if (displayMode && displayMode !== "flat") {
            if (selectedDrawerVariant && selectedDrawerVariant._parentVariant) {
                return selectedVariantIndex === (selectedParent?.revisions?.length ?? 0) - 1
            }
            return selectedVariantIndex === (variants?.length ?? 0) - 1
        }
        return selectedVariantIndex === (variants?.length ?? 0) - 1
    }, [selectedVariantIndex, variants, selectedParent, selectedDrawerVariant, displayMode])

    const isDisablePrev = useMemo(() => selectedVariantIndex === 0, [selectedVariantIndex])

    return (
        <section className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Button onClick={onClose} type="text" icon={<CloseOutlined />} size="small" />

                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <Button
                            icon={<CaretUp size={16} />}
                            size="small"
                            type="text"
                            onClick={loadPrevVariant}
                            disabled={isDisablePrev || isLoading}
                        />
                        <Button
                            icon={<CaretDown size={16} />}
                            size="small"
                            type="text"
                            onClick={loadNextVariant}
                            disabled={isDisableNext || isLoading}
                        />
                    </div>

                    <VariantDetailsWithStatus
                        variantName={selectedVariant?.variantName}
                        revision={selectedVariant?.revision}
                        variant={{
                            deployedIn: selectedVariant?.deployedIn,
                            isLatestRevision: selectedVariant?.isLatestRevision ?? false,
                            isDraft: isDirty ?? false,
                        }}
                    />
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    className="flex items-center gap-2"
                    size="small"
                    disabled={!appStatus || isLoading}
                    onClick={() => {
                        router.push({
                            pathname: `/apps/${appId}/playground`,
                            query: selectedVariant
                                ? {
                                      revisions: JSON.stringify([selectedVariant?.id]),
                                  }
                                : {},
                        })
                    }}
                >
                    <Rocket size={14} />
                    Playground
                </Button>

                <DeployVariantButton
                    label="Deploy"
                    type="default"
                    size="small"
                    variantId={
                        !selectedVariant?._parentVariant
                            ? selectedVariant?._parentVariant?.id
                            : undefined
                    }
                    revisionId={selectedVariant?._parentVariant ? selectedVariant?.id : undefined}
                    disabled={isLoading}
                />

                <CommitVariantChangesButton
                    variantId={selectedVariant?.id}
                    label="Commit"
                    type="default"
                    size="small"
                    disabled={!isDirty || isLoading}
                    onSuccess={({revisionId, variantId}) => {
                        fetchAllVariants()

                        if (variants[0]?.revisions && variants[0]?.revisions.length > 0) {
                            if (variantId) {
                                setQueryVariant(JSON.stringify([variantId]))
                            }
                        } else {
                            setQueryVariant(JSON.stringify([revisionId]))
                        }
                    }}
                />
            </div>
        </section>
    )
}

export default memo(VariantDrawerTitle)
