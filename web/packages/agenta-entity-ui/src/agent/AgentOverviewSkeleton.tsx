import {PanelSection, PanelSurface} from "@agenta/ui/components/presentational"
import {SkeletonBlock} from "@agenta/ui/ui"

import {AgentOverviewLayout} from "./AgentOverviewLayout"

/** `SessionCardList`'s own placeholder: four bars, whatever the card's row limit is. */
const ListRows = () => (
    <div className="flex flex-col gap-2 px-2 py-2">
        {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} active className="h-6 w-full" />
        ))}
    </div>
)

/** The rail cards' placeholder: text-height bars at the widths each card draws. */
const TextRows = ({widths}: {widths: string[]}) => (
    <div className="flex flex-col gap-2 px-2 py-2">
        {widths.map((width, i) => (
            <SkeletonBlock key={i} active className={`h-4 ${width}`} />
        ))}
    </div>
)

/**
 * The overview's placeholder for the window before a host knows it is rendering an agent at all.
 *
 * Every card inside {@link AgentOverviewBody} already skeletons itself, so this exists only for
 * the step above them: a host that must classify the workflow first cannot mount those cards
 * yet — mounting them would fire an agent's queries for what may turn out to be a prompt app —
 * and rendering nothing leaves the page blank under its own title.
 *
 * Every section copies the placeholder the card it stands in for draws, NOT that card's eventual
 * row count: this hands off to those placeholders, not to loaded content, so a section that
 * guessed at the row limit would snap to a different height the moment the real card mounted.
 */
export const AgentOverviewSkeleton = () => (
    <AgentOverviewLayout
        main={
            <>
                <SkeletonBlock active className="h-[92px] w-full rounded-xl" />
                <div className="flex flex-col gap-10">
                    <PanelSection variant="page" title="Sessions">
                        <ListRows />
                    </PanelSection>
                    <PanelSection
                        variant="page"
                        title="Automation runs"
                        minHeightClassName="min-h-[100px]"
                    >
                        <ListRows />
                    </PanelSection>
                </div>
            </>
        }
        rail={
            <PanelSurface className="flex flex-col gap-3">
                {/* Six rows, one per config section — the one card whose placeholder is a fixed
                    count rather than a shape. */}
                <PanelSection title="Configuration" bodyClassName="flex flex-col px-4 pb-3">
                    <div className="flex flex-col gap-2 py-1">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                            <SkeletonBlock key={i} active className="h-6 w-full" />
                        ))}
                    </div>
                </PanelSection>
                <PanelSection title="Files">
                    <TextRows widths={["w-full", "w-5/6", "w-2/3"]} />
                </PanelSection>
                <PanelSection title="Next triggers">
                    <TextRows widths={["w-3/4", "w-1/2"]} />
                </PanelSection>
                {/* Usage has no placeholder of its own — it renders its real rows with em-dashes
                    until the figures land, so two bars stand in for that pair. */}
                <PanelSection title="Usage" bodyClassName="flex flex-col gap-3 px-4 pb-4">
                    <TextRows widths={["w-1/2", "w-1/3"]} />
                </PanelSection>
            </PanelSurface>
        }
    />
)
