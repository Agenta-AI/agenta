import {useCallback, useState} from "react"

import {ArrowsLeftRight} from "@phosphor-icons/react"
import {TreeSelect} from "antd"
import clsx from "clsx"
import groupBy from "lodash/groupBy"
import uniqBy from "lodash/uniqBy"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import EnvironmentStatus from "@/oss/components/VariantDetailsWithStatus/components/EnvironmentStatus"
import {CamelCaseEnvironment} from "@/oss/lib/Types"

import AddButton from "../../../assets/AddButton"
import usePlayground from "../../../hooks/usePlayground"
import {PlaygroundStateData} from "../../../hooks/usePlayground/types"

import TreeSelectItemRenderer from "./assets/TreeSelectItemRenderer"
import {SelectVariantProps} from "./types"

const SelectVariant = ({showAsCompare = false, ...props}: SelectVariantProps) => {
    const {variantOptions} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const parents = groupBy(state.availableRevisions, "variantId")

            return {
                variantOptions: Object.values(parents).map((variantRevisions) => {
                    const deployedIn = uniqBy(
                        variantRevisions.reduce((acc, rev) => {
                            return [...acc, ...(rev.deployedIn || [])]
                        }, [] as CamelCaseEnvironment[]) as CamelCaseEnvironment[],
                        (env) => env.name,
                    )

                    return {
                        title: (
                            <div className="flex items-center justify-between">
                                <span> {variantRevisions[0].variantName}</span>
                                <EnvironmentStatus
                                    className="mr-2"
                                    variant={{
                                        deployedIn: deployedIn,
                                    }}
                                />
                            </div>
                        ),
                        selectable: false,
                        label: variantRevisions[0].variantName,
                        value: variantRevisions[0].variantId,
                        children: variantRevisions
                            .sort((a, b) => b.createdAtTimestamp - a.createdAtTimestamp)
                            .map((revision, idx) => {
                                return {
                                    title: (
                                        <div className="flex items-center justify-between">
                                            <VariantDetailsWithStatus
                                                className="w-full [&_.environment-badges]:mr-2"
                                                variantName={revision.variantName}
                                                revision={revision.revisionNumber}
                                                variant={revision}
                                                hideName
                                                showBadges
                                            />
                                        </div>
                                    ),
                                    label: revision.variantName,
                                    value: revision.id,
                                }
                            }),
                    }
                }),
            }
        }, []),
    })

    const [isOpenCompareSelect, setIsOpenCompareSelect] = useState(false)
    const [isOpenSelect, setIsOpenSelect] = useState(false)

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
                        open={isOpenCompareSelect}
                        onDropdownVisibleChange={(isOpen) => setIsOpenCompareSelect(isOpen)}
                        popupClassName={clsx([
                            "!w-[200px] pt-0",
                            "[&_.ant-select-tree-checkbox]:hidden",
                            "[&_.ant-select-tree-treenode-checkbox-checked>.ant-select-tree-node-content-wrapper]:bg-[#F5F7FA]",
                            "[&_.ant-select-tree-switcher]:!mx-0",
                            "[&_.ant-select-tree-treenode-active]:!bg-transparent",
                            "[&_.ant-select-tree-switcher-noop]:!hidden",
                            "[&_.ant-select-tree-node-content-wrapper]:!pl-0",
                            // "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-2",
                            "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-0",
                            // "[&_.ant-select-tree-node-content-wrapper]:!pr-4",
                        ])}
                        className="w-full opacity-0 relative z-[2]"
                        dropdownStyle={{maxHeight: 400, overflow: "auto"}}
                        size="small"
                        treeData={variantOptions}
                        tagRender={() => <div></div>}
                        filterTreeNode={(input, option) =>
                            ((option?.title as string) ?? "")
                                .toLowerCase()
                                .includes(input.toLowerCase())
                        }
                        dropdownRender={(menu) => (
                            <TreeSelectItemRenderer
                                close={handleClose}
                                isOpen={isOpenCompareSelect}
                                menu={menu}
                            />
                        )}
                        treeDefaultExpandAll
                        treeExpandAction="click"
                    />
                    <AddButton
                        icon={<ArrowsLeftRight size={14} />}
                        label="Compare"
                        className="absolute top-0 left-0 z-10"
                        onClick={() => setIsOpenCompareSelect((prev) => !prev)}
                        size="small"
                    />
                </div>
            ) : (
                <TreeSelect
                    {...props}
                    open={isOpenSelect}
                    onDropdownVisibleChange={(isOpen) => setIsOpenSelect(isOpen)}
                    style={{width: 120}}
                    dropdownStyle={{maxHeight: 400, overflow: "auto"}}
                    size="small"
                    placeholder="Select variant"
                    treeData={variantOptions}
                    treeNodeLabelProp="label"
                    filterTreeNode={(input, option) =>
                        ((option?.title as string) ?? "")
                            .toLowerCase()
                            .includes(input.toLowerCase())
                    }
                    dropdownRender={(menu) => (
                        <TreeSelectItemRenderer
                            close={handleClose}
                            isOpen={isOpenSelect}
                            menu={menu}
                        />
                    )}
                    treeDefaultExpandAll
                    treeExpandAction="click"
                    popupClassName={clsx([
                        "!w-[200px] pt-0",
                        "[&_.ant-select-tree-switcher-noop]:!hidden",
                        "[&_.ant-select-tree-node-content-wrapper]:!pl-0",
                        "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-0",
                    ])}
                />
            )}
        </>
    )
}

export default SelectVariant
