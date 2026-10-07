import {useMemo} from "react"

import {useToolConnectionsQuery} from "@agenta/entities/gatewayTool"
import {useDirectToolConnect} from "@agenta/entity-ui/gatewayTool"
import {Spinner} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {appIdentity, connectedApps} from "./onboardingApps"
import {SUGGESTED_APPS} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"

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
    // Added once the sign-in settles; a cancelled one stays off because it never connects.
    const {connect, connectingKey} = useDirectToolConnect((key) => onToggle(key, true))
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
                            "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-solid px-3 text-[13px] font-medium transition-colors",
                            FOCUS_RING,
                            on
                                ? "border-foreground bg-background text-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                    >
                        <img src={chip.logo} alt="" className="size-4 object-contain" />
                        {chip.name}
                        {connecting ? (
                            <Spinner size="small" aria-label={ONBOARDING_COPY.creator.connecting} />
                        ) : on ? (
                            <Check size={12} weight="bold" />
                        ) : (
                            <Plus size={12} />
                        )}
                    </button>
                )
            })}
        </div>
    )
}
