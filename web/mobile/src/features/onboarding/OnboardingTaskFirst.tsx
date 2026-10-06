import type {ReactNode} from "react"

import {templateProviderSlugs, type AgentStarterTemplate} from "@agenta/entities/workflow"
import {TemplateProviderMarks} from "@agenta/home-ui"
import {Badge, Textarea} from "@agenta/ui/ui"
import {Check, Robot, Sparkle} from "@phosphor-icons/react"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {choiceCardClass, taskTitle, type OnboardingCatalog} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {ONBOARDING_TASK_MAX, type TemplatePick} from "./onboardingDraft"
import {OnboardingSuggestionsError} from "./states/OnboardingSuggestionsError"
import {OnboardingSuggestionsSkeleton} from "./states/OnboardingSuggestionsSkeleton"

const copy = ONBOARDING_COPY.agent

const RadioMark = ({active}: {active: boolean}) => (
    <span
        aria-hidden
        className={cn(
            "ml-auto size-4 shrink-0 rounded-full border-solid",
            active ? "border-foreground border-[5px]" : "border-border border",
        )}
    />
)

/** Task first: pick what the agent should do, preview it, and the agent is built around it. */
export const OnboardingTaskFirst = ({
    pick,
    task,
    selected,
    suggestions,
    catalog,
    onPick,
    onCustom,
    onTask,
    create,
}: {
    pick: TemplatePick
    task: string
    selected: AgentStarterTemplate | undefined
    suggestions: AgentStarterTemplate[]
    catalog: OnboardingCatalog
    onPick: (template: AgentStarterTemplate, index: number) => void
    onCustom: () => void
    onTask: (task: string) => void
    create: ReactNode
}) => {
    const custom = pick?.kind === "custom"
    return (
        <div className="grid w-full gap-8 md:grid-cols-2">
            <div className="flex flex-col">
                <h1 className="m-0 text-2xl font-semibold leading-tight">
                    {copy.title("task-first")}
                </h1>
                <p className="text-muted-foreground mb-4 mt-1 text-sm">{copy.taskSubtitle}</p>
                <div className="flex flex-col gap-2">
                    {catalog.status === "pending" ? <OnboardingSuggestionsSkeleton rows /> : null}
                    {catalog.status === "error" ? (
                        <OnboardingSuggestionsError onRetry={catalog.retry} />
                    ) : null}
                    {suggestions.map((template, index) => {
                        const active = selected?.key === template.key
                        return (
                            <button
                                type="button"
                                key={template.key}
                                aria-pressed={active}
                                onClick={() => onPick(template, index)}
                                className={cn(
                                    choiceCardClass(active),
                                    FOCUS_RING,
                                    "flex flex-col gap-1",
                                )}
                            >
                                <span className="flex w-full items-center gap-2">
                                    <strong className="text-sm">{taskTitle(template)}</strong>
                                    <TemplateProviderMarks
                                        providers={templateProviderSlugs(template)}
                                    />
                                    {index === 0 ? (
                                        <Badge variant="info">{copy.recommended}</Badge>
                                    ) : null}
                                    <RadioMark active={active} />
                                </span>
                                <span className="text-muted-foreground text-xs">
                                    {template.description}
                                </span>
                            </button>
                        )
                    })}
                    <button
                        type="button"
                        aria-pressed={custom}
                        onClick={onCustom}
                        className={cn(choiceCardClass(custom), FOCUS_RING, "flex flex-col gap-1")}
                    >
                        <span className="flex w-full items-center gap-2">
                            <strong className="text-sm">{copy.somethingElse}</strong>
                            <RadioMark active={custom} />
                        </span>
                        <span className="text-muted-foreground text-xs">
                            {copy.somethingElseHint}
                        </span>
                    </button>
                </div>
                {custom ? (
                    <label className="mt-4 flex flex-col gap-2 text-sm">
                        {copy.taskLabel}
                        <Textarea
                            rows={4}
                            value={task}
                            maxLength={ONBOARDING_TASK_MAX}
                            onChange={(event) => onTask(event.target.value)}
                        />
                    </label>
                ) : null}
            </div>
            <aside className="border-border flex flex-col border-0 border-solid md:border-l md:pl-8">
                <p className="text-muted-foreground m-0 mb-4 flex items-center gap-2 text-sm">
                    <Robot size={16} /> {copy.previewLabel}
                </p>
                <div className="flex items-center gap-3">
                    <span
                        className={cn(
                            "flex size-10 shrink-0 items-center justify-center rounded-lg",
                            selected
                                ? "bg-foreground text-background"
                                : "bg-muted text-muted-foreground",
                        )}
                    >
                        <Robot size={22} weight="fill" />
                    </span>
                    <span className="min-w-0">
                        <h2 className="m-0 text-lg font-semibold leading-tight">
                            {selected?.name ?? copy.previewEmptyName}
                        </h2>
                        <span className="text-muted-foreground text-sm">
                            {selected?.description ?? copy.previewEmptyHint}
                        </span>
                    </span>
                </div>
                {!selected && !custom ? (
                    <div className="border-border text-muted-foreground mt-6 flex flex-col items-center gap-2 rounded-xl border border-solid px-6 py-10 text-center text-sm">
                        <Sparkle size={18} />
                        {copy.previewEmptyHint}
                    </div>
                ) : null}
                {selected?.example ? (
                    <div className="border-border mt-6 rounded-xl border border-solid p-4">
                        <h3 className="m-0 text-sm font-semibold">{copy.exampleTitle}</h3>
                        <p className="text-muted-foreground m-0 text-xs">{copy.exampleHint}</p>
                        <p className="bg-muted mt-4 rounded-lg p-3 text-sm">
                            {selected.example.prompt}
                        </p>
                        <ol className="my-4 flex list-none flex-col gap-2 p-0 text-sm">
                            {selected.example.steps.map((text) => (
                                <li key={text} className="flex gap-2">
                                    <Check className="text-success mt-0.5 shrink-0" />
                                    {text}
                                </li>
                            ))}
                        </ol>
                        <p className="m-0 text-sm">{selected.example.reply}</p>
                    </div>
                ) : null}
                <div className="mt-6 flex justify-end">{create}</div>
            </aside>
        </div>
    )
}
