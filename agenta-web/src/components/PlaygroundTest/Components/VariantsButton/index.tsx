import {useState, useMemo, useCallback} from "react"

import {Button, Input, Popover} from "antd"
import {CaretDown, Check, MagnifyingGlass} from "@phosphor-icons/react"
import debounce from "lodash/debounce"
import clsx from "clsx"

import usePlayground from "../../hooks/usePlayground"
import NewVariantButton from "../NewVariantButton"

import type { VariantsButtonProps, VariantsListProps } from "./types"
import type { EnhancedVariant } from "../../assets/utilities/transformer/types"

const VariantsList = ({selectedVariant, displayedVariants = [], onSelect, closeModal}: VariantsListProps) => {
    const [query, setQuery] = useState("")
    const [debouncedQuery, setDebouncedQuery] = useState("")

    const {variantsList, setSelectedVariant} = usePlayground({
        stateSelector: (state) => ({
            variantsList: state.variants.map((variant) => ({
                variantId: variant.id,
                variantName: variant.variantName,
            })),
        }),
    })

    // Debounced search handler
    const debouncedSearch = useMemo(
        () =>
            debounce((value: string) => {
                setDebouncedQuery(value.toLowerCase())
            }, 300),
        [],
    )

    // Memoized filtered variants
    const filteredVariants = useMemo(() => {
        if (!debouncedQuery) return variantsList
        return variantsList.filter((variant) =>
            variant.variantName.toLowerCase().includes(debouncedQuery),
        )
    }, [variantsList, debouncedQuery])

    const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setQuery(value)
        debouncedSearch(value)
    }, [])

    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <MagnifyingGlass
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                        size={16}
                    />
                    <Input
                        value={query}
                        onChange={handleSearch}
                        className="pl-8"
                        placeholder="Search variants"
                        bordered={false}
                    />
                </div>
                <NewVariantButton>
                    <Button size="small" type="primary">
                        Create New
                    </Button>
                </NewVariantButton>
            </div>
            <ul className="list-none p-0 m-0 max-h-[300px] overflow-y-auto">
                {filteredVariants.length === 0 ? (
                    <li className="p-2 text-gray-500 text-center">No variants found</li>
                ) : (
                    filteredVariants.map((variant) => {
                        const isSelected = variant.variantId === selectedVariant || displayedVariants.includes(variant.variantId)
                        return (
                            <li
                                className={clsx([
                                    "p-2 hover:bg-[rgba(5,23,41,0.03)] relative",
                                    {
                                        "bg-[rgba(5,23,41,0.06)]":
                                        isSelected,
                                    },
                                ])}
                                key={variant.variantId}
                                onClick={() => {
                                    if (onSelect) {
                                        onSelect(variant.variantId)
                                    } else {
                                        setSelectedVariant?.(variant.variantId)
                                    }

                                    closeModal?.()
                                }}
                            >
                                {variant.variantName}
                                {
                                    // Add checkmark if variant is selected
                                    isSelected && (
                                        <div className="absolute top-0 right-2 h-full flex items-center">
                                            <Check />
                                        </div>
                                    )
                                }
                            </li>
                        )
                    })
                )}
            </ul>
        </div>
    )
}

const VariantsButton = ({
    className,
    displayedVariants,
    onSelect,
    selectedVariant,
    ...popoverProps
}: VariantsButtonProps) => {
    // Local state for modal visibility
    const {variantName} = usePlayground({
        variantId: selectedVariant,
        variantSelector: useCallback((variant: EnhancedVariant) => ({
            variantName: variant.variantName,
        }), []),
    })
    const [isModalOpen, setIsModalOpen] = useState(false)

    return (
        <Popover
            {...popoverProps}
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            trigger={["click"]}
            arrow={false}
            content={
                <VariantsList
                    displayedVariants={displayedVariants}
                    onSelect={onSelect}
                    selectedVariant={selectedVariant}
                    closeModal={() => setIsModalOpen(false)}
                />
            }
            className={className}
        >
            <Button>
                {variantName || "Variants"} <CaretDown size={14} />
            </Button>
        </Popover>
    )
}

export default VariantsButton
