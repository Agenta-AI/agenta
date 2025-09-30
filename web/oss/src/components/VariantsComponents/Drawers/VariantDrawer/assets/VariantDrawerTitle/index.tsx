import {memo, useCallback, useMemo} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, Rocket} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import CommitVariantChangesButton from "@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import DeployVariantButton from "@/oss/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import {
    revisionListAtom,
    variantByRevisionIdAtomFamily,
} from "@/oss/components/Playground/state/atoms"
import {variantIsDirtyAtomFamily} from "@/oss/components/Playground/state/atoms"
import VariantNameCell from "@/oss/components/VariantNameCell"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {useQuery, useQueryParam} from "@/oss/hooks/useQuery"
import useURL from "@/oss/hooks/useURL"
import {currentVariantAppStatusAtom} from "@/oss/state/variant/atoms/fetcher"

import {VariantDrawerTitleProps} from "../types"
import {drawerVariantIsLoadingAtomFamily} from "../VariantDrawerContent"

// Local, focused subcomponents to reduce subscriptions and re-renders
const NavControls = memo(
    ({
        variantId,
        variantIds,
        variants,
        isLoading,
    }: Pick<VariantDrawerTitleProps, "variantId" | "variantIds" | "variants" | "isLoading">) => {
        const [, updateQuery] = useQuery("replace")
        const [displayMode] = useQueryParam("displayMode")
        const selectedVariant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
        const selectedParent = useMemo(() => {
            const parentId =
                typeof selectedVariant?._parentVariant === "string"
                    ? selectedVariant?._parentVariant
                    : selectedVariant?._parentVariant?.id
            return variants.find((v) => v.id === parentId)
        }, [variants, selectedVariant])

        const selectedVariantIndex = useMemo(() => {
            if (variantIds && variantIds.length > 1) {
                return variantIds.findIndex((id) => id === variantId)
            }
            if (displayMode && displayMode !== "flat") {
                if (selectedParent) {
                    return selectedParent.revisions?.findIndex((r) => r.id === variantId)
                }
                return variants?.findIndex((v) => v.id === variantId)
            }
            return variants?.findIndex((v) => v.id === variantId)
        }, [variantId, variants, selectedParent, displayMode, variantIds])

        const isDisableNext = useMemo(() => {
            if (variantIds && variantIds.length > 1) {
                return selectedVariantIndex === (variantIds.length ?? 0) - 1
            }
            if (displayMode && displayMode !== "flat") {
                if (selectedParent) {
                    return selectedVariantIndex === (selectedParent?.revisions?.length ?? 0) - 1
                }
                return selectedVariantIndex === (variants?.length ?? 0) - 1
            }
            return selectedVariantIndex === (variants?.length ?? 0) - 1
        }, [selectedVariantIndex, variants, selectedParent, displayMode, variantIds])

        const isDisablePrev = useMemo(() => selectedVariantIndex === 0, [selectedVariantIndex])

        const loadPrevVariant = useCallback(() => {
            if (selectedVariantIndex === undefined || selectedVariantIndex <= 0) return
            let nextId: string | undefined
            if (variantIds && variantIds.length > 1) {
                nextId = variantIds[selectedVariantIndex - 1]
            } else if (displayMode && displayMode !== "flat") {
                if (selectedParent) {
                    nextId = selectedParent?.revisions?.[selectedVariantIndex - 1]?.id
                } else {
                    nextId = variants?.[selectedVariantIndex - 1]?.id
                }
            } else {
                nextId = variants?.[selectedVariantIndex - 1]?.id
            }
            if (!nextId) return
            // Shallow URL update for shareable deep link
            updateQuery({revisionId: nextId, drawerType: "variant"})
        }, [selectedVariantIndex, displayMode, selectedParent, variants, updateQuery, variantIds])

        const loadNextVariant = useCallback(() => {
            if (selectedVariantIndex === undefined) return
            let nextId: string | undefined
            if (variantIds && variantIds.length > 1) {
                if (selectedVariantIndex < variantIds.length - 1) {
                    nextId = variantIds[selectedVariantIndex + 1]
                }
            } else if (displayMode && displayMode !== "flat") {
                if (selectedParent) {
                    if (
                        selectedParent?.revisions &&
                        selectedVariantIndex < (selectedParent.revisions?.length ?? 0) - 1
                    ) {
                        nextId = selectedParent.revisions[selectedVariantIndex + 1]?.id
                    }
                } else if (selectedVariantIndex < (variants?.length ?? 0) - 1) {
                    nextId = variants[selectedVariantIndex + 1]?.id
                }
            } else if (selectedVariantIndex < (variants?.length ?? 0) - 1) {
                nextId = variants[selectedVariantIndex + 1]?.id
            }
            if (!nextId) return
            // Shallow URL update for shareable deep link
            updateQuery({revisionId: nextId, drawerType: "variant"})
        }, [selectedVariantIndex, displayMode, selectedParent, variants, updateQuery, variantIds])

        return (
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
        )
    },
)

const VariantSummary = memo(({variantId}: {variantId: string}) => {
    return <VariantNameCell revisionId={variantId} showBadges />
})

const TitleActions = memo(
    ({
        variantId,
        viewAs,
        variants,
        isLoading,
    }: Pick<VariantDrawerTitleProps, "variantId" | "viewAs" | "variants" | "isLoading">) => {
        const appStatus = useAtomValue(currentVariantAppStatusAtom)
        const selectedVariant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
        const isDirty = useAtomValue(variantIsDirtyAtomFamily(variantId))
        const {goToPlayground} = usePlaygroundNavigation()
        const {appURL} = useURL()
        const router = useRouter()

        return (
            <div className="flex items-center gap-2">
                <Button
                    className="flex items-center gap-2"
                    size="small"
                    disabled={!appStatus || isLoading}
                    onClick={() => {
                        goToPlayground(selectedVariant ?? variantId)
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
                        !selectedVariant?._parentVariant ? selectedVariant?.variantId : undefined
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
                    commitType={viewAs}
                />
            </div>
        )
    },
)

const VariantDrawerTitle = ({
    onClose,
    variantId,
    variants,
    viewAs,
    variantIds,
}: VariantDrawerTitleProps) => {
    const isLoading = useAtomValue(drawerVariantIsLoadingAtomFamily(variantId))
    return (
        <section className="flex items-center justify-between">
            <div className="flex items-center gap-3">
                <Button onClick={onClose} type="text" icon={<CloseOutlined />} size="small" />

                <div className="flex items-center gap-2">
                    <NavControls
                        variantId={variantId}
                        variantIds={variantIds}
                        variants={variants}
                        isLoading={isLoading}
                    />

                    <VariantSummary variantId={variantId} />
                </div>
            </div>

            <TitleActions
                variantId={variantId}
                viewAs={viewAs}
                variants={variants}
                isLoading={isLoading}
            />
        </section>
    )
}

export default memo(VariantDrawerTitle)
