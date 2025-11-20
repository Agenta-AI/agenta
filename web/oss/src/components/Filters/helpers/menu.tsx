import {MenuProps} from "antd"

import {FieldMenuItem, FilterGroup, FilterLeaf, FilterMenuNode} from "../types"

import {EMPTY_DISABLED_OPTIONS} from "./annotation"
import {getGroupDefaultValue, getOptionKey} from "./utils"

export const buildFieldMenuItems = (
    nodes: FilterMenuNode[],
    onSelect: (value: string, displayLabel?: string) => void,
    parentKey = "root",
    ancestors: FilterGroup[] = [],
    submenuPopupClassName?: string,
    disabledOptionKeys: Set<string> = EMPTY_DISABLED_OPTIONS,
): MenuProps["items"] => {
    const items: MenuProps["items"] = []

    nodes.forEach((node, index) => {
        if (node.kind === "group") {
            const group = node as FilterGroup
            const groupKey = `group:${parentKey}:${index}`
            const defaultValue = getGroupDefaultValue(group)
            const isDefaultDisabled = defaultValue ? disabledOptionKeys.has(defaultValue) : false
            items.push({
                key: groupKey,
                label: (
                    <div
                        className={
                            defaultValue
                                ? "flex items-center gap-2 cursor-pointer"
                                : "flex items-center gap-2"
                        }
                    >
                        {group.icon ? <group.icon size={16} /> : null}
                        <span>{group.label}</span>
                    </div>
                ),
                children: buildFieldMenuItems(
                    group.children,
                    onSelect,
                    groupKey,
                    [...ancestors, group],
                    submenuPopupClassName,
                    disabledOptionKeys,
                ),
                onTitleClick: defaultValue
                    ? ({domEvent}: {domEvent: MouseEvent}) => {
                          if (isDefaultDisabled) {
                              domEvent.preventDefault()
                              domEvent.stopPropagation()
                              return
                          }
                          domEvent.preventDefault()
                          domEvent.stopPropagation()
                          onSelect(
                              defaultValue,
                              group.titleClickDisplayLabel ?? group.leafDisplayLabel,
                          )
                      }
                    : undefined,
                popupClassName: submenuPopupClassName,
            } as FieldMenuItem)
        } else {
            const leaf = node as FilterLeaf
            const optionKey = getOptionKey(leaf)
            items.push({
                key: optionKey,
                label: (
                    <div className="flex items-center gap-2">
                        {leaf.icon ? <leaf.icon size={16} /> : null}
                        <span>{leaf.label}</span>
                    </div>
                ),
                disabled: disabledOptionKeys.has(optionKey),
            } as FieldMenuItem)
        }
    })

    return items
}
