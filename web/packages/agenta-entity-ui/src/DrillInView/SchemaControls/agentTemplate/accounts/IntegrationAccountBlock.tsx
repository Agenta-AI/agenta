/**
 * The "Account" block of a Composio item's permission drawer (contract section 12, spec 5.1).
 *
 * The select writes the item's account source: each person's default account (`"user"`, no slug)
 * or one of the project's connections (its slug). With "each person", one line says which of the
 * viewer's own accounts the agent uses when they run it, and "Change" lets them pick another one
 * for this agent, make it their default, or connect another account. The line shows only the
 * viewer's own account.
 */
import {useMemo, useState} from "react"

import {userItemKey} from "@agenta/entities/accountChoice"
import {
    invalidateToolConnections,
    isConnectionDefault,
    makeDefaultToolConnection,
    usePersonalToolConnections,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {message} from "@agenta/ui/app-message"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AccountLine, AccountLineAction} from "../../../../accounts/AccountLine"
import {ACCOUNT_COPY} from "../../../../accounts/copy"
import {personalConnectionsFor} from "../../../../accounts/personalAccounts"
import {useAccountChoice} from "../../../../accounts/useAccountChoice"
import {useItemAccount, type ItemAccountContext} from "../../../../accounts/useItemAccount"
import ConnectDrawer from "../../../../gatewayTool/drawers/ConnectDrawer"
import type {
    GatewayConnectionAccount,
    GatewayConnectionTarget,
    ParsedGatewayConnection,
} from "../../toolUtils"

import {AccountBlock} from "./AccountBlock"
import {
    integrationAccountFromValue,
    integrationAccountOptions,
    integrationAccountValue,
} from "./accountOptions"

export interface IntegrationAccountBlockProps {
    target: GatewayConnectionTarget
    entry: ParsedGatewayConnection
    context: ItemAccountContext
    onChange: (account: GatewayConnectionAccount) => void
    disabled?: boolean
}

export function IntegrationAccountBlock({
    target,
    entry,
    context,
    onChange,
    disabled,
}: IntegrationAccountBlockProps) {
    const {integration} = useToolIntegrationDetail(target.integration)
    const name = integration?.name || target.integration
    const {connections} = useToolConnectionsQuery()
    const access = useAtomValue(personalAccountsAccessAtom)

    const projectConnections = useMemo(
        () =>
            connections.filter(
                (connection) =>
                    connection.provider_key === target.provider &&
                    connection.integration_key === target.integration,
            ),
        [connections, target.integration, target.provider],
    )
    const options = useMemo(
        () =>
            integrationAccountOptions({
                integrationName: name,
                projectConnections,
                entry,
                personalAccounts: access === "on",
            }),
        [access, entry, name, projectConnections],
    )

    return (
        <AccountBlock
            value={integrationAccountValue(entry)}
            options={options}
            onChange={(value) => onChange(integrationAccountFromValue(value))}
            disabled={disabled}
            line={
                entry.accountSource === "user" && access === "on" ? (
                    <YourAccountLine
                        target={target}
                        integrationName={name}
                        integrationLogo={integration?.logo ?? undefined}
                        authSchemes={integration?.auth_schemes ?? ["oauth"]}
                        context={context}
                    />
                ) : null
            }
        />
    )
}

/** "When you run it: …" for the viewer, with "Change". */
function YourAccountLine({
    target,
    integrationName,
    integrationLogo,
    authSchemes,
    context,
}: {
    target: GatewayConnectionTarget
    integrationName: string
    integrationLogo?: string
    authSchemes: string[]
    context: ItemAccountContext
}) {
    const itemKey = userItemKey("app_connection", target.integration)
    const {workflowId, account, loading, failed} = useItemAccount(context, itemKey)
    const {connections: personal} = usePersonalToolConnections()
    const {choose: storeChoice, busy: choosing} = useAccountChoice(workflowId, itemKey)
    const [connectOpen, setConnectOpen] = useState(false)
    const [defaulting, setDefaulting] = useState(false)
    const busy = choosing || defaulting

    const yours = useMemo<ToolConnection[]>(
        () => personalConnectionsFor(personal, target),
        [personal, target],
    )

    if (loading || failed) return null

    const usedId = account?.match ? account.gateway_connection_id : null
    const used = yours.find((connection) => connection.id === usedId)

    const choose = async (connection: ToolConnection) => {
        if (!connection.id || connection.id === usedId) return
        const stored = await storeChoice({gatewayConnectionId: connection.id})
        if (stored === false) message.error(ACCOUNT_COPY.choiceFailed)
    }

    const makeDefault = async () => {
        if (!usedId) return
        setDefaulting(true)
        try {
            await makeDefaultToolConnection(usedId)
            invalidateToolConnections()
        } catch {
            message.error(ACCOUNT_COPY.defaultFailed)
        } finally {
            setDefaulting(false)
        }
    }

    const connectDrawer = (
        <ConnectDrawer
            open={connectOpen}
            integrationKey={target.integration}
            integrationName={integrationName}
            integrationLogo={integrationLogo}
            authSchemes={authSchemes}
            owners={["user"]}
            onClose={() => setConnectOpen(false)}
            onSuccess={() => setConnectOpen(false)}
        />
    )

    if (yours.length === 0 && !account?.match) {
        return (
            <AccountLine text={ACCOUNT_COPY.noAccountYet(integrationName)}>
                <AccountLineAction onClick={() => setConnectOpen(true)}>
                    {ACCOUNT_COPY.connectOne}
                </AccountLineAction>
                {connectDrawer}
            </AccountLine>
        )
    }

    const accountName = account?.match ? (account.name ?? used?.name ?? "") : ""
    const text = account?.match
        ? ACCOUNT_COPY.whenYouRun(
              account.match === "default"
                  ? `${accountName} ${ACCOUNT_COPY.yourDefault}`
                  : accountName,
          )
        : ACCOUNT_COPY.noneChosen
    const usedIsDefault = account?.match === "default" || isConnectionDefault(used)

    return (
        <AccountLine text={text}>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <AccountLineAction disabled={busy}>
                        {account?.match ? ACCOUNT_COPY.change : ACCOUNT_COPY.choose}
                    </AccountLineAction>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[220px]">
                    {yours.map((connection) => (
                        <DropdownMenuItem
                            key={connection.id ?? connection.slug}
                            onSelect={() => void choose(connection)}
                        >
                            <span className="flex size-3.5 shrink-0 items-center">
                                {connection.id === usedId ? <Check size={14} /> : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                                {connection.name || connection.slug}
                            </span>
                            {isConnectionDefault(connection) ? (
                                <span className="shrink-0 text-xs text-[var(--ag-colorTextTertiary)]">
                                    {ACCOUNT_COPY.defaultMark}
                                </span>
                            ) : null}
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    {usedId && !usedIsDefault ? (
                        <DropdownMenuItem onSelect={() => void makeDefault()}>
                            {ACCOUNT_COPY.makeDefault}
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => setConnectOpen(true)}>
                        <Plus size={14} />
                        {ACCOUNT_COPY.connectAnother(integrationName)}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {connectDrawer}
        </AccountLine>
    )
}
