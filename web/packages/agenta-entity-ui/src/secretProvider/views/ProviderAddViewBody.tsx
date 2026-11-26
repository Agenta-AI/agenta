/**
 * "Add a provider or subscription" (F09 f1b): "Use a subscription" with ChatGPT and Claude, then
 * "Use an API key" with a search and the production catalog in production order. A picked
 * provider's form or sign-in takes this view's place, so its Save goes back to the list.
 */
import {useMemo, useState} from "react"

import {
    PROVIDER_CATALOG,
    subscriptionProviderFamily,
    subscriptionProviderName,
} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import providerDrawerCatalog from "@agenta/i18n/catalogs/entityUi.providerDrawer"
import providerListCatalog from "@agenta/i18n/catalogs/entityUi.providerList"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {SearchInput} from "@agenta/ui/ui"
import {useViewTitle, type ViewProps} from "@agenta/ui/view-stack"
import {CaretRight} from "@phosphor-icons/react"

import {ProviderLogo} from "./ProviderListBody"
import {providerConnectionView, type ProviderAddViewParams} from "./providerViews"
import {subscriptionViewFor} from "./subscriptionViews"

const SUBSCRIPTIONS = ["chatgpt", "claude"]

/** One list row with its divider inside the height: row-single 36, row-double 48 with a hint. */
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
            className={`box-border flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-border-muted bg-transparent px-4 text-left font-[inherit] hover:bg-accent ${hint ? "h-row-double" : "h-row-single"}`}
        >
            <ProviderLogo kind={kind} />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-label leading-5 text-foreground">{name}</span>
                {hint ? (
                    <span className="truncate text-caption text-muted-foreground">{hint}</span>
                ) : null}
            </span>
            <CaretRight size={14} aria-hidden className="shrink-0 text-muted-foreground" />
        </button>
    </li>
)

/** A group heading, as the list view draws it. */
const GroupLabel = ({children}: {children: string}) => (
    <div className="px-4 pb-1 pt-3.5 text-meta font-medium leading-5 text-muted-foreground">
        {children}
    </div>
)

const ProviderAddViewBody = ({target, nav}: ViewProps<ProviderAddViewParams>) => {
    const t = useT(providerListCatalog, providerDrawerCatalog, settingsProvidersCatalog)
    useViewTitle(t("entityUi.providerList.add"))
    const [search, setSearch] = useState("")

    const matches = useMemo(() => {
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
            <GroupLabel>{t("entityUi.providerList.useSubscription")}</GroupLabel>
            <ul className="m-0 list-none p-0">
                {SUBSCRIPTIONS.map((provider) => (
                    <PickRow
                        key={provider}
                        kind={subscriptionProviderFamily(provider)}
                        name={subscriptionProviderName(provider)}
                        onPick={() =>
                            void nav.replace(
                                subscriptionViewFor(provider),
                                {provider, start: true},
                                target,
                            )
                        }
                    />
                ))}
            </ul>
            <GroupLabel>{t("entityUi.providerList.useApiKey")}</GroupLabel>
            <div className="px-4 pb-2 pt-1">
                <SearchInput
                    placeholder={t("entityUi.providerDrawer.searchProviders")}
                    value={search}
                    allowClear
                    onValueChange={setSearch}
                />
            </div>
            {matches.length ? (
                <ul className="m-0 list-none p-0">
                    {matches.map((entry) => (
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
                <p className="m-0 px-4 py-3 text-body text-muted-foreground">
                    {t("entityUi.providerDrawer.noProviderMatches")}
                </p>
            )}
        </div>
    )
}

export default ProviderAddViewBody
