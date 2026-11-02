import {PanelSection} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"
import {LightningIcon} from "@phosphor-icons/react"

import {SectionLoadError} from "./SectionLoadError"
import {Tip} from "./Tip"
import {useUpcomingTriggers, type UseUpcomingTriggersArgs} from "./useUpcomingTriggers"

export type NextTriggersSectionProps = UseUpcomingTriggersArgs

/** What is going to fire, soonest first — the rows `useUpcomingTriggers` derives, in the rail's panel chrome. */
export const NextTriggersSection = ({agentId, agentNames}: NextTriggersSectionProps = {}) => {
    const {rows, isLoading, hasError, retry} = useUpcomingTriggers({agentId, agentNames})

    return (
        <PanelSection title="Automations">
            {isLoading ? (
                <div className="flex flex-col gap-2 px-2 py-2">
                    <SkeletonBlock active className="h-4 w-3/4" />
                    <SkeletonBlock active className="h-4 w-1/2" />
                </div>
            ) : hasError ? (
                <SectionLoadError message="Couldn't load automations." onRetry={retry} />
            ) : rows.length === 0 ? (
                <p className="m-0 px-2 py-3 text-xs text-colorTextTertiary">
                    {agentId
                        ? "No automations bound to this agent yet."
                        : "Nothing scheduled. Give an agent an automation and its next run shows up here."}
                </p>
            ) : (
                rows.map((row) => (
                    <Tip key={row.id} title={row.tooltip} side="left">
                        <div className="box-border flex items-start gap-2 rounded-lg px-2 py-2.5">
                            <LightningIcon
                                size={16}
                                className="mt-0.5 shrink-0 text-colorTextTertiary"
                                weight="fill"
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-sm text-colorText">{row.name}</span>
                                {row.subtitle ? (
                                    <span className="truncate text-[13px] text-colorTextSecondary">
                                        {row.subtitle}
                                    </span>
                                ) : null}
                            </span>
                            <span className="mt-0.5 shrink-0 text-xs text-colorTextSecondary">
                                {row.detail}
                            </span>
                        </div>
                    </Tip>
                ))
            )}
        </PanelSection>
    )
}
