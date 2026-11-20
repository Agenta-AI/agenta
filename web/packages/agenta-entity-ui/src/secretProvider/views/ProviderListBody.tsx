/**
 * The Model providers list (F09 f1): only what the project has. The "Agenta" row with the
 * built-in models first, then "Subscriptions", then "API keys" (a phone, M12, lists "API keys"
 * first), each row with an outlined "Edit".
 * A row shows a state only when it needs attention. "Add a provider or subscription" is the one
 * primary action, fixed at the bottom.
 *
 * A body, not a view: the panel mounts it in `providerListView`, and Settings › AI providers
 * mounts it as the root of its container. The host decides how the rows open.
 */
import {createElement, useMemo, type ReactNode} from "react"

import {
    buildModelProviderList,
    providerConnectionsAtom,
    vaultSecretsQueryAtom,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {builtinModelEndpointsQueryAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {PhonePrimaryAction, useIsPhone} from "@agenta/ui/phone"
import {Button, PHONE_TOUCH_TARGET_CLASS, SkeletonRows} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {providerIconFor} from "../providerIcon"

export interface ProviderListBodyProps {
    onAdd: () => void
    /** "Edit" on an API key connection. */
    onOpenConnection: (connection: ProviderConnection) => void
    /** "Edit" or "Sign in again" on a subscription. */
    onOpenSubscription: (connection: ProviderConnection) => void
    /** "Edit" on the "Agenta" row. */
    onOpenBuiltin: () => void
    /** Extra actions of a row (Settings puts Delete here). */
    rowMenu?: (connection: ProviderConnection) => ReactNode
}

/** A provider's bare 20 px logo, as the rows draw it (F09, M12). */
export const ProviderLogo = ({kind}: {kind: string}) => (
    <span className="flex size-5 shrink-0 items-center justify-center text-colorText">
        {createElement(providerIconFor(kind), {className: "size-5"})}
    </span>
)

/** A 20 px tag beside a row's name: outlined ("Built-in") or amber ("Sign in needed"). */
const RowTag = ({children, warn = false}: {children: ReactNode; warn?: boolean}) => (
    <span
        className={
            warn
                ? "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded px-[7px] text-[12px] leading-4 bg-colorWarningBg text-colorWarningText"
                : "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded px-[7px] text-[12px] leading-4 bg-colorBgContainer text-colorTextSecondary ring-1 ring-inset ring-colorBorderSecondary"
        }
    >
        {children}
    </span>
)

const GroupLabel = ({children}: {children: ReactNode}) => (
    <div className="px-4 pb-1 pt-3.5 text-[12px] font-medium leading-5 text-colorTextTertiary max-md:pb-1.5 max-md:pt-4">
        {children}
    </div>
)

/**
 * One row. Desktop (F09): 13 px name, no divider, a 28 px "Edit". Phone (M12): a 56 px row with a
 * full-width divider, 15 px name, and a 36 px "Edit" with a 44 px tap area.
 */
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
    <li className="flex items-center gap-3 px-4 py-[9px] max-md:min-h-14 max-md:border-0 max-md:border-b max-md:border-solid max-md:border-colorBorderSecondary max-md:py-1.5 max-md:pr-2">
        <ProviderLogo kind={kind} />
        <span className="truncate text-[13px] leading-5 text-colorText max-md:text-[15px]">
            {name}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {tag ? <RowTag>{tag}</RowTag> : null}
            {state ? <RowTag warn>{state}</RowTag> : null}
        </span>
        <Button
            variant="outline"
            size="compact"
            className={`shrink-0 max-md:mr-2 max-md:h-9 max-md:rounded-[8px] max-md:text-sm ${PHONE_TOUCH_TARGET_CLASS}`}
            onClick={action.onClick}
        >
            {action.label}
        </Button>
        {menu ? (
            <span className="flex shrink-0 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11">
                {menu}
            </span>
        ) : null}
    </li>
)

export const ProviderListBody = ({
    onAdd,
    onOpenConnection,
    onOpenSubscription,
    onOpenBuiltin,
    rowMenu,
}: ProviderListBodyProps) => {
    const t = useT(providerListCatalog, settingsProvidersCatalog, commonCatalog)
    // The phone draws its own primary action at the bottom of the screen.
    const phone = useIsPhone()
    const connections = useAtomValue(providerConnectionsAtom)
    const vault = useAtomValue(vaultSecretsQueryAtom)
    const builtinEndpoints = useAtomValue(builtinModelEndpointsQueryAtom).data
    const list = useMemo(
        () => buildModelProviderList({connections, builtinEndpoints}),
        [connections, builtinEndpoints],
    )

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
                        <Button
                            variant="outline"
                            size="compact"
                            className={PHONE_TOUCH_TARGET_CLASS}
                            onClick={() => void vault.refetch()}
                        >
                            {t("common.tryAgain")}
                        </Button>
                    </div>
                ) : (
                    // The desktop (F09) lists Subscriptions before API keys; the phone (M12) lists
                    // API keys first.
                    <div className="flex flex-col">
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
                            <div className="max-md:order-2">
                                <GroupLabel>{t("entityUi.providerList.subscriptions")}</GroupLabel>
                                <ul className="m-0 list-none p-0">
                                    {list.subscriptions.map(({connection, signInNeeded}) => (
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
                                                onClick: () => onOpenSubscription(connection),
                                            }}
                                            menu={rowMenu?.(connection)}
                                        />
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        {list.apiKeys.length ? (
                            <div className="max-md:order-1">
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
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
            {phone ? (
                <PhonePrimaryAction icon={<Plus size={14} />} onClick={onAdd}>
                    {t("entityUi.providerList.addProviderOrSubscription")}
                </PhonePrimaryAction>
            ) : (
                <div className="shrink-0 border-0 border-t border-solid border-colorBorderSecondary p-3">
                    <Button className="h-8 w-full rounded-[6px] text-[13px]" onClick={onAdd}>
                        <Plus size={14} />
                        {t("entityUi.providerList.addProviderOrSubscription")}
                    </Button>
                </div>
            )}
        </div>
    )
}
