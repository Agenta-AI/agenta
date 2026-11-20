import {useMemo} from "react"

import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {useDirectToolConnect} from "@agenta/entity-ui/gatewayTool"
import {useT} from "@agenta/i18n"
import galleryCatalog from "@agenta/i18n/catalogs/onboarding.gallery"
import {isToolsEnabled} from "@agenta/shared/api/env"
import {Button, Spinner} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"

import {AppTile} from "../marketplace/AppTile"

import {appIdentity, connectedApps} from "./onboardingApps"
import {ONBOARDING_STYLE} from "./onboardingStyle"

/** The apps a template connects, each connectable in place; the connections query drives each row. */
export const OnboardingTemplateApps = ({template}: {template: AgentStarterTemplate}) => {
    const t = useT(galleryCatalog)
    const {connections} = useToolConnectionsQuery()
    const {connect, connectingKey} = useDirectToolConnect()
    const toolsEnabled = useMemo(() => isToolsEnabled(), [])
    const connected = useMemo(() => connectedApps(connections), [connections])
    const apps = templateProviderSlugs(template).map((key) => appIdentity(key, connected))
    if (apps.length === 0) return null
    const ready = apps.filter((app) => connected.has(app.key)).length

    return (
        <div className="flex flex-col gap-1">
            <span className={ONBOARDING_STYLE.kickerClass}>
                {t("onboarding.gallery.connects")}
                {toolsEnabled
                    ? ` · ${t("onboarding.gallery.connectedCount", {ready, total: apps.length})}`
                    : null}
            </span>
            <ul className="m-0 flex list-none flex-col p-0 max-sm:gap-2">
                {apps.map((app) => (
                    <li key={app.key} className="flex min-h-10 items-center gap-2.5">
                        <AppTile
                            app={{slug: app.key, name: app.name, logo: app.logo}}
                            size="sm"
                            decorative
                        />
                        <span className="min-w-0 flex-1 truncate text-sm leading-5">
                            {app.name}
                        </span>
                        {connected.has(app.key) ? (
                            <span className="text-muted-foreground inline-flex items-center gap-1 text-[13px] leading-5">
                                <Check size={13} weight="bold" />
                                {t("onboarding.gallery.connected")}
                            </span>
                        ) : toolsEnabled ? (
                            <Button
                                variant="outline"
                                size="sm"
                                aria-label={t("onboarding.gallery.connectApp", {name: app.name})}
                                aria-busy={connectingKey === app.key || undefined}
                                disabled={connectingKey !== null}
                                onClick={() =>
                                    void connect({
                                        integrationKey: app.key,
                                        integrationName: app.name,
                                        existingCount: connections.filter(
                                            (item) => item.integration_key === app.key,
                                        ).length,
                                    })
                                }
                                className="h-8 max-sm:h-10"
                            >
                                {connectingKey === app.key ? <Spinner size="small" /> : null}
                                {t("onboarding.gallery.connect")}
                            </Button>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    )
}
