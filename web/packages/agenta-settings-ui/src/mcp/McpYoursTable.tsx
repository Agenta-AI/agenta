/**
 * MCPs → "Yours": the person's own sign-ins to the project's servers. One row per server that
 * asks for a sign-in; the project's own connection stays in the table below. A token server's
 * sign-in asks for the person's token in a small dialog.
 */
import {useCallback, useMemo, useState} from "react"

import {usePersonalMcpSignIn, type MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {type TranslationKey} from "@agenta/i18n"
import {t as translate, useT} from "@agenta/i18n/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button, cn, IconTile, touchTargetExpansion} from "@agenta/ui/ui"
import {Plugs, SignOut} from "@phosphor-icons/react"

import type {ConfirmDestructive} from "../confirm"
import {SettingsGroupHeading} from "../shared/SettingsGroupHeading"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"
import {YoursEmpty} from "../shared/YoursEmpty"

import {McpTokenSignInDialog} from "./McpTokenSignInDialog"

const COLUMNS: (ListTableColumn & {label: TranslationKey<"common" | "settings">})[] = [
    {key: "name", label: "common.name", width: "minmax(0,2fr)"},
    {key: "url", label: "settings.mcp.serverUrl", width: "minmax(0,2fr)"},
    {key: "status", label: "common.status", width: "minmax(0,1.2fr)"},
    {key: "actions", label: "common.actions", srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["name", "status", "actions"]

/** The servers a person can sign in to: every one that asks for a sign-in. */
export const personalSignInServers = (endpoints: MCPEndpoint[]): MCPEndpoint[] =>
    endpoints.filter((endpoint) => endpoint.auth_mode !== "none")

/** Whether the person's own sign-in to this server is ready. */
export const isSignedIn = (endpoint: MCPEndpoint): boolean =>
    endpoint.user_sign_in?.is_ready === true

export interface McpYoursTableProps {
    servers: MCPEndpoint[]
    collapsed: boolean
    onToggle: () => void
    confirm?: ConfirmDestructive
    /** How many projects the person has in the organization, for the empty note. */
    projectCount?: number
}

export const McpYoursTable = ({
    servers,
    collapsed,
    onToggle,
    confirm,
    projectCount,
}: McpYoursTableProps) => {
    const {pendingId, error, signIn, signInWithToken, signOut} = usePersonalMcpSignIn()
    const [tokenFor, setTokenFor] = useState<MCPEndpoint | null>(null)
    const t = useT()
    const translatedColumns = useMemo(
        () => COLUMNS.map((column) => ({...column, label: t(column.label)})),
        [t],
    )
    const {columns, shows} = usePhoneColumns(translatedColumns, PHONE_KEYS)
    const rowKey = useCallback((record: MCPEndpoint) => record.id ?? record.slug ?? "", [])

    // An OAuth sign-in opens its popup inside the click; a token server asks for the token.
    const startSignIn = useCallback(
        (endpoint: MCPEndpoint) => {
            if (endpoint.auth_mode === "api_key") setTokenFor(endpoint)
            else signIn(endpoint)
        },
        [signIn],
    )

    const confirmSignOut = useCallback(
        (endpoint: MCPEndpoint) => {
            const run = () => signOut(endpoint)
            if (!confirm) return void run()
            confirm({
                title: translate("settings.mcp.signOutOf", {
                    name: endpoint.name || endpoint.slug || translate("settings.mcp.thisServer"),
                }),
                message: translate("settings.mcp.signOutMessage"),
                okText: translate("common.signOut"),
                danger: true,
                onOk: run,
            })
        },
        [confirm, signOut],
    )

    const tokenError = useMemo(
        () => (tokenFor && pendingId === null ? error : null),
        [tokenFor, pendingId, error],
    )

    return (
        <section className="flex flex-col gap-3">
            <SettingsGroupHeading
                label={t("settings.mcp.yours")}
                count={servers.length}
                collapsed={collapsed}
                onToggle={onToggle}
            />
            {collapsed ? null : servers.length === 0 ? (
                <YoursEmpty projectCount={projectCount} />
            ) : (
                <>
                    {error && !tokenFor ? (
                        <p className="m-0 text-xs text-colorError">{error}</p>
                    ) : null}
                    <ListTable<MCPEndpoint>
                        columns={columns}
                        groups={[{key: "yours", label: null, rows: servers}]}
                        rowKey={rowKey}
                        minWidth={0}
                        renderRow={(record) => {
                            const signedIn = isSignedIn(record)
                            // One sign-in action at a time: the hook tracks one.
                            const pending = pendingId !== null
                            return (
                                <>
                                    <span className="flex min-w-0 items-center gap-2.5">
                                        <IconTile
                                            size={28}
                                            tone="muted"
                                            aria-hidden="true"
                                            className="border border-solid border-border bg-muted text-muted-foreground"
                                        >
                                            <Plugs />
                                        </IconTile>
                                        <span
                                            className="truncate font-medium text-foreground"
                                            title={record.name || record.slug || undefined}
                                        >
                                            {record.name || record.slug}
                                        </span>
                                    </span>
                                    {shows("url") ? (
                                        <span
                                            className="truncate font-mono text-[13px] text-muted-foreground"
                                            title={record.data.route.base_url ?? undefined}
                                        >
                                            {record.data.route.base_url}
                                        </span>
                                    ) : null}
                                    <span
                                        data-testid="mcp-personal-status"
                                        className="flex min-w-0 items-center gap-2"
                                    >
                                        <StatusIndicator
                                            tone={signedIn ? "success" : "default"}
                                            label={
                                                signedIn
                                                    ? t("settings.mcp.signedInAsYou")
                                                    : t("settings.mcp.notSignedIn")
                                            }
                                            className="min-w-0 text-[13px]"
                                        />
                                        {signedIn ? null : (
                                            <Button
                                                variant="link"
                                                size="xs"
                                                disabled={pending}
                                                className={cn(
                                                    "p-0 text-xs",
                                                    touchTargetExpansion(24),
                                                )}
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    startSignIn(record)
                                                }}
                                            >
                                                {t("common.signIn")}
                                            </Button>
                                        )}
                                    </span>
                                    <SettingsRowMenu
                                        label={t("settings.mcp.signInActions")}
                                        items={[
                                            {
                                                key: "sign-out",
                                                label: t("common.signOut"),
                                                icon: <SignOut size={14} />,
                                                danger: true,
                                                // Only a sign-in the person has can be removed.
                                                hidden: !record.user_sign_in,
                                                disabled: pending,
                                                onClick: () => confirmSignOut(record),
                                            },
                                        ]}
                                    />
                                </>
                            )
                        }}
                    />
                </>
            )}
            <McpTokenSignInDialog
                open={Boolean(tokenFor)}
                serverName={tokenFor?.name || tokenFor?.slug || t("settings.mcp.thisServer")}
                error={tokenError}
                onSubmit={(token) =>
                    tokenFor ? signInWithToken(tokenFor, token) : Promise.resolve(false)
                }
                onClose={() => setTokenFor(null)}
            />
        </section>
    )
}
