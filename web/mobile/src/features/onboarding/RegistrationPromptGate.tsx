import {loadWithText} from "@agenta/i18n"
import {isBillingEnabled} from "@agenta/shared/api"
import dynamic from "next/dynamic"

import {useInstanceLicense} from "../settings/useInstanceLicense"

import {shouldOfferRegistration} from "./registrationOfferRules"

// The prompt and its text load only for an admin who will see it.
const RegistrationPrompt = dynamic(
    () => loadWithText(() => import("./RegistrationPrompt")).then((m) => m.RegistrationPrompt),
    {ssr: false},
)

/**
 * Installs that upgrade never see onboarding, so the instance admin gets the registration step
 * once in the app: self-hosted, no key, and not skipped on this instance.
 */
export const RegistrationPromptGate = ({projectId}: {projectId: string}) => {
    const license = useInstanceLicense(projectId)
    const data = license.data
    const candidate =
        Boolean(data) &&
        !data?.registration_prompt_dismissed &&
        shouldOfferRegistration({
            selfHosted: !isBillingEnabled(),
            isInstanceAdmin: license.isInstanceAdmin,
            hasKey: Boolean(data?.license),
        })
    return candidate ? <RegistrationPrompt projectId={projectId} /> : null
}
