/**
 * One connected MCP server: what it is, what it exposes, and how to change or end it.
 *
 * Tools are shown read-only here on purpose. A permission is a property of an agent's
 * configuration, not of the connection — two agents can share one server and be allowed
 * different things — so this says what exists and sends the person to the agent to decide
 * what it may do.
 *
 * Renaming changes the label and nothing else. The slug agents resolve is frozen, so a
 * rename never repoints a configured agent, and it never resets a policy.
 *
 * Changing the authentication goes through the reconnect sheet, which holds the selector and
 * the credential fields, and writes the mode onto this same row.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {
    connectionNameProblem,
    editMcpEndpoint,
    filterMcpTools,
    gatewayRefusalCode,
    getMcpConnectionStatus,
    getMcpConnectionStatusLabel,
    listMcpTools,
    type MCPEndpoint,
    type McpToolSummary,
} from "@agenta/entities/mcpEndpoint"
import {createT, useT} from "@agenta/i18n"
import mcpConnectCatalog from "@agenta/i18n/catalogs/entityUi.mcpConnect"
import mcpDetailCatalog from "@agenta/i18n/catalogs/entityUi.mcpDetail"
import {projectIdAtom} from "@agenta/shared/state"
import {EnhancedModal, ModalContent} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {Button, cn, Field, Input, touchTargetExpansion} from "@agenta/ui/ui"
import {ArrowClockwise, WarningCircle, Wrench} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {ToolsEmpty} from "../shared/ToolsEmpty"

import {MCP_AUTH_MODE_LABEL} from "./components"
import {ToolFilterInput} from "./ToolFilterInput"

export interface McpConnectionDetailProps {
    endpoint: MCPEndpoint | null
    onClose: () => void
    /** Other connections' display names, so a rename cannot collide. */
    existingNames?: (string | null | undefined)[]
    onReconnect: (endpoint: MCPEndpoint) => void
    onDisconnect: (endpoint: MCPEndpoint) => void
    onChanged?: () => void
    /** Hides Connect, Reconnect, Disconnect, Change and Save, and locks the name. */
    readOnly?: boolean
    /** Whether the member may read the tool list; when false the tools section is left out. */
    canListTools?: boolean
}

/** An OAuth connection whose sign-in could not be renewed, in place of the gateway's words. */
// Toasts fire from the rename handler, outside render.
const tNow = createT(mcpDetailCatalog)

type ToolsState =
    | {status: "idle"}
    | {status: "loading"}
    | {status: "ready"; tools: McpToolSummary[]}
    /** `error` is the server's own message, or null; `signInLost` picks the sign-in sentence. */
    | {status: "failed"; error: string | null; signInLost: boolean}

