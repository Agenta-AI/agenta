/**
 * "Connect your accounts": the setup card, reused above the composer of a chat with an agent that
 * has "user" items (approved board `chat-connect-card`, spec 5.5).
 *
 * It lists only the viewer's own missing items, from the Needs setup answer the chat already
 * reads. Each row fixes one item in place: pick one of your accounts or connect another (a
 * Composio tool), sign in (an MCP server), or choose one of your secrets (a sandbox secret). A
 * fixed row turns done when the next Needs setup answer no longer lists it. The card never blocks
 * sending: "Continue" and the ✕ only put it away.
 */
import {useMemo, useState} from "react"

import {
    isConnectionDefault,
    usePersonalToolConnections,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {
    findCustomMcpEndpoint,
    mcpEndpointsQueryAtom,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {personalNamedSecretsAtom} from "@agenta/entities/secret"
import {Button} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {McpSignIn} from "../accounts/McpSignIn"
import {personalConnectionsFor, personalTextSecrets} from "../accounts/personalAccounts"
import {useAccountChoice} from "../accounts/useAccountChoice"
import ConnectDrawer from "../gatewayTool/drawers/ConnectDrawer"

import {PERSONAL_SETUP_COPY as copy} from "./copy"
import type {PersonalSetupItem} from "./personalSetup"
import {SetupCardFrame} from "./SetupCardFrame"
import {SetupChoiceCard, SetupChoiceStrip} from "./SetupChoiceCard"
import {SetupSection} from "./SetupSection"

export interface PersonalAccountsCardProps {
    /** The agent, for an account choice. */
    workflowId: string
    /** The rows, as first listed. A fixed row stays, marked done. */
    items: PersonalSetupItem[]
    /** The keys Needs setup still lists now. A row whose key is gone is done. */
    pendingKeys: ReadonlySet<string>
    onContinue?: () => void
    onDismiss?: () => void
    /** `bare` drops the frame's header and footer, for a host with its own (the notice). */
    bare?: boolean
    className?: string
}

export const PersonalAccountsCard = ({
    workflowId,
    items,
    pendingKeys,
    onContinue,
    onDismiss,
    bare = false,
    className,
}: PersonalAccountsCardProps) => {
    // One section open at a time, the first pending one to start with; only taps move it after.
    const [openKey, setOpenKey] = useState<string | null>(
        () => items.find((item) => pendingKeys.has(item.key))?.key ?? null,
    )
    const accordion = items.length > 1
    const rows = (
        <div className="flex flex-col px-4 py-1">
            {items.map((item) => {
                const props = {
                    item,
                    workflowId,
                    done: !pendingKeys.has(item.key),
                    open: accordion ? openKey === item.key : true,
                    onToggle: accordion
                        ? () => setOpenKey((key) => (key === item.key ? null : item.key))
                        : undefined,
                }
                if (item.kind === "app_connection") return <AppRow key={item.key} {...props} />
                if (item.kind === "mcp_server") return <McpRow key={item.key} {...props} />
                return <SecretRow key={item.key} {...props} />
            })}
        </div>
    )
    if (bare) return <div className={className}>{rows}</div>
    return (
        <SetupCardFrame
            title={copy.title}
            badge={{text: copy.badge, tone: "neutral"}}
            onDismiss={onDismiss}
            dismissLabel={copy.dismiss}
            footnote={copy.footnote}
            action={onContinue ? <Button onClick={onContinue}>{copy.continue}</Button> : null}
            className={className}
        >
            {rows}
        </SetupCardFrame>
    )
}

interface RowProps {
    item: PersonalSetupItem
    workflowId: string
    done: boolean
    open: boolean
    onToggle?: () => void
}

const Failure = ({show}: {show: boolean}) =>
    show ? <span className="text-xs text-[var(--ag-colorError)]">{copy.failed}</span> : null

function AppRow({item, workflowId, done, open, onToggle}: RowProps) {
    const {integration} = useToolIntegrationDetail(item.name)
    const name = integration?.name || item.name
    const logo = integration?.logo ?? null
    const {connections} = usePersonalToolConnections()
    const yours = useMemo(
        () =>
            personalConnectionsFor(connections, {integration: item.name, provider: item.provider}),
        [connections, item.name, item.provider],
    )
    const {choose, busy, failed} = useAccountChoice(workflowId, item.key)
    const [connectOpen, setConnectOpen] = useState(false)

    return (
        <SetupSection
            icon={done ? "done" : "idle"}
            title={name}
            state={done ? copy.connected : undefined}
            stateTone="success"
            open={open && !done}
            onToggle={done ? undefined : onToggle}
            after={
                <ConnectDrawer
                    open={connectOpen}
                    integrationKey={item.name}
                    integrationName={name}
                    integrationLogo={logo ?? undefined}
                    authSchemes={integration?.auth_schemes ?? ["oauth"]}
                    owners={["user"]}
                    onClose={() => setConnectOpen(false)}
                    onSuccess={() => setConnectOpen(false)}
                />
            }
        >
            <p className="m-0 text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                {yours.length > 0 ? copy.chooseAccount(name) : copy.connectAccount(name)}
            </p>
            {yours.length > 0 ? (
                <SetupChoiceStrip>
                    {yours.map((connection) => (
                        <SetupChoiceCard
                            key={connection.id ?? connection.slug}
                            logo={logo}
                            label={`${connection.name || connection.slug}${
                                isConnectionDefault(connection) ? ` · ${copy.defaultMark}` : ""
                            }`}
                            disabled={busy}
                            onClick={() => {
                                if (connection.id) void choose({gatewayConnectionId: connection.id})
                            }}
                        />
                    ))}
                    <SetupChoiceCard
                        label={copy.connectAnother}
                        onClick={() => setConnectOpen(true)}
                    />
                </SetupChoiceStrip>
            ) : (
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
                        {copy.connect}
                    </Button>
                </div>
            )}
            <Failure show={failed} />
        </SetupSection>
    )
}

function McpRow({item, done, open, onToggle}: RowProps) {
    const endpoints = useAtomValue(mcpEndpointsQueryAtom)
    const endpoint = useMemo<MCPEndpoint | undefined>(
        () => findCustomMcpEndpoint(endpoints.data ?? [], item.name),
        [endpoints.data, item.name],
    )
    const name = endpoint?.name || item.name

    return (
        <SetupSection
            icon={done ? "done" : "idle"}
            title={name}
            state={done ? copy.signedIn : undefined}
            stateTone="success"
            open={open && !done}
            onToggle={done ? undefined : onToggle}
        >
            <p className="m-0 text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                {copy.signIn(name)}
            </p>
            {endpoint ? (
                <McpSignIn
                    endpoint={endpoint}
                    tokenLabel={copy.signInAction}
                    submitLabel={copy.signInAction}
                >
                    {(start, pending) =>
                        start ? (
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={pending}
                                    onClick={start}
                                >
                                    {copy.signInAction}
                                </Button>
                            </div>
                        ) : null
                    }
                </McpSignIn>
            ) : null}
        </SetupSection>
    )
}

function SecretRow({item, workflowId, done, open, onToggle}: RowProps) {
    const secrets = useAtomValue(personalNamedSecretsAtom)
    const yours = useMemo(() => personalTextSecrets(secrets), [secrets])
    const {choose, busy, failed} = useAccountChoice(workflowId, item.key)

    return (
        <SetupSection
            icon={done ? "done" : "idle"}
            title={item.name}
            state={done ? copy.chosen : undefined}
            stateTone="success"
            open={open && !done}
            onToggle={done ? undefined : onToggle}
        >
            <p className="m-0 text-xs leading-snug text-[var(--ag-colorTextSecondary)]">
                {yours.length > 0 ? copy.chooseSecret(item.name) : copy.noSecretYet}
            </p>
            {yours.length > 0 ? (
                <SetupChoiceStrip>
                    {yours.map((secret) => (
                        <SetupChoiceCard
                            key={secret.id}
                            label={secret.name ?? ""}
                            disabled={busy}
                            onClick={() => void choose({secretId: secret.id as string})}
                        />
                    ))}
                </SetupChoiceStrip>
            ) : null}
            <Failure show={failed} />
        </SetupSection>
    )
}
