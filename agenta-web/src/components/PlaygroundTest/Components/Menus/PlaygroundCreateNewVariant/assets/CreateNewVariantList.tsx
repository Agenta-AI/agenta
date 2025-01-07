import {useState, useMemo, useCallback} from "react"
import {Button, Input} from "antd"
import {Check} from "@phosphor-icons/react"
import debounce from "lodash/debounce"
import clsx from "clsx"
import {CreateNewVariantListProps, VariantItem} from "./types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {useStyles} from "./styles"
import NewVariantButton from "../../../NewVariantButton"

const CreateNewVariantList = ({
    selectedVariant,
    displayedVariants = [],
    onSelect,
    closeModal,
    className,
}: CreateNewVariantListProps) => {
    const classes = useStyles()
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

    const handleSearch = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value
            setQuery(value)
            debouncedSearch(value)
        },
        [debouncedSearch],
    )

    const onAddVariant = (variant: VariantItem) => {
        if (onSelect) {
            onSelect(variant.variantId)
        } else {
            setSelectedVariant?.(variant.variantId)
        }

        closeModal?.()
    }

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

            <ul className="list-none p-0 m-0 max-h-[300px] overflow-y-auto">
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
                                onClick={() => onAddVariant(variant)}
                                className={clsx([
                                    classes.variant,
                                    isSelected && classes.selectedVaraint,
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
