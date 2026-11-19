import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {Wrench} from "@phosphor-icons/react"

import {ToolFormView} from "../../ToolFormView"
import {parseGatewayEntry} from "../../toolUtils"
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
