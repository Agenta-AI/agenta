/** The "Account" part of an integration view (F10): whose account the agent uses. */
import {useMemo, type ReactNode} from "react"

import {USER_ACCOUNT_SOURCE, userItemKey} from "@agenta/entities/accountChoice"
import {
    usePersonalToolConnections,
    useToolConnectionsQuery,
    useToolIntegrationDetail,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import accountsCatalog from "@agenta/i18n/catalogs/entityUi.accounts"
import accountSwitchCatalog from "@agenta/i18n/catalogs/entityUi.accountSwitch"
import {Button} from "@agenta/ui/ui"
import {Plus, Warning} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AccountSwitch} from "../../../../accounts/AccountSwitch"
import {personalConnectionsFor} from "../../../../accounts/personalAccounts"
import {useAccountChoice} from "../../../../accounts/useAccountChoice"
import {
    useItemAccount,
    useItemWorkflowId,
    type ItemAccountContext,
} from "../../../../accounts/useItemAccount"
import type {
    GatewayConnectionAccount,
    GatewayConnectionTarget,
    ParsedGatewayConnection,
} from "../../toolUtils"

import {AccountSelect, CONNECT_ANOTHER} from "./AccountSelect"
import {
    accountSourcePick,
    defaultAccountOf,
    sharedAccountOptions,
    showAccountSwitch,
    USE_MY_DEFAULT,
    yourAccountValue,
} from "./integrationAccountSwitch"
import {useRunsWithoutPerson} from "./useRunsWithoutPerson"

export interface IntegrationAccountBlockProps {
    target: GatewayConnectionTarget
    entry: ParsedGatewayConnection
    context: ItemAccountContext
    onChange: (account: GatewayConnectionAccount) => void
    /** Opens the connect view for this app: `"user"` for the viewer's own, `"project"` shared. */
    onConnect: (owner: "user" | "project") => void
    disabled?: boolean
}

export function IntegrationAccountBlock({
    target,
    entry,
    context,
    onChange,
    onConnect,
    disabled,
}: IntegrationAccountBlockProps) {
    const t = useT(accountSwitchCatalog, accountsCatalog)
    const {integration} = useToolIntegrationDetail(target.integration)
    const name = integration?.name || target.integration
    const {connections} = useToolConnectionsQuery()
    const access = useAtomValue(personalAccountsAccessAtom)
    const eachPerson = entry.accountSource === USER_ACCOUNT_SOURCE

    const projectConnections = useMemo(
        () =>
            connections.filter(
                (connection) =>
                    connection.provider_key === target.provider &&
                    connection.integration_key === target.integration,
            ),
        [connections, target.integration, target.provider],
    )
    const shared = useMemo(
        () => sharedAccountOptions(projectConnections, entry),
        [projectConnections, entry],
    )

    const pickSource = (next: string) => {
        const pick = accountSourcePick(next, entry, shared)
        if ("write" in pick) onChange(pick.write)
        else onConnect(pick.connect)
    }

    return (
        <div className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-2">
                <FieldHeading
                    label={t("entityUi.accounts.label")}
                    note={t("entityUi.accountSwitch.chooseWhose", {name})}
                />
                {showAccountSwitch(access, entry) ? (
                    <AccountSwitch
                        value={eachPerson ? USER_ACCOUNT_SOURCE : "agent"}
                        choices={[
                            {
                                value: USER_ACCOUNT_SOURCE,
                                label: t("entityUi.accountSwitch.eachPersonsOwn"),
                                note: t("entityUi.accountSwitch.eachPersonsOwnNote", {name}),
                            },
                            {
                                value: "agent",
                                label: t("entityUi.accountSwitch.oneShared"),
                                note: t("entityUi.accountSwitch.oneSharedNote"),
                            },
                        ]}
                        onChange={pickSource}
                        aria-label={t("entityUi.accounts.label")}
                        disabled={disabled}
                    />
                ) : null}
                {eachPerson ? <NoPersonWarning context={context} /> : null}
            </div>

            {eachPerson ? (
                // Only the viewer's own accounts, which exist only while personal accounts are on.
                access === "on" ? (
                    <YourAccount
                        target={target}
                        name={name}
                        context={context}
                        // The viewer's own accounts, not the agent: no edit right needed.
                        onConnect={() => onConnect("user")}
                    />
                ) : null
            ) : (
                <div className="flex flex-col gap-2">
                    <FieldHeading
                        label={t("entityUi.accountSwitch.sharedAccount")}
                        note={t("entityUi.accountSwitch.sharedAccountNote")}
                    />
                    <AccountSelect
                        value={entry.connection}
                        placeholder={t("entityUi.accountSwitch.noSharedAccountYet")}
                        options={shared.map((option) => ({
                            value: option.slug,
                            label: option.name,
                        }))}
                        connectLabel={t("entityUi.accountSwitch.connectAnotherShared")}
                        onChange={(slug) =>
                            slug === CONNECT_ANOTHER
                                ? onConnect("project")
                                : onChange({accountSource: "agent", slug})
                        }
                        aria-label={t("entityUi.accountSwitch.sharedAccount")}
                        disabled={disabled}
                    />
                </div>
            )}
        </div>
    )
}

