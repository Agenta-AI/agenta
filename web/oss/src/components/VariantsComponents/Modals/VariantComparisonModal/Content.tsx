import {useMemo, useState} from "react"

import {Dropdown, Typography} from "antd"
import {useAtomValue} from "jotai"

import DiffView from "@/oss/components/Editor/DiffView"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import VariantNameCell from "@/oss/components/VariantNameCell"

import {
    comparisonModalAllVariantsAtom,
    comparisonModalCompareListAtom,
    type ComparisonRevision,
} from "./store/comparisonModalStore"

const {Title, Text} = Typography

// All required data is sourced from atoms; no props needed

const formatTimestamp = (timestamp: number) => new Date(timestamp * 1000).toLocaleString()

const ModifiedByText = ({variant}: {variant: ComparisonRevision}) => {
    const displayName =
        (variant as any).modifiedByDisplayName ??
        (variant as any).modifiedBy ??
        (variant as any).createdBy ??
        "-"
    return <Text>{displayName}</Text>
}

const VariantComparisonContent = () => {
    // Fetch lists from atoms
    const compareList = useAtomValue(comparisonModalCompareListAtom) || []
    const allVariants = useAtomValue(comparisonModalAllVariantsAtom) || []

    // Prefer explicit allVariants when provided, else fall back to compare list
    const availableVariants: ComparisonRevision[] = useMemo(
        () =>
            allVariants.length
                ? (allVariants as ComparisonRevision[])
                : (compareList as ComparisonRevision[]),
        [allVariants, compareList],
    )

    // Defaults prefer the explicitly compared pair when present
    const [originalVariantId, setOriginalVariantId] = useState<string | undefined>(
        (compareList[0]?.id as string | undefined) ?? availableVariants[0]?.id,
    )
    const [modifiedVariantId, setModifiedVariantId] = useState<string | undefined>(
        (compareList[1]?.id as string | undefined) ?? availableVariants[1]?.id,
    )
    const originalVariant =
        availableVariants.find((v) => v.id === originalVariantId) || availableVariants[0]
    const modifiedVariant =
        availableVariants.find((v) => v.id === modifiedVariantId) ||
        availableVariants[1] ||
        availableVariants[0]

    // Memoize stringified parameters based on variant identity (id) to avoid
    // re-triggering Editor effects due to changing object references
    const originalText = useMemo(
        () => JSON.stringify(originalVariant?.parameters ?? {}),
        [originalVariant?.id],
    )
    const modifiedText = useMemo(
        () => JSON.stringify(modifiedVariant?.parameters ?? {}),
        [modifiedVariant?.id],
    )

    // Safety: require at least one variant to render
    if (!originalVariant) return null

    const createDropdownItems = (currentVariantId: string, onSelect: (id: string) => void) => {
        return availableVariants.map((variant) => ({
            key: variant.id,
            label: (
                <div className="flex items-center justify-between w-full py-2">
                    <VariantDetailsWithStatus
                        variantName={variant.variantName ?? variant.name}
                        revision={variant.revision}
                        variant={{id: variant.id}}
                        showBadges={false}
                        className="flex-1"
                    />
                    <Typography.Text type="secondary" className="text-xs ml-2">
                        {formatTimestamp(variant.createdAtTimestamp)}
                    </Typography.Text>
                </div>
            ),
            onClick: () => onSelect(variant.id),
            disabled: variant.id === currentVariantId,
        }))
    }

    const originalDropdownItems = createDropdownItems(
        originalVariantId || originalVariant.id,
        setOriginalVariantId,
    )
    const modifiedDropdownItems = createDropdownItems(
        modifiedVariantId || modifiedVariant.id,
        setModifiedVariantId,
    )

    return (
        <div className="flex gap-6 h-[600px] pt-5">
            {/* Left sidebar with variant information */}
            <div className="w-80 flex-shrink-0 space-y-4">
                <Title level={4} className="!mb-4 !mt-0">
                    Variant Comparison
                </Title>

                <div className="space-y-6">
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-red-100 border border-red-300 rounded"></div>
                            <Text strong className="text-red-700">
                                Original Version
                            </Text>
                        </div>
                        <div className="ml-5">
                            <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                                <div className="mb-3">
                                    {availableVariants.length > 2 ? (
                                        <Dropdown
                                            menu={{items: originalDropdownItems}}
                                            trigger={["click"]}
                                            placement="bottomLeft"
                                        >
                                            <div className="cursor-pointer hover:bg-red-100 rounded p-1 -m-1 transition-colors">
                                                <VariantNameCell
                                                    revisionId={originalVariant.id}
                                                    showBadges
                                                />
                                            </div>
                                        </Dropdown>
                                    ) : (
                                        <VariantNameCell
                                            revisionId={originalVariant.id}
                                            showBadges
                                        />
                                    )}
                                </div>
                                <div className="space-y-2 text-sm">
                                    <div>
                                        <Text strong>Modified by:</Text>{" "}
                                        <ModifiedByText variant={originalVariant} />
                                    </div>
                                    <div>
                                        <Text strong>Created:</Text>{" "}
                                        <Text type="secondary">
                                            {formatTimestamp(originalVariant.createdAtTimestamp)}
                                        </Text>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-green-100 border border-green-300 rounded"></div>
                            <Text strong className="text-green-700">
                                Modified Version
                            </Text>
                        </div>
                        <div className="ml-5">
                            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                                <div className="mb-3">
                                    {availableVariants.length > 2 ? (
                                        <Dropdown
                                            menu={{items: modifiedDropdownItems}}
                                            trigger={["click"]}
                                            placement="bottomLeft"
                                        >
                                            <div className="cursor-pointer hover:bg-green-100 rounded p-1 -m-1 transition-colors">
                                                <VariantNameCell
                                                    revisionId={modifiedVariant.id}
                                                    showBadges
                                                />
                                            </div>
                                        </Dropdown>
                                    ) : (
                                        <VariantNameCell
                                            revisionId={modifiedVariant.id}
                                            showBadges
                                        />
                                    )}
                                </div>
                                <div className="space-y-2 text-sm">
                                    <div>
                                        <Text strong>Modified by:</Text>{" "}
                                        <ModifiedByText variant={modifiedVariant} />
                                    </div>
                                    <div>
                                        <Text strong>Created:</Text>{" "}
                                        <Text type="secondary">
                                            {formatTimestamp(modifiedVariant.createdAtTimestamp)}
                                        </Text>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right side with diff view */}
            <div className="compare-diff w-[100%] max-w-prose self-stretch overflow-y-auto flex flex-col min-h-0 p-1">
                <DiffView
                    language="json"
                    original={originalText}
                    modified={modifiedText}
                    className="border rounded-lg h-full overflow-auto"
                />
            </div>
        </div>
    )
}

export default VariantComparisonContent