export default function McpConnectionDetail({
    endpoint,
    onClose,
    existingNames = [],
    onReconnect,
    onDisconnect,
    onChanged,
    readOnly = false,
    canListTools = true,
}: McpConnectionDetailProps) {
    const t = useT(mcpDetailCatalog, mcpConnectCatalog)
    const projectId = useAtomValue(projectIdAtom) ?? undefined
    const [name, setName] = useState("")
    const [saving, setSaving] = useState(false)
    const [tools, setTools] = useState<ToolsState>({status: "idle"})
    const [filter, setFilter] = useState("")

    // The status the connection's row in the list reads, so one state has one label.
    const status = endpoint ? getMcpConnectionStatus(endpoint) : null
    const isReady = status === "connected"
    const signInExpired =
        endpoint?.auth_mode === "oauth" &&
        !!endpoint.secret_id &&
        endpoint.flags?.is_valid === false

    useEffect(() => {
        setName(endpoint?.name || endpoint?.slug || "")
        // And the filter, which belongs to the list it was typed over. Below eight tools the
        // box is not rendered, so a filter carried into a short connection hides tools with
        // nothing on screen to clear it.
        setFilter("")
    }, [endpoint])

    // Which connection the visible list belongs to. A tool list is fetched per connection and
    // arrives whenever it arrives, so without this, opening another connection while one is
    // in flight rendered the previous one's tools under the new one's name (M4).
    const shownFor = useRef<string | undefined>(undefined)

    const loadTools = useCallback(async () => {
        const slug = endpoint?.slug
        if (!slug || !isReady || !canListTools) return
        shownFor.current = slug
        setTools({status: "loading"})
        try {
            const tools = await listMcpTools(slug, projectId)
            if (shownFor.current !== slug) return
            setTools({status: "ready", tools})
        } catch (error) {
            if (shownFor.current !== slug) return
            // The relay marked the connection, and the refreshed endpoint says so. Until it
            // arrives, the gateway's words are not the person's sentence.
            const signInLost = gatewayRefusalCode(error) === "auth_required"
            if (signInLost) onChanged?.()
            setTools({
                status: "failed",
                error: (error as Error)?.message || null,
                signInLost,
            })
        }
    }, [canListTools, endpoint?.slug, isReady, onChanged, projectId])

    // Only a connected server has tools to report; an unauthorized one would just 409.
    useEffect(() => {
        if (endpoint && isReady && canListTools) void loadTools()
        else setTools({status: "idle"})
    }, [canListTools, endpoint, isReady, loadTools])

    const nameProblem = endpoint
        ? connectionNameProblem({name, existingNames, currentName: endpoint.name})
        : null

    const rename = useCallback(async () => {
        // Enter while a save is in flight would send the same rename twice.
        if (readOnly || !endpoint?.id || nameProblem || saving) return
        setSaving(true)
        try {
            // A full replace: every field the row already has is sent back with it, because
            // the edit route writes what it is given rather than merging.
            await editMcpEndpoint(
                {
                    id: endpoint.id,
                    name: name.trim(),
                    description: endpoint.description,
                    auth_mode: endpoint.auth_mode,
                    secret_id: endpoint.secret_id,
                    data: endpoint.data,
                    flags: endpoint.flags,
                },
                projectId,
            )
            message.success(tNow("entityUi.mcpDetail.connectionRenamed"))
            onChanged?.()
        } catch (error) {
            message.error((error as Error)?.message || tNow("entityUi.mcpDetail.couldNotRename"))
        } finally {
            setSaving(false)
        }
    }, [endpoint, name, nameProblem, onChanged, projectId, readOnly, saving])

    const unchanged = !endpoint || name.trim() === (endpoint.name ?? "")

    const footer = endpoint ? (
        <div className="flex w-full flex-wrap items-center gap-2">
            {readOnly ? null : (
                <Button variant="outline" onClick={() => onReconnect(endpoint)}>
                    {isReady ? t("entityUi.mcpDetail.reconnect") : t("entityUi.mcpDetail.connect")}
                </Button>
            )}
            {/* Only an OAuth connection holds a grant to revoke; the route refuses anything else. */}
            {!readOnly && isReady && endpoint.auth_mode === "oauth" ? (
                <Button
                    variant="ghost"
                    className="text-colorError"
                    onClick={() => onDisconnect(endpoint)}
                >
                    {t("entityUi.mcpDetail.disconnect")}
                </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" onClick={onClose}>
                    {t("entityUi.mcpDetail.close")}
                </Button>
                {readOnly ? null : (
                    <Button onClick={rename} disabled={saving || !!nameProblem || unchanged}>
                        {t("entityUi.mcpDetail.save")}
                    </Button>
                )}
            </div>
        </div>
    ) : null

    return (
        <EnhancedModal
            open={!!endpoint}
            onCancel={onClose}
            title={endpoint?.name || endpoint?.slug || t("entityUi.mcpDetail.connection")}
            footer={footer}
            width={520}
            destroyOnClose
        >
            <ModalContent>
                {endpoint ? (
                    <div className="flex flex-col gap-5" data-testid="mcp-connection-detail">
                        <div className="flex min-w-0 items-center gap-2">
                            <StatusIndicator
                                tone={isReady ? "success" : "warning"}
                                label={getMcpConnectionStatusLabel(status ?? "not_signed_in")}
                                className="shrink-0 text-[13px]"
                            />
                            <span aria-hidden className="text-colorTextDescription">
                                ·
                            </span>
                            <span
                                className="truncate text-xs text-colorTextDescription"
                                title={endpoint.data.route.base_url ?? undefined}
                            >
                                {endpoint.data.route.base_url}
                            </span>
                        </div>

                        <Field
                            label={t("entityUi.mcpDetail.name")}
                            error={nameProblem ?? undefined}
                            // Said out loud: renaming something an agent uses invites the opposite assumption.
                            description={t("entityUi.mcpDetail.renameNote")}
                        >
                            <Input
                                value={name}
                                aria-label={t("entityUi.mcpDetail.connectionName")}
                                readOnly={readOnly}
                                onChange={(event) => setName(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !readOnly && !unchanged && !saving)
                                        void rename()
                                }}
                            />
                        </Field>

                        <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-colorText">
                                {t("entityUi.mcpDetail.authentication")}
                            </span>
                            <span className="text-colorTextSecondary">
                                {t(MCP_AUTH_MODE_LABEL[endpoint.auth_mode])}
                            </span>
                            {readOnly ? null : (
                                <Button
                                    variant="link"
                                    size="xs"
                                    className={cn("ml-auto px-0 text-xs", touchTargetExpansion(24))}
                                    onClick={() => onReconnect(endpoint)}
                                >
                                    {t("entityUi.mcpDetail.change")}
                                </Button>
                            )}
                        </div>

                        {canListTools ? (
                            <section className="flex flex-col gap-2">
                                <div className="flex flex-col gap-0.5">
                                    <h4 className="m-0 text-sm font-medium text-colorText">
                                        {t("entityUi.mcpDetail.tools")}
                                    </h4>
                                    <p className="m-0 text-xs text-colorTextDescription">
                                        {t("entityUi.mcpDetail.toolsHint")}
                                    </p>
                                </div>
                                <ToolFilterInput
                                    total={tools.status === "ready" ? tools.tools.length : 0}
                                    value={filter}
                                    onChange={setFilter}
                                />
                                <ToolList
                                    state={tools}
                                    isReady={isReady}
                                    signInExpired={signInExpired}
                                    onRetry={loadTools}
                                    filter={filter}
                                />
                            </section>
                        ) : null}
                    </div>
                ) : null}
            </ModalContent>
        </EnhancedModal>
    )
}

const ToolList = ({
    state,
    isReady,
    signInExpired,
    onRetry,
    filter,
}: {
    state: ToolsState
    isReady: boolean
    signInExpired: boolean
    onRetry: () => void
    filter: string
}) => {
    const t = useT(mcpDetailCatalog)
    if (!isReady) {
        return (
            <p className="m-0 text-sm text-colorTextDescription">
                {signInExpired
                    ? t("entityUi.mcpDetail.signInAgain")
                    : t("entityUi.mcpDetail.connectToSeeTools")}
            </p>
        )
    }
    if (state.status === "loading") {
        return (
            <p className="m-0 text-sm text-colorTextDescription" role="status">
                {t("entityUi.mcpDetail.readingToolList")}
            </p>
        )
    }
    if (state.status === "failed") {
        // Connected as far as the endpoint knows, with a tool problem. A lost sign-in shows
        // here only until the refreshed endpoint says so.
        return (
            <ToolsEmpty
                icon={<WarningCircle size={18} />}
                title={t("entityUi.mcpDetail.couldNotReadTools")}
                description={
                    state.signInLost
                        ? t("entityUi.mcpDetail.signInAgain")
                        : (state.error ?? t("entityUi.mcpDetail.toolListUnreadable"))
                }
                action={
                    <Button variant="outline" onClick={onRetry}>
                        <ArrowClockwise size={14} />
                        {t("entityUi.mcpDetail.retryTools")}
                    </Button>
                }
            />
        )
    }
    if (state.status === "ready" && state.tools.length === 0) {
        // An empty list, not a transport failure.
        return (
            <ToolsEmpty
                icon={<Wrench size={18} />}
                title={t("entityUi.mcpDetail.noToolsYet")}
                description={t("entityUi.mcpDetail.noToolsYetBody")}
            />
        )
    }
    if (state.status !== "ready") return null

    const shown = filterMcpTools(state.tools, filter)
    if (shown.length === 0) {
        // The server has tools; this query does not name any of them. Said as such, so nobody
        // reads a filter's own emptiness as a server that stopped advertising.
        return (
            <p className="m-0 text-sm text-colorTextDescription">
                {t("entityUi.mcpDetail.noToolMatches")}
            </p>
        )
    }

    return (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {shown.map((tool) => (
                <li key={tool.name} data-testid="mcp-tool" className="flex flex-col gap-0.5">
                    <span className="text-sm text-colorText">{tool.name}</span>
                    {tool.description ? (
                        <span className="text-xs text-colorTextDescription">
                            {tool.description}
                        </span>
                    ) : null}
                </li>
            ))}
        </ul>
    )
}
