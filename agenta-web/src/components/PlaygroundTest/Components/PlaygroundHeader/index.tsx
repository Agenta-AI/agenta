import React, {memo, useCallback, useMemo, useState, useTransition} from "react"
import {Typography, message, Dropdown, Divider, Space, Button, Input} from "antd"
import clsx from "clsx"
import AddButton from "./../../assets/AddButton"
import NewVariantModal from "../NewVariantModal"
import usePlayground from "../../hooks/usePlayground"
import type {BaseContainerProps} from "../types"
import {useStyles} from "./assets/styles"

/**
 * PlaygroundHeader manages the creation of new variants in the playground.
 *
 * This component provides UI for adding new variants based on existing templates
 * and handles the state management for the variant creation modal.
 *
 * @component
 * @example
 * ```tsx
 * import { PlaygroundHeader } from './PlaygroundHeader'
 *
 * function App() {
 *   return <PlaygroundHeader />
 * }
 * ```
 */
const PlaygroundHeader: React.FC<BaseContainerProps> = ({className, ...divProps}) => {
    const [displayModal, _setDisplayModal] = useState(false)
    const [newVariantName, setNewVariantName] = useState("")
    const [baseVariantName, setBaseVariantName] = useState("")
    const [searchValue, setSearchValue] = useState("")
    const [isDropdownOpen, setIsDropdownOpen] = useState(false)
    const [, contextHolder] = message.useMessage()
    const [, startTransition] = useTransition()
    const classes = useStyles()

    // Wrap modal state updates in transitions to prevent UI blocking
    const setDisplayModal = useCallback((value: boolean) => {
        startTransition(() => {
            _setDisplayModal(value)
        })
    }, [])

    const {addVariant, variants} = usePlayground()

    // Track the selected base variant for creating new variants
    const baseVariant = useMemo(() => {
        return (variants || []).find((variant) => variant.variantName === baseVariantName)
    }, [variants, baseVariantName])

    // Validate and create new variants based on selected template
    const addNewVariant = useCallback(() => {
        if (!baseVariant) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        addVariant?.({
            baseVariantName: baseVariant.variantName,
            newVariantName: newVariantName,
        })
    }, [baseVariant, newVariantName, addVariant])

    // Menu items for the dropdown
    const items = useMemo(() => {
        return variants
            ?.filter((variant) =>
                variant.variantName.toLowerCase().includes(searchValue.toLowerCase()),
            )
            .map((variant) => ({
                key: variant.variantId,
                label: variant.variantName,
                onClick: () => {
                    setBaseVariantName(variant.variantName)
                },
            }))
    }, [variants, searchValue])

    // Only render if variants are available
    return !!variants ? (
        <>
            {contextHolder}
            <div
                className={clsx(
                    "flex justify-between items-center gap-4 px-4 py-2 bg-[#F5F7FA]",
                    className,
                )}
                {...divProps}
            >
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>

                <Dropdown
                    menu={{items}}
                    trigger={["click"]}
                    open={isDropdownOpen}
                    onOpenChange={(open) => setIsDropdownOpen(open)}
                    dropdownRender={(menu) => (
                        <div className={classes.dropdonwContainer}>
                            <Space className="flex justify-between w-full gap-2">
                                <Input
                                    placeholder="Search"
                                    value={searchValue}
                                    onChange={(e) => setSearchValue(e.target.value)}
                                />
                                <Button
                                    type="primary"
                                    onClick={() => {
                                        setIsDropdownOpen(false)
                                        setDisplayModal(true)
                                    }}
                                >
                                    Create new
                                </Button>
                            </Space>
                            <div className="!-mx-2">
                                <Divider className="!my-2" />
                            </div>
                            <div className="*:!shadow-none">{menu}</div>
                        </div>
                    )}
                >
                    <AddButton label={"Variant"} />
                </Dropdown>

                <NewVariantModal
                    variants={variants}
                    isModalOpen={displayModal}
                    setIsModalOpen={setDisplayModal}
                    newVariantName={newVariantName}
                    setNewVariantName={setNewVariantName}
                    addTab={addNewVariant}
                    setTemplateVariantName={setBaseVariantName}
                />
            </div>
        </>
    ) : null
}

export default memo(PlaygroundHeader)
