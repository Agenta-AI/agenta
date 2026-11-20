/**
 * "Add a provider or subscription" (F09 f1b): "Use a subscription" with ChatGPT and Claude, then
 * "Use an API key" with a search and the production catalog in production order. A picked
 * provider's form takes this view's place, so its Save goes back to the list.
 */
import {useMemo, useState} from "react"

import {
    PROVIDER_CATALOG,
    providerConnectionsAtom,
    subscriptionConnectionFor,
    subscriptionProviderName,
} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import providerDrawerCatalog from "@agenta/i18n/catalogs/entityUi.providerDrawer"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {SearchInput} from "@agenta/ui/ui"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import SubscriptionSignInDialog from "../SubscriptionSignInDialog"

import {ProviderTile} from "./ProviderListBody"
import {providerConnectionView, type ProviderAddParams} from "./providerViews"

const SUBSCRIPTIONS = [
    {provider: "chatgpt", logo: "openai"},
    {provider: "claude", logo: "anthropic"},
] as const

const PickRow = ({
    kind,
    name,
    hint,
    onPick,
}: {
    kind: string
    name: string
    hint?: string
    onPick: () => void
}) => (
    <li>
        <button
            type="button"
            onClick={onPick}
            className="flex min-h-11 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-2 text-left hover:bg-colorFillTertiary"
        >
            <ProviderTile kind={kind} />
            <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-colorText">{name}</span>
                {hint ? (
                    <span className="truncate text-xs text-colorTextTertiary">{hint}</span>
                ) : null}
            </span>
        </button>
    </li>
)

const ProviderAddViewBody = ({target, nav}: ViewProps<ProviderAddParams>) => {
    const t = useT(providerListCatalog, providerDrawerCatalog, settingsProvidersCatalog)
    useViewTitle(t("entityUi.providerList.add"))
    const connections = useAtomValue(providerConnectionsAtom)
    const [search, setSearch] = useState("")
    // The sign-in steps stay a dialog here; the subscriptions milestone makes them a view.
    const [signIn, setSignIn] = useState<{provider: string; open: boolean} | null>(null)

    const catalog = useMemo(() => {
        const term = search.trim().toLowerCase()
        return PROVIDER_CATALOG.map((entry) => ({
            kind: entry.kind,
            name: entry.kind === "custom" ? t("settings.providers.customEndpoint") : entry.title,
            hint: entry.kind === "custom" ? t("settings.providers.customEndpointHint") : undefined,
        })).filter(
            (entry) =>
                !term ||
                entry.name.toLowerCase().includes(term) ||
                entry.kind.toLowerCase().includes(term),
        )
    }, [search, t])

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
            <div className="px-4 pb-1 pt-4 text-xs font-medium text-colorTextSecondary">
                {t("entityUi.providerList.useSubscription")}
            </div>
            <ul className="m-0 list-none p-0">
                {SUBSCRIPTIONS.map(({provider, logo}) => (
                    <PickRow
                        key={provider}
                        kind={logo}
                        name={subscriptionProviderName(provider)}
                        onPick={() => setSignIn({provider, open: true})}
                    />
                ))}
            </ul>
            <div className="px-4 pb-1 pt-4 text-xs font-medium text-colorTextSecondary">
                {t("entityUi.providerList.useApiKey")}
            </div>
            <div className="px-4 pb-2">
                <SearchInput
                    placeholder={t("entityUi.providerDrawer.searchProviders")}
                    value={search}
                    allowClear
                    onValueChange={setSearch}
                />
            </div>
            {catalog.length ? (
                <ul className="m-0 list-none p-0">
                    {catalog.map((entry) => (
                        <PickRow
                            key={entry.kind}
                            kind={entry.kind}
                            name={entry.name}
                            hint={entry.hint}
                            onPick={() =>
                                void nav.replace(providerConnectionView, {kind: entry.kind}, target)
                            }
                        />
                    ))}
                </ul>
            ) : (
                <p className="m-0 px-4 py-3 text-sm text-colorTextSecondary">
                    {t("entityUi.providerDrawer.noProviderMatches")}
                </p>
            )}
            {signIn ? (
                <SubscriptionSignInDialog
                    key={signIn.provider}
                    open={signIn.open}
                    onClose={() => setSignIn({...signIn, open: false})}
                    provider={signIn.provider}
                    connection={subscriptionConnectionFor(connections, signIn.provider)}
                    logo={
                        <ProviderTile
                            kind={signIn.provider === "chatgpt" ? "openai" : "anthropic"}
                        />
                    }
                />
            ) : null}
        </div>
    )
}

export default ProviderAddViewBody
