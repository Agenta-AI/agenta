/**
 * The agent's MCP servers section body: the saved rows. A row opens the server's view; a row that
 * no longer resolves opens the item form, which explains and repairs it. The row bin asks first
 * (F06 f2).
 *
 * It is a component rather than part of the panel so that the project's connection registry is
 * only fetched where a section renders one.
 */
import {useCallback, useMemo, useState} from "react"

import {
    findCustomMcpEndpoint,
    mcpEndpointsQueryAtom,
    readMcpConnectionSlug,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {requirementForItem, type AgentRequirementItem} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import type {ConfigItemRef} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {ConfigItemList} from "./ConfigItemList"
import {type ItemRowStatus} from "./ItemRow"
import {mcpItemNeedsRepair, mcpItemRef} from "./mcpRail"
import {needsSetupStatus} from "./needsSetup"
import {RemoveFromAgentDialog} from "./RemoveFromAgentDialog"
import {useAgentRequirements} from "./useAgentRequirements"

export interface McpServersSectionBodyProps {
    /** The agent's saved `mcps` array. */
    items: unknown[]
    disabled?: boolean
    /** Opens the structured form, for a row the server view cannot serve. */
    openForm: (index: number, item: unknown) => void
    /** Opens the server's view, by the item's key. */
    openServer: (item: ConfigItemRef) => void
    /** Removes the server from the agent, after the row bin's question. */
    removeServer: (item: ConfigItemRef) => void
    /** The panel's draft and validation markers. Health is layered on top of them here. */
    statusFor: (item: unknown, index: number) => ItemRowStatus | undefined
}

export function McpServersSectionBody({
    items,
    disabled,
    openForm,
    openServer,
    removeServer,
    statusFor,
}: McpServersSectionBodyProps) {
    const t = useT(integrationViewsCatalog)
    const [removing, setRemoving] = useState<{item: ConfigItemRef; name: string} | null>(null)
    const endpointsQuery = useAtomValue(mcpEndpointsQueryAtom)

    // `custom` only, which is the namespace an agent's connection reference names. A builtin
    // or provider row is not something an agent adds by slug.
    const endpoints = useMemo(
        () =>
            (endpointsQuery.data ?? []).filter(
                (endpoint) => (endpoint.namespace ?? "custom") === "custom",
            ),
        [endpointsQuery.data],
    )

    /** The registered connection one saved item points at, or undefined when it is gone. */
    const endpointForItem = useCallback(
        (item: unknown): MCPEndpoint | undefined => {
            // The slug the item points at, never one re-derived from its name: deriving one is
            // how a renamed item silently repointed at a different connection.
            const slug = readMcpConnectionSlug((item ?? {}) as Record<string, unknown>)
            return slug ? findCustomMcpEndpoint(endpoints, slug) : undefined
        },
        [endpoints],
    )
    // The server's needs-setup check: a missing or turned-off server, or an expired sign-in.
    const requirements = useAgentRequirements()
    const requirementFor = useCallback(
        (item: unknown): AgentRequirementItem | undefined => {
            if (!requirements) return undefined
            const slug = readMcpConnectionSlug((item ?? {}) as Record<string, unknown>)
            return requirementForItem(requirements, {kinds: ["mcp_server", "mcp_sign_in"], slug})
        },
        [requirements],
    )

    const statusForRow = useCallback(
        (item: unknown, index: number): ItemRowStatus | undefined => {
            const base = statusFor(item, index)
            // A blocking problem outranks a draft marker and structural invalid stays first,
            // the same order the tool rows use.
            if (base?.tone === "invalid") return base
            const req = requirementFor(item)
            return req ? needsSetupStatus(req) : base
        },
        [statusFor, requirementFor],
    )
    /** Where a row goes when it is clicked; see {@link mcpItemNeedsRepair}. */
    const openRow = useCallback(
        (_kind: "mcp" | "tool" | "skill", index: number, item: unknown) => {
            const record = (item ?? {}) as Record<string, unknown>
            const endpoint = endpointForItem(item)
            const req = requirementFor(item)
            const ref = mcpItemRef(item)
            // An expired sign-in opens the server view, whose title offers "Reconnect".
            if (ref && req?.kind === "mcp_sign_in" && endpoint) {
                openServer(ref)
                return
            }
            // A missing or turned-off server opens the form, where another one is picked or connected.
            if (!ref || req || mcpItemNeedsRepair(record, endpoint)) {
                openForm(index, item)
                return
            }
            openServer(ref)
        },
        [endpointForItem, openForm, openServer, requirementFor],
    )

    return (
        <>
            <ConfigItemList
                kind="mcp"
                items={items}
                openEdit={openRow}
                removeItem={(_kind, index) => {
                    const item = items[index]
                    const ref = mcpItemRef(item)
                    if (!ref) return
                    const endpoint = endpointForItem(item)
                    setRemoving({item: ref, name: endpoint?.name || ref.key})
                }}
                closeEditor={noop}
                disabled={disabled}
                statusFor={statusForRow}
            />
            {removing ? (
                <RemoveFromAgentDialog
                    open
                    name={removing.name}
                    description={t("entityUi.integrationViews.connectionStays")}
                    onRemove={() => {
                        removeServer(removing.item)
                        setRemoving(null)
                    }}
                    onClose={() => setRemoving(null)}
                />
            ) : null}
        </>
    )
}

const noop = () => undefined
