import {useMemo} from "react"

import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {useDirectToolConnect} from "@agenta/entity-ui/gatewayTool"
import {Spinner} from "@agenta/ui/ui"
import {Check} from "@phosphor-icons/react"

import {appIdentity, connectedApps} from "./onboardingApps"
import {SUGGESTED_APPS} from "./onboardingChoices"
import {isUsableToolConnection} from "./onboardingConfig"
import {ONBOARDING_COPY} from "./onboardingCopy"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

const MAX_APPS = 10

/** The apps the agent works in: a chip connects an app on first tap, then toggles it. */
export const OnboardingAppsField = ({
    suggested,
    value,
    onToggle,
}: {
    /** The picked template's apps, which lead the row. */
    suggested: readonly string[]
    value: readonly string[]
    onToggle: (key: string, on: boolean) => void
}) => {
    const {connections} = useToolConnectionsQuery()
    // Only a sign-in that left a usable connection turns the app on.
    const {connect, connectingKey} = useDirectToolConnect((key, connection) => {
        if (connection && isUsableToolConnection(connection)) onToggle(key, true)
    })
    const connected = useMemo(() => connectedApps(connections), [connections])
    const chips = useMemo(
        () =>
            [...new Set([...suggested, ...SUGGESTED_APPS, ...connected.keys()])]
                .slice(0, MAX_APPS)
                .map((key) => appIdentity(key, connected)),
        [suggested, connected],
    )

    return (
        <div className="flex flex-wrap gap-2">
            {chips.map((chip) => {
                const live = connected.has(chip.key)
                const on = live && value.includes(chip.key)
                const connecting = connectingKey === chip.key
                return (
                    <button
                        type="button"
                        key={chip.key}
                        aria-pressed={on}
                        aria-busy={connecting}
                        onClick={() => {
                            if (connecting) return
                            if (live) {
                                onToggle(chip.key, !on)
                                return
                            }
                            void connect({
                                integrationKey: chip.key,
                                integrationName: chip.name,
                                authSchemes: [],
                                existingCount: connections.filter(
                                    (item) => item.integration_key === chip.key,
                                ).length,
                            })
                        }}
                        className={cn(
                            "bg-background text-foreground inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border-0 pl-2.5 pr-3 text-[13px] font-medium leading-[18px] transition-shadow",
                            FOCUS_RING,
                            on
                                ? "ring-foreground ring-[1.5px]"
                                : "ring-foreground/10 hover:ring-foreground/30 shadow-xs ring-1",
                        )}
                    >
                        <img src={chip.logo} alt="" className="size-4 object-contain" />
                        {chip.name}
                        {connecting ? (
                            <Spinner size="small" aria-label={ONBOARDING_COPY.creator.connecting} />
                        ) : on ? (
                            <Check size={12} weight="bold" />
                        ) : null}
                    </button>
                )
            })}
        </div>
    )
}
