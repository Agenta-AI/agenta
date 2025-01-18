import {useState, useMemo, useCallback} from "react"

import clsx from "clsx"
import {Button, Input} from "antd"
import {Check} from "@phosphor-icons/react"
import {useDebounceValue} from "usehooks-ts"

import NewVariantButton from "../../../Modals/CreateVariantModal/assets/NewVariantButton"
import usePlayground from "../../../../hooks/usePlayground"

import {useStyles} from "./styles"

import type {CreateNewVariantListProps, VariantItem} from "./types"

const CreateNewVariantList = ({
    selectedVariant,
    displayedVariants = [],
    onSelect,
    className,
    closeModal,
}: CreateNewVariantListProps) => {
    const classes = useStyles()
    const [query, setQuery] = useState("")

    const [debouncedQuery] = useDebounceValue(query, 300)

    const {variantsList, toggleVariantDisplay} = usePlayground({
        stateSelector: (state) => ({
            variantsList: state.variants.map((variant) => ({
                variantId: variant.id,
                variantName: variant.variantName,
            })),
        }),
    })

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
    }, [])

    const onAddVariant = useCallback(
        (variant: VariantItem, isSelected: boolean) => {
            if (onSelect) {
                onSelect(variant.variantId)
                if (
                    displayedVariants.length === 2 &&
                    displayedVariants.includes(variant.variantId)
                ) {
                    closeModal?.()
                }
            } else {
                toggleVariantDisplay?.(variant.variantId, !isSelected)
            }
        },
        [onSelect, displayedVariants, closeModal, toggleVariantDisplay],
    )

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            <div className="flex justify-between w-full gap-2">
                <Input
                    value={query}
                    onChange={handleSearch}
                    placeholder="Search variants"
                    variant="borderless"
                />

                <NewVariantButton>
                    <Button size="small" type="primary">
                        Create New
                    </Button>
                </NewVariantButton>
            </div>

            <ul className="list-none p-0 m-0 max-h-[300px] overflow-y-auto flex flex-col gap-1">
                {filteredVariants.length === 0 ? (
                    <li className="text-center">No variants found</li>
                ) : (
                    filteredVariants.map((variant) => {
                        const isSelected =
                            variant.variantId === selectedVariant ||
                            displayedVariants.includes(variant.variantId)

                        return (
                            <li
                                key={variant.variantId}
                                onClick={() => onAddVariant(variant, isSelected)}
                                className={clsx([
                                    classes.variant,
                                    isSelected && classes.selectedVariant,
                                ])}
                            >
                                {variant.variantName}
                                {isSelected && (
                                    <Check className="absolute top-0 right-2 h-full flex items-center" />
                                )}
                            </li>
                        )
                    })
                )}
            </ul>
        </div>
    )
}

export default CreateNewVariantList
