import {memo, useCallback, useMemo} from "react"
import {CloseOutlined} from "@ant-design/icons"
import {CaretDown, CaretUp, Rocket} from "@phosphor-icons/react"
import {Button} from "antd"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"

import {useRouter} from "next/router"

import {VariantDrawerTitleProps} from "../types"
import {useAppId} from "@/oss/hooks/useAppId"
import DeployVariantButton from "@/oss/components/NewPlayground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import {useQueryParam} from "@/oss/hooks/useQuery"
import CommitVariantChangesButton from "@/oss/components/NewPlayground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import {useAppsData} from "@/oss/contexts/app.context"
import {useVariants} from "@/oss/lib/hooks/useVariants"

const VariantDrawerTitle = ({
    selectedVariant,
    onClose,
    variants,
    isDirty,
}: VariantDrawerTitleProps) => {
    const appId = useAppId()
    const router = useRouter()
    const {currentApp} = useAppsData()
    // @ts-ignore
    const {mutate: fetchAllVariants} = useVariants(currentApp)({appId})
    const [_, setQueryVariant] = useQueryParam("revisions")

    const selectedVariantIndex = useMemo(() => {
        let index

        if (variants[0]?.revisions && variants[0]?.revisions.length > 0) {
            index = variants?.findIndex((v) => v.id === selectedVariant?._parentVariant.id)
        } else {
            index = variants?.findIndex((v) => v.id === selectedVariant?.id)
        }
        return index
    }, [selectedVariant, variants])

    const loadPrevVariant = useCallback(() => {
        if (selectedVariantIndex > 0) {
            setQueryVariant(JSON.stringify([variants[selectedVariantIndex - 1].id]))
        }
    }, [selectedVariant, variants])

    const loadNextVariant = useCallback(() => {
        if (selectedVariantIndex < variants?.length - 1) {
            setQueryVariant(JSON.stringify([variants[selectedVariantIndex + 1].id]))
        }
    }, [selectedVariant, variants])

    const isDisableNext = useMemo(() => {
        return selectedVariantIndex === variants?.length - 1
    }, [selectedVariantIndex, variants])

    const isDisablePrev = useMemo(() => {
        return selectedVariantIndex === 0
    }, [selectedVariantIndex])

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
                            disabled={isDisablePrev}
                        />
                        <Button
                            icon={<CaretDown size={16} />}
                            size="small"
                            type="text"
                            onClick={loadNextVariant}
                            disabled={isDisableNext}
                        />
                    </div>

                    <VariantDetailsWithStatus
                        variantName={selectedVariant?.variantName}
                        revision={selectedVariant?.revision}
                        variant={selectedVariant}
                    />
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    className="flex items-center gap-2"
                    size="small"
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
                />

                <CommitVariantChangesButton
                    variantId={selectedVariant?.id}
                    label="Commit"
                    type="default"
                    size="small"
                    disabled={!isDirty}
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
