import {useMemo} from "react"

import {useTriggerCatalogIntegrations} from "@agenta/entities/gatewayTrigger"
import {Skeleton} from "@agenta/ui/ui"
import {Plug} from "lucide-react"

import {cn} from "../lib/utils"

import {AppIcon} from "./AppIcon"
import type {ConnectedApp} from "./connectedApps"

/**
 * The apps this workspace has already connected — icon and name, nothing else.
 *
 * Not the marketplace: an automation can only watch an app that is already connected, so a
 * catalog of the other ninety is a different question (answered by "Connect another app…").
 * Logos come from the shared integrations catalog, best-effort — `AppIcon` stands in for one
 * that has not landed yet rather than leaving the row half-drawn.
 */
export const EventAppRail = ({
    apps,
    selectedKey,
    isLoading,
    onSelect,
    onConnectAnother,
}: {
    apps: ConnectedApp[]
    selectedKey?: string
    isLoading: boolean
    onSelect: (app: ConnectedApp) => void
    /** Last row of the rail — connecting an app is how this list grows. */
    onConnectAnother?: () => void
}) => {
    const {integrations, isLoading: catalogLoading} = useTriggerCatalogIntegrations()
    // Name as well as logo: a connection is named for the account it authorises ("gmail-main"),
    // and this rail lists apps.
    const catalog = useMemo(() => {
        const map = new Map<string, {name?: string | null; logo?: string | null}>()
        integrations.forEach((integration) => {
            map.set(integration.key, {name: integration.name, logo: integration.logo})
        })
        return map
    }, [integrations])

    return (
        <div className="flex min-h-0 w-1/3 shrink-0 flex-col gap-px overflow-y-auto border-0 border-r border-solid border-border pr-[9px]">
            {isLoading ? (
                <>
                    <Skeleton className="h-7 w-full" />
                    <Skeleton className="h-7 w-4/5" />
                    <Skeleton className="h-7 w-3/5" />
                </>
            ) : apps.length === 0 ? (
                <p className="m-0 px-2 py-3 text-[12px] leading-snug text-muted-foreground">
                    No connected apps yet.
                </p>
            ) : (
                apps.map((app) => (
                    <button
                        key={app.integrationKey}
                        type="button"
                        aria-pressed={app.integrationKey === selectedKey}
                        onClick={() => onSelect(app)}
                        className={cn(
                            "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-muted",
                            app.integrationKey === selectedKey && "bg-muted font-medium",
                        )}
                    >
                        <AppIcon
                            logo={catalog.get(app.integrationKey)?.logo}
                            label={app.label}
                            loading={catalogLoading}
                        />
                        <span className="min-w-0 truncate">
                            {catalog.get(app.integrationKey)?.name || app.label}
                        </span>
                    </button>
                ))
            )}
            {/* Last row of the list it grows, not a footer under the whole panel: connecting an
                app is the same kind of act as picking one. */}
            {onConnectAnother ? (
                <button
                    type="button"
                    onClick={onConnectAnother}
                    className="mt-px flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted"
                >
                    <Plug aria-hidden className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">Connect another app…</span>
                </button>
            ) : null}
        </div>
    )
}
