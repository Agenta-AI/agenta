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

import {invalidatePersonalAccountReads, upsertAccountChoice} from "@agenta/entities/accountChoice"
import {
    isConnectionActive,
    isConnectionDefault,
    usePersonalToolConnections,
    useToolIntegrationDetail,
} from "@agenta/entities/gatewayTool"
import {
    findCustomMcpEndpoint,
    mcpEndpointsQueryAtom,
    usePersonalMcpSignIn,
    type MCPEndpoint,
} from "@agenta/entities/mcpEndpoint"
import {CustomSecretFormat, personalNamedSecretsAtom} from "@agenta/entities/secret"
import {projectIdAtom} from "@agenta/shared/state"
import {Button, Input} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

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
                if (item.kind === "mcp") return <McpRow key={item.key} {...props} />
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

/** Store the viewer's pick for this agent and item, then read Needs setup again. */
const useChoose = (workflowId: string, itemKey: string) => {
    const projectId = useAtomValue(projectIdAtom)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)
    const choose = async (account: {gatewayConnectionId: string} | {secretId: string}) => {
        if (!projectId || !workflowId || busy) return false
        setBusy(true)
        setFailed(false)
        try {
            await upsertAccountChoice({projectId, workflowId, itemKey, account})
            await invalidatePersonalAccountReads()
            return true
        } catch {
            setFailed(true)
            return false
        } finally {
            setBusy(false)
        }
    }
    return {choose, busy, failed}
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
            (connections ?? []).filter(
                (connection) =>
                    connection.integration_key === item.name && isConnectionActive(connection),
            ),
        [connections, item.name],
    )
    const {choose, busy, failed} = useChoose(workflowId, item.key)
    const [picked, setPicked] = useState<string | null>(null)
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
                            inUse={picked === connection.id}
                            disabled={busy}
                            onClick={() => {
                                if (!connection.id) return
                                setPicked(connection.id)
                                void choose({gatewayConnectionId: connection.id})
                            }}
                        />
                    ))}
                    <SetupChoiceCard
                        label={copy.connectAnother}
                        inUse={false}
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
    const {pendingId, error, signIn, signInWithToken} = usePersonalMcpSignIn()
    const [token, setToken] = useState<string | null>(null)
    const pending = Boolean(endpoint?.id) && pendingId === endpoint?.id

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
            {endpoint && token === null ? (
                <div className="flex items-center gap-1">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        // The OAuth popup opens inside this click; a token server asks for it here.
                        onClick={() =>
                            endpoint.auth_mode === "api_key" ? setToken("") : signIn(endpoint)
                        }
                    >
                        {copy.signInAction}
                    </Button>
                </div>
            ) : null}
            {endpoint && token !== null ? (
                <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void signInWithToken(endpoint, token.trim()).then((ok) => {
                            if (ok) setToken(null)
                        })
                    }}
                >
                    <Input
                        type="password"
                        autoComplete="off"
                        aria-label={copy.signInAction}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        className="ph-no-capture"
                    />
                    <Button type="submit" size="sm" disabled={pending || !token.trim()}>
                        {copy.signInAction}
                    </Button>
                </form>
            ) : null}
            {error ? <span className="text-xs text-[var(--ag-colorError)]">{error}</span> : null}
        </SetupSection>
    )
}

function SecretRow({item, workflowId, done, open, onToggle}: RowProps) {
    const secrets = useAtomValue(personalNamedSecretsAtom)
    const yours = useMemo(
        () => secrets.filter((secret) => secret.format === CustomSecretFormat.Text && secret.id),
        [secrets],
    )
    const {choose, busy, failed} = useChoose(workflowId, item.key)
    const [picked, setPicked] = useState<string | null>(null)

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
                            inUse={picked === secret.id}
                            disabled={busy}
                            onClick={() => {
                                setPicked(secret.id as string)
                                void choose({secretId: secret.id as string})
                            }}
                        />
                    ))}
                </SetupChoiceStrip>
            ) : null}
            <Failure show={failed} />
        </SetupSection>
    )
}
