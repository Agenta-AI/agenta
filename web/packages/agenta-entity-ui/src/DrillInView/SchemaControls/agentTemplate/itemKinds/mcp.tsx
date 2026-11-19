import {readMcpConnectionSlug} from "@agenta/entities/mcpEndpoint"
import {createT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {HardDrives} from "@phosphor-icons/react"

import {McpServerFormView} from "../../McpServerFormView"
import {describeMcp} from "../itemDescriptors"

import type {ItemKindDef} from "./types"

const t = createT(configItemsCatalog)

export const mcpKind: ItemKindDef = {
    kind: "mcp",
    field: "mcps",
    icon: <HardDrives size={16} />,
    noun: "server",
    get emptyLabel() {
        return t("entityUi.configItems.noMcpServersYet")
    },
    describe: describeMcp,
    FormView: McpServerFormView,
    drawerTitle: (draft) =>
        String(draft.name ?? "").trim() || t("entityUi.configItems.newMcpServer"),
    jsonOnly: () => false,
    isReadOnly: () => false,
    // An empty reference, not an empty server: the form picks one, it does not author
    // one. The old http/url seed is still read on saved items but never written.
    createSeed: () => ({
        name: "",
        connection: {type: "gateway", namespace: "custom", slug: ""},
        policy: {tools: {mode: "all"}},
    }),
    draftInvalid: (draft) => {
        // Valid means it points at a connection and carries a usable tool prefix. The
        // URL and the credential are the connection's business now, not the item's.
        const name = String(draft.name ?? "").trim()
        const validName = /^[A-Za-z0-9._-]{1,128}$/.test(name)
        return !validName || !readMcpConnectionSlug(draft)
    },
}
