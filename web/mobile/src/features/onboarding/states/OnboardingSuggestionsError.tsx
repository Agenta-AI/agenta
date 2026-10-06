import {Button} from "@agenta/ui/ui"

import {ONBOARDING_COPY} from "../onboardingCopy"

/** A failed catalog read; the flow stays usable, the suggestions retry in place. */
export const OnboardingSuggestionsError = ({onRetry}: {onRetry: () => void}) => (
    <p role="alert" className="text-muted-foreground m-0 flex items-center gap-2 text-sm">
        {ONBOARDING_COPY.agent.suggestionsError}
        <Button size="sm" variant="outline" onClick={onRetry}>
            {ONBOARDING_COPY.retry}
        </Button>
    </p>
)
