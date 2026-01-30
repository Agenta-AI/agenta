import {useCallback, useMemo, useState} from "react"

import {ArrowsLeftRight} from "@phosphor-icons/react"
import {TreeSelect, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import EnvironmentStatus from "@/oss/components/VariantDetailsWithStatus/components/EnvironmentStatus"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"

import AddButton from "../../../assets/AddButton"
import {variantOptionsAtomFamily} from "../../../state/atoms/optionsSelectors"

import TreeSelectItemRenderer from "./assets/TreeSelectItemRenderer"
import {SelectVariantProps} from "./types"

const SelectVariant = ({
    value,
    showAsCompare = false,
    showCreateNew = true,
    showLatestTag = true,
    style,
    ...props
}: SelectVariantProps) => {
    const [searchTerm, setSearchTerm] = useState("")

    // Use optimized selector atom with deep equality checks
    const variantOptionsAtom = useMemo(() => variantOptionsAtomFamily(searchTerm), [searchTerm])
    const baseOptions = useAtomValue(variantOptionsAtom)

    // Create final options with JSX titles (since JSX can't be in atoms)
    const variantOptions = useMemo(() => {
        return baseOptions.map((option) => ({
            ...option,
            title: (
                <div className="flex items-center justify-between pr-0 grow">
                    <Typography.Text ellipsis={{tooltip: option.variantName}}>
                        {option.variantName}
                    </Typography.Text>
                    <EnvironmentStatus
                        className="mr-2"
                        variant={{
                            deployedIn: option.deployedIn,
                        }}
                    />
                </div>
            ),
            children: option.children.map((child) => ({
                ...child,
                title: (
                    <div className="flex items-center justify-between h-[32px] pl-1.5 pr-0">
                        <VariantDetailsWithStatus
                            className="w-full [&_.environment-badges]:mr-2"
                            variantName={child.variantName}
                            revision={child.revision}
                            variant={child.variant}
                            hideName
                            showBadges
                            showLatestTag={showLatestTag}
                        />
                    </div>
                ),
            })),
        }))
    }, [baseOptions, showLatestTag])

    const [isOpenCompareSelect, setIsOpenCompareSelect] = useState(false)
    const [isOpenSelect, setIsOpenSelect] = useState(false)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    const handleClose = useCallback(() => {
        setIsOpenSelect(false)
        setIsOpenCompareSelect(false)
    }, [])

    return (
        <>
            {showAsCompare ? (
                <div className="relative w-[90px] h-[24px]">
                    <TreeSelect
                        {...props}
                        // value={value?.map((v) => v.id)}
                        value={value}
                        open={isOpenCompareSelect}
                        classNames={{
                            popup: {
                                root: clsx([
                                    "!w-[280px] pt-0",
                                    "[&_.ant-select-tree-checkbox]:hidden",
                                    "[&_.ant-select-tree-treenode-checkbox-checked>.ant-select-tree-node-content-wrapper]:bg-[#F5F7FA]",
                                    "[&_.ant-select-tree-node-content-wrapper]:!pl-1",
                                    "[&_.ant-select-tree-switcher]:!mx-0 [&_.ant-select-tree-switcher]:!me-0",
                                    "[&_.ant-select-tree-treenode-active]:!bg-transparent",
                                    "[&_.ant-select-tree-switcher-noop]:!hidden",
                                    "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-0",
                                    "&_span.ant-select-tree-node-content-wrapper]:w-[calc(100%-24px)]",
                                    "[&_.ant-select-tree-node-content-wrapper]:!pl-2 [&_.ant-select-tree-node-content-wrapper]:flex [&_.ant-select-tree-node-content-wrapper]:items-center [&_.ant-select-tree-node-content-wrapper]:!justify-between [&_.ant-select-tree-node-content-wrapper]:!rounded-md",
                                    "[&_.ant-select-tree-switcher]:flex [&_.ant-select-tree-switcher]:items-center [&_.ant-select-tree-switcher]:justify-center",
                                    "[&_.ant-select-tree-title]:w-full",
                                ]),
                            },
                        }}
                        onOpenChange={(isOpen) => setIsOpenCompareSelect(isOpen)}
                        className="w-full opacity-0 relative z-[2]"
                        styles={{
                            popup: {
                                root: {maxHeight: 400, overflow: "auto"},
                            },
                        }}
                        size="small"
                        treeData={variantOptions}
                        // fieldNames={{value: "value", label: "label", children: "children"}}
                        // treeData={[]}
                        tagRender={() => <div></div>}
                        popupRender={(menu) => (
                            <TreeSelectItemRenderer
                                close={handleClose}
                                isOpen={isOpenCompareSelect}
                                menu={menu}
                                showAsCompare={showAsCompare}
                                showCreateNew={showCreateNew}
                                searchTerm={searchTerm}
                                setSearchTerm={setSearchTerm}
                            />
                        )}
                        treeDefaultExpandAll
                        treeExpandAction="click"
                    />
                    <AddButton
                        icon={<ArrowsLeftRight size={14} />}
                        label="Compare"
                        className="absolute top-0 left-0 z-10"
                        onClick={() => {
                            recordWidgetEvent("playground_compared_side_by_side")
                            setIsOpenCompareSelect((prev) => !prev)
                        }}
                        size="small"
                        data-tour="compare-toggle"
                    />
                </div>
            ) : (
                <>
                    <TreeSelect
                        {...props}
                        open={isOpenSelect}
                        value={value}
                        onOpenChange={(isOpen) => setIsOpenSelect(isOpen)}
                        style={style ?? {width: 120}}
                        styles={{popup: {root: {maxHeight: 400, overflow: "auto"}}}}
                        size="small"
                        placeholder="Select variant"
                        treeData={variantOptions}
                        treeNodeLabelProp="label"
                        popupRender={(menu) => (
                            <TreeSelectItemRenderer
                                close={handleClose}
                                isOpen={isOpenSelect}
                                menu={menu}
                                showAsCompare={showAsCompare}
                                showCreateNew={showCreateNew}
                                searchTerm={searchTerm}
                                setSearchTerm={setSearchTerm}
                            />
                        )}
                        treeDefaultExpandAll
                        treeExpandAction="click"
                        classNames={{
                            popup: {
                                root: clsx([
                                    "!w-[280px] pt-0",
                                    "[&_.ant-select-tree-switcher-noop]:!hidden",
                                    "[&_.ant-select-tree-node-content-wrapper]:!pl-1",
                                    "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-0",
                                    "[&_span.ant-select-tree-node-content-wrapper]:w-[calc(100%-24px)]",
                                    "[&_.ant-select-tree-switcher]:!me-0",
                                    "[&_.ant-select-tree-node-content-wrapper]:!pl-2 [&_.ant-select-tree-node-content-wrapper]:flex [&_.ant-select-tree-node-content-wrapper]:items-center [&_.ant-select-tree-node-content-wrapper]:!justify-between [&_.ant-select-tree-node-content-wrapper]:!rounded-md",
                                    "[&_.ant-select-tree-switcher]:flex [&_.ant-select-tree-switcher]:items-center [&_.ant-select-tree-switcher]:justify-center",
                                    "[&_.ant-select-tree-title]:w-full",
                                ]),
                            },
                        }}
                    />
                    {/* null */}
                </>
            )}
        </>
    )
}

export default SelectVariant
