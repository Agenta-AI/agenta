import {useState, useMemo, useCallback} from "react"

import {Check} from "@phosphor-icons/react"
import {Button, Input} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {useDebounceValue} from "usehooks-ts"

import {
    toggleVariantDisplayMutationAtom,
    variantListDisplayFilteredAtomFamily,
} from "../../../../state/atoms"
import NewVariantButton from "../../../Modals/CreateVariantModal/assets/NewVariantButton"

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

    // Use filtered display list from atoms
    const variantsDisplay = useAtomValue(variantListDisplayFilteredAtomFamily(debouncedQuery))
    const toggleVariantDisplay = useSetAtom(toggleVariantDisplayMutationAtom)

    const variantsList = useMemo(() => {
        return (variantsDisplay || []).map((v: any) => ({
            variantId: v.id,
            variantName: v.name,
        }))
    }, [variantsDisplay])

    // Atom already filters; keep memoized mapped list only
    const filteredVariants = variantsList

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