/** Shown when the agent has runs without a person: a channel, or an automation saved by an API key. */
function NoPersonWarning({context}: {context: ItemAccountContext}) {
    const t = useT(accountSwitchCatalog)
    if (!useRunsWithoutPerson(useItemWorkflowId(context))) return null
    return (
        <div className="flex items-start gap-2 rounded-lg border border-solid border-colorWarningBorder bg-colorWarningBg px-3 py-2 text-xs leading-4 text-colorText">
            <Warning size={14} className="mt-px shrink-0 text-colorWarning" />
            <span>{t("entityUi.accountSwitch.noPersonWarning")}</span>
        </div>
    )
}

function FieldHeading({label, note}: {label: string; note: string}) {
    return (
        <div className="flex flex-col gap-px">
            <span className="text-[13px] font-semibold text-colorText">{label}</span>
            <span className="text-xs text-colorTextSecondary">{note}</span>
        </div>
    )
}

/** "Your account": the viewer's own accounts of the app, or "No account yet" and a connect. */
function YourAccount({
    target,
    name,
    context,
    onConnect,
}: {
    target: GatewayConnectionTarget
    name: string
    context: ItemAccountContext
    onConnect: () => void
}) {
    const t = useT(accountSwitchCatalog, accountsCatalog)
    const itemKey = userItemKey("app_connection", target.integration)
    const {workflowId, account, loading, failed} = useItemAccount(context, itemKey)
    const {connections: personal} = usePersonalToolConnections()
    const choice = useAccountChoice(workflowId, itemKey)
    const yours = useMemo<ToolConnection[]>(
        () => personalConnectionsFor(personal, target),
        [personal, target],
    )

    let body: ReactNode
    if (yours.length === 0) {
        body = (
            <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-colorTextSecondary">
                    {t("entityUi.accountSwitch.noAccountYet")}
                </span>
                <Button variant="outline" size="sm" onClick={onConnect}>
                    <Plus size={14} />
                    {t("entityUi.accountSwitch.connectApp", {name})}
                </Button>
            </div>
        )
    } else {
        const fallback = defaultAccountOf(yours, account)
        const pick = async (value: string) => {
            if (value === CONNECT_ANOTHER) return onConnect()
            if (value === yourAccountValue(account)) return
            if (value === USE_MY_DEFAULT) await choice.clear()
            else await choice.choose({gatewayConnectionId: value})
        }
        body = (
            <AccountSelect
                // Unknown until the read answers: show no value rather than a guess.
                value={loading || failed ? "" : yourAccountValue(account)}
                options={[
                    {
                        value: USE_MY_DEFAULT,
                        label: t("entityUi.accountSwitch.useMyDefault"),
                        meta: fallback ? fallback.name || fallback.slug || "" : undefined,
                    },
                    ...yours
                        .filter((connection) => connection.id)
                        .map((connection) => ({
                            value: connection.id as string,
                            label: connection.name || connection.slug || "",
                        })),
                ]}
                connectLabel={t("entityUi.accounts.connectAnother", {name})}
                onChange={(value) => void pick(value)}
                aria-label={t("entityUi.accountSwitch.yourAccount")}
                disabled={choice.busy || loading || failed}
            />
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <FieldHeading
                label={t("entityUi.accountSwitch.yourAccount")}
                note={t("entityUi.accountSwitch.yourAccountNote", {name})}
            />
            {body}
            {choice.failed ? (
                <span className="text-xs text-colorError">
                    {t("entityUi.accounts.choiceFailed")}
                </span>
            ) : null}
        </div>
    )
}
