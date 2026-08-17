import type {ReactNode} from "react"

import type {SessionMenuEntry} from "@agenta/sessions-ui"
import type {MenuProps} from "antd"

/**
 * antd menu items → the package's neutral shape. `useSessionActions.menuItems` stays the single
 * source of the verbs (the playground session bar renders the same antd items), so the sessions
 * surfaces adapt at the edge instead of forking the list.
 */
export const toSessionMenuEntries = (items: MenuProps["items"]): SessionMenuEntry[] =>
    (items ?? []).flatMap((item): SessionMenuEntry[] => {
        if (!item) return []
        if ("type" in item && item.type === "divider") return [{type: "divider"}]
        if ("label" in item && item.key != null)
            return [
                {
                    key: String(item.key),
                    label: item.label as ReactNode,
                    danger: "danger" in item ? Boolean(item.danger) : false,
                    disabled: "disabled" in item ? Boolean(item.disabled) : false,
                },
            ]
        return []
    })

export const toAntdMenuEntries = (items: SessionMenuEntry[]): MenuProps["items"] =>
    items.map((item) =>
        "type" in item
            ? {type: "divider" as const}
            : {
                  key: item.key,
                  label: item.label,
                  danger: item.danger,
                  disabled: item.disabled,
              },
    )

export const mergeSessionMenuEntries = (
    sessionItems: SessionMenuEntry[],
    automationItems: SessionMenuEntry[],
): SessionMenuEntry[] => {
    if (!automationItems.length) return sessionItems
    const dividerIndex = sessionItems.findIndex((item) => "type" in item)
    if (dividerIndex < 0) return [...sessionItems, ...automationItems]
    return [
        ...sessionItems.slice(0, dividerIndex),
        ...automationItems,
        ...sessionItems.slice(dividerIndex),
    ]
}

export function selectSessionContextMenuItem(
    event: {stopPropagation: () => void},
    key: string,
    onSelect: (key: string) => void,
) {
    event.stopPropagation()
    onSelect(key)
}
