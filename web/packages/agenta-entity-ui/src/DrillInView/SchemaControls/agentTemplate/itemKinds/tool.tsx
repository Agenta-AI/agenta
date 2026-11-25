import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import type {ConfigItemRef} from "@agenta/ui/view-stack"
import {Wrench} from "@phosphor-icons/react"

import {ToolFormView} from "../../ToolFormView"
import {
    buildIntegrationRows,
    findIntegrationRow,
    parseGatewayEntry,
    removeIntegrationRow,
    type GatewayConnectionTarget,
} from "../../toolUtils"
import {describeSubagent, describeTool, isFunctionTool, isReferenceTool} from "../itemDescriptors"

import type {ItemKindDef} from "./types"

const t = createT(configItemsCatalog)

export const toolKind: ItemKindDef = {
    kind: "tool",
    field: "tools",
    icon: <Wrench size={16} />,
    noun: "tool",
    get emptyLabel() {
        return t("entityUi.configItems.noToolsYet")
    },
    describe: describeTool,
    FormView: ToolFormView,
    // Only the two-pane parameter editor wants width and its own padding.
    drawerWidth: (draft) => (isReferenceTool(draft) ? undefined : 800),
    formFlush: (draft) => !isReferenceTool(draft),
    drawerTitle: (draft) => {
        // A subagent's header is the agent's NAME. describeTool would call it a workflow.
        if (isReferenceTool(draft)) return describeSubagent(draft).name
        const name = describeTool(draft).name
        const fn = draft.function as Record<string, unknown> | undefined
        // An unnamed function tool shows the generic fallback, so it reads as a new one.
        const unnamedFunction = !!fn && typeof fn === "object" && !fn.name
        return name && !unnamedFunction ? name : t("entityUi.configItems.newTool")
    },
    // Function, workflow-reference, and gateway ACTION tools (either encoding) have a
    // structured Form. Bare builtin/provider tools (a naked `type`) stay JSON-only, and so
    // does an integration entry: it is edited in the permission drawer, so a reader who does
    // reach it here (a diff row, a raw inspection) gets the JSON rather than an empty form.
    jsonOnly: (draft) => {
        const entry = parseGatewayEntry(draft)
        if (entry?.kind === "connection") return true
        return !(isFunctionTool(draft) || isReferenceTool(draft) || entry)
    },
    // A subagent's detail states its own identity and hides the raw entry.
    statesOwnIdentity: (draft) => isReferenceTool(draft),
    isReadOnly: () => false,
    // Unused for tools: creation seeds from the picker (buildInlineFunctionTool), not this.
    createSeed: () => ({}),
    draftInvalid: (draft) => {
        const fn = draft.function as Record<string, unknown> | undefined
        if (fn && typeof fn === "object") return !String(fn.name ?? "").trim()
        return false
    },
}

/**
 * The address of an integration in the agent's `tools` list: the key the change-set engine gives
 * a `gateway_connection` entry (`gateway_connection:{provider}:{integration}`). It names the
 * integration, not a position, so it stays right when the list changes under an open view.
 */
export const integrationItemRef = (target: GatewayConnectionTarget): ConfigItemRef => ({
    list: "tools",
    key: `gateway_connection:${target.provider}:${target.integration}`,
})

/** The integration an item key names, or null when the key is not an integration's. */
export const integrationTargetOf = (ref: ConfigItemRef): GatewayConnectionTarget | null => {
    const match = /^gateway_connection:([^:]+):(.+)$/.exec(ref.key)
    return ref.list === "tools" && match ? {provider: match[1], integration: match[2]} : null
}

/** The tools without the integration `ref` names, found by key in the list as it is now. */
export const removeIntegrationByRef = (tools: unknown[], ref: ConfigItemRef): unknown[] => {
    const target = integrationTargetOf(ref)
    const row = target ? findIntegrationRow(buildIntegrationRows(tools), target) : undefined
    return row ? removeIntegrationRow(tools, row) : tools
}
