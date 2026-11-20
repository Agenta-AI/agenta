/**
 * The Model providers list (F09 f1): only what the project has. The "Agenta" row with the
 * built-in models first, then "Subscriptions", then "API keys", each row with an outlined "Edit".
 * A row shows a state only when it needs attention. "Add a provider or subscription" is the one
 * primary action, fixed at the bottom.
 *
 * A body, not a view: the panel mounts it in `providerListView`, and Settings › AI providers
 * mounts it as the root of its container. The host decides how the rows open.
 */
import {createElement, useMemo, useState, type ReactNode} from "react"

import {
    buildModelProviderList,
    providerConnectionsAtom,
    subscriptionProviderFamily,
    vaultSecretsQueryAtom,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {builtinModelEndpointsQueryAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {Badge, Button, SkeletonRows} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {providerIconFor} from "../providerIcon"
import SubscriptionSignInDialog from "../SubscriptionSignInDialog"

export interface ProviderListBodyProps {
    onAdd: () => void
    /** "Edit" on an API key connection. */
    onOpenConnection: (connection: ProviderConnection) => void
    /** "Edit" on the "Agenta" row. */
    onOpenBuiltin: () => void
    /** Extra actions of a row (Settings puts Delete here). */
    rowMenu?: (connection: ProviderConnection) => ReactNode
}

/** A provider's logo in the 28 px tile the rows use. */
export const ProviderTile = ({kind}: {kind: string}) => (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-solid border-colorBorderSecondary bg-colorBgContainer">
        {createElement(providerIconFor(kind), {className: "size-4"})}
    </span>
)

const GroupLabel = ({children}: {children: ReactNode}) => (
    <div className="px-4 pb-1 pt-4 text-xs font-medium text-colorTextSecondary">{children}</div>
)

const Row = ({
    kind,
    name,
    tag,
    state,
    action,
    menu,
}: {
    kind: string
    name: string
    tag?: string
    state?: string
    action: {label: string; onClick: () => void}
    menu?: ReactNode
}) => (
    <li className="flex min-h-12 items-center gap-3 px-4 py-2">
        <ProviderTile kind={kind} />
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-sm text-colorText">{name}</span>
            {tag ? <Badge>{tag}</Badge> : null}
            {state ? <Badge variant="warning">{state}</Badge> : null}
        </span>
        <Button variant="outline" size="sm" className="shrink-0" onClick={action.onClick}>
            {action.label}
        </Button>
        {menu}
    </li>
)

interface SignInTarget {
    provider: string
    /** Read from the current list on each render, so a finished sign-in shows at once. */
    connectionId: string
}

export const ProviderListBody = ({
    onAdd,
    onOpenConnection,
    onOpenBuiltin,
    rowMenu,
}: ProviderListBodyProps) => {
    const t = useT(providerListCatalog, settingsProvidersCatalog, commonCatalog)
    const connections = useAtomValue(providerConnectionsAtom)
    const vault = useAtomValue(vaultSecretsQueryAtom)
    const builtinEndpoints = useAtomValue(builtinModelEndpointsQueryAtom).data
    const list = useMemo(
        () => buildModelProviderList({connections, builtinEndpoints}),
        [connections, builtinEndpoints],
    )
    // A subscription row opens its sign-in; the subscriptions milestone turns it into a view.
    const [signIn, setSignIn] = useState<(SignInTarget & {open: boolean}) | null>(null)

    const loading = vault.isPending
    const failed = vault.isError && !connections.length

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {loading ? (
                    <SkeletonRows count={4} className="px-4 pt-4" />
                ) : failed ? (
                    <div role="alert" className="flex flex-col items-start gap-2 px-4 pt-4">
                        <span className="text-sm text-colorText">
                            {t("entityUi.providerList.loadFailed")}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => void vault.refetch()}>
                            {t("common.tryAgain")}
                        </Button>
                    </div>
                ) : (
                    <>
                        {list.builtin ? (
                            <ul className="m-0 list-none p-0 pt-2">
                                <Row
                                    kind="agenta"
                                    name={t("entityUi.providerList.agenta")}
                                    tag={t("entityUi.providerList.builtIn")}
                                    action={{label: t("common.edit"), onClick: onOpenBuiltin}}
                                />
                            </ul>
                        ) : null}
                        {list.subscriptions.length ? (
                            <>
                                <GroupLabel>{t("entityUi.providerList.subscriptions")}</GroupLabel>
                                <ul className="m-0 list-none p-0">
                                    {list.subscriptions.map(({connection, signInNeeded}) => {
                                        const provider = connection.subscription?.provider ?? ""
                                        return (
                                            <Row
                                                key={connection.id}
                                                kind={connection.kind}
                                                name={connection.name}
                                                state={
                                                    signInNeeded
                                                        ? t("entityUi.providerList.signInNeeded")
                                                        : undefined
                                                }
                                                action={{
                                                    label: signInNeeded
                                                        ? t("settings.providers.signInAgain")
                                                        : t("common.edit"),
                                                    onClick: () =>
                                                        setSignIn({
                                                            provider,
                                                            connectionId: connection.id,
                                                            open: true,
                                                        }),
                                                }}
                                                menu={rowMenu?.(connection)}
                                            />
                                        )
                                    })}
                                </ul>
                            </>
                        ) : null}
                        {list.apiKeys.length ? (
                            <>
                                <GroupLabel>{t("entityUi.providerList.apiKeys")}</GroupLabel>
                                <ul className="m-0 list-none p-0">
                                    {list.apiKeys.map((connection) => (
                                        <Row
                                            key={connection.id}
                                            kind={connection.kind}
                                            name={connection.name}
                                            action={{
                                                label: t("common.edit"),
                                                onClick: () => onOpenConnection(connection),
                                            }}
                                            menu={rowMenu?.(connection)}
                                        />
                                    ))}
                                </ul>
                            </>
                        ) : null}
                    </>
                )}
            </div>
            <div className="shrink-0 px-4 py-3">
                <Button className="w-full" onClick={onAdd}>
                    <Plus size={14} />
                    {t("entityUi.providerList.addProviderOrSubscription")}
                </Button>
            </div>
            {signIn ? (
                <SubscriptionSignInDialog
                    key={signIn.connectionId}
                    open={signIn.open}
                    onClose={() => setSignIn({...signIn, open: false})}
                    provider={signIn.provider}
                    connection={
                        connections.find((connection) => connection.id === signIn.connectionId) ??
                        null
                    }
                    logo={<ProviderTile kind={subscriptionProviderFamily(signIn.provider)} />}
                />
            ) : null}
        </div>
    )
}
