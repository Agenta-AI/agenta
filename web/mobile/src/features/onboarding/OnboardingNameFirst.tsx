import type {ReactNode} from "react"

import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {TemplateProviderMarks} from "@agenta/home-ui"
import {Input} from "@agenta/ui/ui"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {OnboardingAgentIdentity} from "./OnboardingAgentIdentity"
import {choiceCardClass, toneAt, type OnboardingCatalog} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {ONBOARDING_NAME_MAX, onboardingHeadingId, type OnboardingIconPick} from "./onboardingDraft"
import {OnboardingSuggestionsError} from "./states/OnboardingSuggestionsError"
import {OnboardingSuggestionsSkeleton} from "./states/OnboardingSuggestionsSkeleton"

const copy = ONBOARDING_COPY.agent
const SUGGESTIONS_ID = "onboarding-suggestions"

/** Control: give the agent a face and a name; role suggestions fill both in one tap. */
export const OnboardingNameFirst = ({
    role,
    name,
    icon,
    pickedKey,
    suggestions,
    catalog,
    onName,
    onIcon,
    onPick,
    create,
}: {
    role: string
    name: string
    icon: OnboardingIconPick | null
    pickedKey: string | null
    suggestions: AgentStarterTemplate[]
    catalog: OnboardingCatalog
    onName: (name: string) => void
    onIcon: (icon: OnboardingIconPick) => void
    onPick: (template: AgentStarterTemplate, index: number) => void
    create: ReactNode
}) => (
    <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center gap-6 py-4">
            <h1
                id={onboardingHeadingId("agent")}
                tabIndex={-1}
                className={cn(ONBOARDING_COPY.headingClass, "text-center lg:text-[30px]")}
            >
                {copy.title("control")}
            </h1>
            <OnboardingAgentIdentity value={icon} onChange={onIcon} />
            <label className="text-muted-foreground flex w-full max-w-[440px] flex-col gap-2 text-sm">
                {copy.nameLabel}
                <Input
                    size="lg"
                    value={name}
                    maxLength={ONBOARDING_NAME_MAX}
                    placeholder={copy.namePlaceholder}
                    onChange={(event) => onName(event.target.value)}
                />
            </label>
            {create}
        </div>
        <div className="flex flex-col gap-3">
            {catalog.status === "pending" ? <OnboardingSuggestionsSkeleton /> : null}
            {catalog.status === "error" ? (
                <OnboardingSuggestionsError onRetry={catalog.retry} />
            ) : null}
            {suggestions.length > 0 ? (
                <>
                    <p id={SUGGESTIONS_ID} className="text-muted-foreground m-0 text-sm">
                        {copy.suggestionsFor(role)}
                    </p>
                    <div
                        role="group"
                        aria-labelledby={SUGGESTIONS_ID}
                        className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden"
                    >
                        {suggestions.map((template, index) => (
                            <button
                                key={template.key}
                                type="button"
                                aria-pressed={pickedKey === template.key}
                                onClick={() => onPick(template, index)}
                                className={cn(
                                    choiceCardClass(pickedKey === template.key),
                                    FOCUS_RING,
                                    "flex w-[280px] shrink-0 snap-start items-start gap-3",
                                )}
                            >
                                <span
                                    className={cn(
                                        "flex size-9 shrink-0 items-center justify-center rounded-[9px] text-sm font-semibold",
                                        toneAt(index),
                                    )}
                                >
                                    {template.initials}
                                </span>
                                <span className="flex min-w-0 flex-col gap-1">
                                    <strong className="text-[15px]">{template.name}</strong>
                                    <span className="text-muted-foreground line-clamp-2 text-xs">
                                        {template.description}
                                    </span>
                                    <TemplateProviderMarks
                                        providers={templateProviderSlugs(template)}
                                    />
                                </span>
                            </button>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    </div>
)
