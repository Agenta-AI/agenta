import {useCallback, useMemo, useState} from "react"

import {ArrowsLeftRight} from "@phosphor-icons/react"
import {TreeSelect, Typography} from "antd"
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
    const [searchTerm, setSearchTerm] = useState("")
    const {revisionParents} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const parents = groupBy(state.availableRevisions || [], "variantId")

            return {
                revisionParents: parents,
            }
        }, []),
    })

    const variantOptions = useMemo(() => {
        const options = Object.values(revisionParents).map((variantRevisions) => {
            const deployedIn = uniqBy(
                variantRevisions.reduce((acc, rev) => {
                    return [...acc, ...(rev.deployedIn || [])]
                }, [] as CamelCaseEnvironment[]) as CamelCaseEnvironment[],
                (env) => env.name,
            )

            return {
                title: (
                    <div className="flex items-center justify-between pr-0 grow">
                        <Typography.Text ellipsis={{tooltip: variantRevisions[0].variantName}}>
                            {variantRevisions[0].variantName}
                        </Typography.Text>
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
                    .map((revision) => {
                        return {
                            title: (
                                <div className="flex items-center justify-between h-[32px] pl-1.5 pr-0">
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
                            revisionNumber: revision.revisionNumber,
                            value: revision.id,
                        }
                    }),
            }
        })

        if (searchTerm) {
            const lower = searchTerm.toLowerCase()

            return options
                .map((opt) => {
                    const parentMatches = opt.label.toLowerCase().includes(lower)
                    const children = parentMatches
                        ? opt.children
                        : opt.children.filter((child) =>
                              child.revisionNumber.toString().includes(lower),
                          )

                    return {...opt, children}
                })
                .filter((opt) => opt.label.toLowerCase().includes(lower) || opt.children.length > 0)
        }

        return options
    }, [revisionParents, searchTerm])

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
                        onOpenChange={(isOpen) => setIsOpenCompareSelect(isOpen)}
                        popupClassName={clsx([
                            "!w-[280px] pt-0",
                            "[&_.ant-select-tree-checkbox]:hidden",
                            "[&_.ant-select-tree-treenode-checkbox-checked>.ant-select-tree-node-content-wrapper]:bg-[#F5F7FA]",
                            "[&_.ant-select-tree-node-content-wrapper]:!pl-1",
                            "[&_.ant-select-tree-switcher]:!mx-0 [&_.ant-select-tree-switcher]:!me-0",
                            "[&_.ant-select-tree-treenode-active]:!bg-transparent",
                            "[&_.ant-select-tree-switcher-noop]:!hidden",
                            "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-0",
                            "[&_span.ant-select-tree-node-content-wrapper]:w-[calc(100%-24px)]",
                            "[&_.ant-select-tree-node-content-wrapper]:!pl-2 [&_.ant-select-tree-node-content-wrapper]:flex [&_.ant-select-tree-node-content-wrapper]:items-center [&_.ant-select-tree-node-content-wrapper]:!justify-between [&_.ant-select-tree-node-content-wrapper]:!rounded-md",
                            "[&_.ant-select-tree-switcher]:flex [&_.ant-select-tree-switcher]:items-center [&_.ant-select-tree-switcher]:justify-center",
                            "[&_.ant-select-tree-title]:w-full",
                        ])}
                        className="w-full opacity-0 relative z-[2]"
                        dropdownStyle={{maxHeight: 400, overflow: "auto"}}
                        size="small"
                        treeData={variantOptions}
                        tagRender={() => <div></div>}
                        dropdownRender={(menu) => (
                            <TreeSelectItemRenderer
                                close={handleClose}
                                isOpen={isOpenCompareSelect}
                                menu={menu}
                                showAsCompare={showAsCompare}
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
                        onClick={() => setIsOpenCompareSelect((prev) => !prev)}
                        size="small"
                    />
                </div>
            ) : (
                <TreeSelect
                    {...props}
                    open={isOpenSelect}
                    onOpenChange={(isOpen) => setIsOpenSelect(isOpen)}
                    style={{width: 120}}
                    dropdownStyle={{maxHeight: 400, overflow: "auto"}}
                    size="small"
                    placeholder="Select variant"
                    treeData={variantOptions}
                    treeNodeLabelProp="label"
                    dropdownRender={(menu) => (
                        <TreeSelectItemRenderer
                            close={handleClose}
                            isOpen={isOpenSelect}
                            menu={menu}
                            showAsCompare={showAsCompare}
                            searchTerm={searchTerm}
                            setSearchTerm={setSearchTerm}
                        />
                    )}
                    treeDefaultExpandAll
                    treeExpandAction="click"
                    popupClassName={clsx([
                        "!w-[280px] pt-0",
                        "[&_.ant-select-tree-switcher-noop]:!hidden",
                        "[&_.ant-select-tree-node-content-wrapper]:!pl-1",
                        "[&_.ant-select-tree-treenode-leaf_.ant-select-tree-node-content-wrapper]:!pl-0",
                        "[&_span.ant-select-tree-node-content-wrapper]:w-[calc(100%-24px)]",
                        "[&_.ant-select-tree-switcher]:!me-0",
                        "[&_.ant-select-tree-node-content-wrapper]:!pl-2 [&_.ant-select-tree-node-content-wrapper]:flex [&_.ant-select-tree-node-content-wrapper]:items-center [&_.ant-select-tree-node-content-wrapper]:!justify-between [&_.ant-select-tree-node-content-wrapper]:!rounded-md",
                        "[&_.ant-select-tree-switcher]:flex [&_.ant-select-tree-switcher]:items-center [&_.ant-select-tree-switcher]:justify-center",
                        "[&_.ant-select-tree-title]:w-full",
                    ])}
                />
            )}
        </>
    )
}

export default SelectVariant
