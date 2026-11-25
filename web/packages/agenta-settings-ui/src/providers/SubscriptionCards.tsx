import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {Button, cn} from "@agenta/ui/ui"
import {ArrowRight, Key, Trash} from "@phosphor-icons/react"

import {SettingsRowMenu} from "../shared/SettingsRowMenu"

export interface SubscriptionCard {
    key: string
    logo: ReactNode
    name: string
    /** Who is signed in, what went wrong, or how to start. */
    detail: string
    state: "connected" | "attention" | "available"
    actionLabel: string
    onAction: () => void
    /** Delete the stored subscription; absent when there is none or it may not be removed. */
    onRemove?: () => void
}

const Card = ({card}: {card: SubscriptionCard}) => {
    const t = useT(settingsProvidersCatalog, commonCatalog)
    const ready = card.state === "connected"
    const stateLabel =
        card.state === "available"
            ? null
            : ready
              ? t("common.connected")
              : t("settings.providers.needsSignIn")
    return (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted p-3">
            <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-foreground">
                    {card.logo}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-body font-medium text-foreground">
                            {card.name}
                        </span>
                        {stateLabel ? (
                            <span
                                role="img"
                                aria-label={stateLabel}
                                title={stateLabel}
                                className={cn(
                                    "size-1.5 shrink-0 rounded-round",
                                    ready ? "bg-success" : "bg-warning",
                                )}
                            />
                        ) : null}
                    </span>
                    <span className="truncate text-label text-muted-foreground" title={card.detail}>
                        {card.detail}
                    </span>
                </span>
                {card.onRemove ? (
                    <SettingsRowMenu
                        label={t("settings.providers.actionsFor", {name: card.name})}
                        items={[
                            {
                                key: "delete",
                                label: t("common.delete"),
                                icon: <Trash size={14} />,
                                danger: true,
                                onClick: card.onRemove,
                            },
                        ]}
                    />
                ) : null}
            </div>
            <Button variant={ready ? "outline" : "default"} onClick={card.onAction}>
                {card.actionLabel}
                {ready ? null : <ArrowRight size={14} />}
            </Button>
        </div>
    )
}

/** AI providers' lead: run agents on a ChatGPT or Claude plan, ahead of API keys. */
export const SubscriptionCards = ({cards}: {cards: SubscriptionCard[]}) => {
    const t = useT(settingsProvidersCatalog)
    return (
        <section className="grid grid-cols-1 gap-2 rounded-lg border border-solid border-border p-2 md:grid-cols-[minmax(0,1.1fr)_repeat(2,minmax(0,1fr))]">
            <div className="flex min-w-0 flex-col justify-center gap-2 p-2">
                <span className="flex items-center gap-1.5 text-label text-muted-foreground">
                    <Key size={14} aria-hidden />
                    {t("settings.providers.noApiKeyNeeded")}
                </span>
                <div className="flex flex-col gap-0.5">
                    <h2 className="m-0 text-title text-foreground">
                        {t("settings.providers.bringYourOwnPlan")}
                    </h2>
                    <p className="m-0 text-label text-muted-foreground">
                        {t("settings.providers.bannerBody")}
                    </p>
                </div>
            </div>
            {cards.map((card) => (
                <Card key={card.key} card={card} />
            ))}
        </section>
    )
}
