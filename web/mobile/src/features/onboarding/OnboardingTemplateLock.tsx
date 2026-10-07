import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {SkeletonBlock} from "@agenta/ui/ui"
import {LockSimple} from "@phosphor-icons/react"

import {ONBOARDING_COPY} from "./onboardingCopy"

const copy = ONBOARDING_COPY.creator

/** A template's name and instructions, shown read-only: its own package sets them on Create. */
export const OnboardingTemplateLock = ({template}: {template: AgentStarterTemplate | null}) => (
    <section
        aria-label={copy.fromTemplateLabel}
        className="bg-muted/50 border-border flex flex-col gap-4 rounded-xl border border-solid p-4"
    >
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{copy.name}</span>
            {template ? (
                <span className="text-[15px]">{template.name}</span>
            ) : (
                <SkeletonBlock className="h-5 w-40" />
            )}
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{copy.instructions}</span>
            {template ? (
                <p className="text-muted-foreground m-0 text-sm">{template.instructions}</p>
            ) : (
                <SkeletonBlock className="h-4 w-full" />
            )}
        </div>
        <p className="text-muted-foreground m-0 flex items-start gap-1.5 text-xs">
            <LockSimple size={13} className="mt-px shrink-0" />
            {copy.fromTemplateNote}
        </p>
    </section>
)
