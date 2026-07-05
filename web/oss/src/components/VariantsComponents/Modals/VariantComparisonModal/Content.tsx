import {useMemo, useState} from "react"

import {VariantDetailsWithStatus, VariantNameCell} from "@agenta/entity-ui/variant"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {
    comparisonModalAllVariantsAtom,
    comparisonModalCompareListAtom,
    type ComparisonRevision,
} from "./store/comparisonModalStore"
const DiffView = dynamic(() => import("@agenta/ui/editor").then((module) => module.DiffView), {
    ssr: false,
})

const formatTimestamp = (timestamp: number) => new Date(timestamp * 1000).toLocaleString()

const ModifiedByText = ({variant}: {variant: ComparisonRevision}) => {
    const displayName =
        (variant as any).modifiedByDisplayName ??
        (variant as any).modifiedBy ??
        (variant as any).createdBy ??
        "-"
    return <span>{displayName}</span>
}

const VariantComparisonContent = () => {
    const compareList = useAtomValue(comparisonModalCompareListAtom) || []
    const allVariants = useAtomValue(comparisonModalAllVariantsAtom) || []

    const availableVariants: ComparisonRevision[] = useMemo(
        () =>
            allVariants.length
                ? (allVariants as ComparisonRevision[])
                : (compareList as ComparisonRevision[]),
        [allVariants, compareList],
    )

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

    const originalText = useMemo(
        () => JSON.stringify(originalVariant?.parameters ?? {}),
        [originalVariant?.id],
    )
    const modifiedText = useMemo(
        () => JSON.stringify(modifiedVariant?.parameters ?? {}),
        [modifiedVariant?.id],
    )

    if (!originalVariant) return null

    const renderVariantDropdown = (
        currentVariant: ComparisonRevision,
        currentVariantId: string | undefined,
        onSelect: (id: string) => void,
        hoverClass: string,
    ) => (
        <DropdownMenu>
            <DropdownMenuTrigger
                className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit"
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    className={`cursor-pointer ${hoverClass} rounded p-1 -m-1 transition-colors flex items-center gap-1`}
                >
                    <VariantNameCell revisionId={currentVariant.id} showBadges />
                    <CaretDown size={12} />
                </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
                {availableVariants.map((variant) => (
                    <DropdownMenuItem
                        key={variant.id}
                        disabled={variant.id === currentVariantId}
                        onClick={() => onSelect(variant.id)}
                    >
                        <div className="flex items-center justify-between w-full py-2">
                            <VariantDetailsWithStatus
                                variantName={variant.variantName ?? variant.name}
                                revision={variant.revision}
                                variant={{id: variant.id}}
                                showBadges={false}
                                className="flex-1"
                            />
                            <span className="text-xs ml-2 text-muted-foreground">
                                {formatTimestamp(variant.createdAtTimestamp)}
                            </span>
                        </div>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )

    return (
        <div className="flex gap-6 h-[600px] pt-5">
            <div className="w-80 flex-shrink-0 space-y-4">
                <h4 className="!mb-4 !mt-0 text-base font-semibold leading-snug">
                    Variant Comparison
                </h4>

                <div className="space-y-6">
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-red-100 border border-red-300 rounded"></div>
                            <span className="text-red-700 font-semibold">Original Version</span>
                        </div>
                        <div className="ml-5">
                            <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                                <div className="mb-3">
                                    {availableVariants.length > 2 ? (
                                        renderVariantDropdown(
                                            originalVariant,
                                            originalVariantId || originalVariant.id,
                                            setOriginalVariantId,
                                            "hover:bg-red-100",
                                        )
                                    ) : (
                                        <VariantNameCell
                                            revisionId={originalVariant.id}
                                            showBadges
                                        />
                                    )}
                                </div>
                                <div className="space-y-2 text-sm">
                                    <div>
                                        <span className="font-semibold">Modified by:</span>{" "}
                                        <ModifiedByText variant={originalVariant} />
                                    </div>
                                    <div>
                                        <span className="font-semibold">Created:</span>{" "}
                                        <span className="text-muted-foreground">
                                            {formatTimestamp(originalVariant.createdAtTimestamp)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-green-100 border border-green-300 rounded"></div>
                            <span className="text-green-700 font-semibold">Modified Version</span>
                        </div>
                        <div className="ml-5">
                            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                                <div className="mb-3">
                                    {availableVariants.length > 2 ? (
                                        renderVariantDropdown(
                                            modifiedVariant,
                                            modifiedVariantId || modifiedVariant.id,
                                            setModifiedVariantId,
                                            "hover:bg-green-100",
                                        )
                                    ) : (
                                        <VariantNameCell
                                            revisionId={modifiedVariant.id}
                                            showBadges
                                        />
                                    )}
                                </div>
                                <div className="space-y-2 text-sm">
                                    <div>
                                        <span className="font-semibold">Modified by:</span>{" "}
                                        <ModifiedByText variant={modifiedVariant} />
                                    </div>
                                    <div>
                                        <span className="font-semibold">Created:</span>{" "}
                                        <span className="text-muted-foreground">
                                            {formatTimestamp(modifiedVariant.createdAtTimestamp)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

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
