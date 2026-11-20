/**
 * The box that finds one tool in a long catalogue.
 *
 * Shown only once a list is long enough to be worth searching: the mock server advertises three
 * tools and a filter above those is noise, while Linear advertises seventy-nine and without one
 * the only way to a particular tool is scrolling (UI QA round 3, scenario G).
 *
 * The same control serves the read-only list in the connection drawer and the permission editor
 * in an agent's configuration, so the two behave alike wherever a person meets them.
 */
import {TOOL_FILTER_THRESHOLD} from "@agenta/entities/mcpEndpoint"
import {useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import {Input} from "@agenta/ui/ui"

export interface ToolFilterInputProps {
    /** How many tools the server advertises, before filtering. */
    total: number
    value: string
    onChange: (value: string) => void
}

export const ToolFilterInput = ({total, value, onChange}: ToolFilterInputProps) => {
    const t = useT(mcpConnectCatalog)
    if (total < TOOL_FILTER_THRESHOLD) return null
    return (
        <Input
            value={value}
            aria-label={t("entityUi.mcpConnect.filterTools")}
            placeholder={t("entityUi.mcpConnect.filterCountTools", {count: total})}
            onChange={(event) => onChange(event.target.value)}
        />
    )
}

export default ToolFilterInput
