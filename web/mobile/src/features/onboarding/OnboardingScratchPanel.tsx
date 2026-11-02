import {FIRST_MESSAGE_STARTERS} from "./onboardingChoices"
import {OnboardingComposer} from "./OnboardingComposer"
import {ONBOARDING_COPY} from "./onboardingCopy"
import type {OnboardingCreateState} from "./OnboardingCreateState"
import type {OnboardingAgent} from "./onboardingDraft"

const copy = ONBOARDING_COPY.creator

/**
 * The blank start, where a template's panel would be: one composer whose message creates the
 * agent. It asks for no name or look: the agent names itself from its task, and its look is random.
 * As tall as its content, unlike a template's panel, which fills the row.
 */
export const OnboardingScratchPanel = ({
    agent,
    onChange,
    create,
}: {
    agent: OnboardingAgent
    onChange: (patch: Partial<OnboardingAgent>) => void
    create: OnboardingCreateState
}) => (
    <section
        aria-label={ONBOARDING_COPY.gallery.scratch}
        className="bg-muted flex min-w-0 flex-col gap-4 rounded-xl p-5"
    >
        <div className="flex flex-col gap-1">
            <h2 className="m-0 text-base font-semibold leading-6 tracking-[-0.01em]">
                {copy.title}
            </h2>
            <p className="text-muted-foreground m-0 text-sm leading-5">{copy.subtitle}</p>
        </div>
        <OnboardingComposer
            message={agent.firstMessage}
            onMessage={(firstMessage) => onChange({firstMessage})}
            create={create}
            starters={FIRST_MESSAGE_STARTERS}
        />
    </section>
)
