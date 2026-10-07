import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {Field, Input, LoadingButton, Textarea} from "@agenta/ui/ui"

import {FOCUS_RING} from "@/lib/interactive"
import {cn} from "@/lib/utils"

import {OnboardingAgentPreview} from "./OnboardingAgentPreview"
import type {ConnectedApps} from "./onboardingApps"
import {OnboardingAppsField} from "./OnboardingAppsField"
import {FIRST_MESSAGE_STARTERS} from "./onboardingChoices"
import {ONBOARDING_COPY} from "./onboardingCopy"
import {
    FIRST_AGENT_FALLBACK_NAME,
    ONBOARDING_NAME_MAX,
    onboardingHeadingId,
    type OnboardingAgent,
} from "./onboardingDraft"
import {OnboardingIconField} from "./OnboardingIconField"
import {OnboardingTemplateLock} from "./OnboardingTemplateLock"

const copy = ONBOARDING_COPY.creator

export interface OnboardingCreateState {
    /** A runnable model is selected. */
    modelReady: boolean
    /** A blank start has instructions or a first message; a template has loaded. */
    complete: boolean
    creating: boolean
    error?: string | null
    onCreate: () => void
    onChooseModel: () => void
}

/** The agent's name, face, instructions, apps and first message, beside a live preview. */
export const OnboardingCreator = ({
    agent,
    template,
    fromTemplate,
    suggestedApps,
    connectedApps,
    toolsEnabled,
    onChange,
    onApp,
    create,
}: {
    agent: OnboardingAgent
    /** The picked template, once the catalog has it. */
    template: AgentStarterTemplate | null
    /** A template was picked, so its name and instructions are not edited here. */
    fromTemplate: boolean
    suggestedApps: readonly string[]
    connectedApps: ConnectedApps
    toolsEnabled: boolean
    onChange: (patch: Partial<Omit<OnboardingAgent, "apps">>) => void
    onApp: (key: string, on: boolean) => void
    create: OnboardingCreateState
}) => (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
                <h1
                    id={onboardingHeadingId("creator")}
                    tabIndex={-1}
                    className={ONBOARDING_COPY.headingClass}
                >
                    {fromTemplate ? copy.fromTemplateTitle : copy.title}
                </h1>
                <p className="text-muted-foreground m-0 text-[15px]">
                    {fromTemplate && template
                        ? copy.fromTemplateSubtitle(template.name)
                        : fromTemplate
                          ? ""
                          : copy.subtitle}
                </p>
            </div>
            {fromTemplate ? (
                <OnboardingTemplateLock template={template} />
            ) : (
                <Field label={copy.name} size="sm" gap="sm">
                    <Input
                        size="lg"
                        value={agent.name}
                        maxLength={ONBOARDING_NAME_MAX}
                        placeholder={FIRST_AGENT_FALLBACK_NAME}
                        onChange={(event) => onChange({name: event.target.value})}
                    />
                </Field>
            )}
            <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{copy.icon}</span>
                <OnboardingIconField value={agent.icon} onChange={(icon) => onChange({icon})} />
            </div>
            {fromTemplate ? null : (
                <Field label={copy.instructions} size="sm" gap="sm">
                    <Textarea
                        rows={5}
                        value={agent.instructions}
                        placeholder={copy.instructionsPlaceholder}
                        onChange={(event) => onChange({instructions: event.target.value})}
                    />
                </Field>
            )}
            {toolsEnabled ? (
                <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">
                        {copy.apps}{" "}
                        <span className="text-muted-foreground font-normal">· {copy.optional}</span>
                    </span>
                    <span className="text-muted-foreground text-xs">{copy.appsHint}</span>
                    <OnboardingAppsField
                        suggested={suggestedApps}
                        value={agent.apps}
                        onToggle={onApp}
                    />
                </div>
            ) : null}
            <Field
                label={copy.firstMessage}
                description={fromTemplate ? copy.templateFirstMessageHint : undefined}
                size="sm"
                gap="sm"
            >
                <Textarea
                    rows={3}
                    value={agent.firstMessage}
                    placeholder={copy.firstMessagePlaceholder}
                    onChange={(event) => onChange({firstMessage: event.target.value})}
                />
            </Field>
            <div role="group" aria-label={copy.starters} className="-mt-3 flex flex-wrap gap-1.5">
                {FIRST_MESSAGE_STARTERS.map((text) => (
                    <button
                        type="button"
                        key={text}
                        onClick={() => onChange({firstMessage: text})}
                        className={cn(
                            "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer rounded-full border-0 px-3 py-1.5 text-xs transition-colors",
                            FOCUS_RING,
                        )}
                    >
                        {text}
                    </button>
                ))}
            </div>
            <div className="border-border flex flex-col gap-3 border-0 border-t border-solid pt-5">
                {create.error ? (
                    <p role="alert" className="text-destructive m-0 text-sm">
                        {create.error}
                    </p>
                ) : null}
                {!create.modelReady ? (
                    <p className="text-muted-foreground m-0 text-sm">
                        {copy.modelMissing}{" "}
                        <button
                            type="button"
                            onClick={create.onChooseModel}
                            className="text-foreground cursor-pointer border-0 bg-transparent p-0 text-sm underline"
                        >
                            {copy.modelMissingAction}
                        </button>
                    </p>
                ) : !create.complete && !fromTemplate ? (
                    <p className="text-muted-foreground m-0 text-sm">{copy.needsSomething}</p>
                ) : null}
                <LoadingButton
                    size="lg"
                    className="self-end max-sm:w-full"
                    loading={create.creating}
                    disabled={!create.modelReady || !create.complete}
                    onClick={create.onCreate}
                >
                    {copy.create}
                </LoadingButton>
            </div>
        </div>
        <div className="sticky top-6 max-lg:hidden">
            <OnboardingAgentPreview
                agent={
                    template
                        ? {...agent, name: template.name, instructions: template.instructions}
                        : agent
                }
                connected={connectedApps}
            />
        </div>
    </div>
)
