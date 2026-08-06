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
