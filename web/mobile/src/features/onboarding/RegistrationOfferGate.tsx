import {loadWithText} from "@agenta/i18n"
import {isBillingEnabled} from "@agenta/shared/api"
import dynamic from "next/dynamic"

import {useInstanceLicense} from "../settings/useInstanceLicense"

import {shouldOfferRegistration} from "./registrationOfferRules"

// The dialog and its text load only for an admin who will see it.
const RegistrationOfferDialog = dynamic(
    () =>
        loadWithText(() => import("./RegistrationOfferDialog")).then(
            (m) => m.RegistrationOfferDialog,
        ),
    {ssr: false},
)

/**
 * Installs that upgrade never see onboarding, so the instance admin gets the registration step
 * once in the app: self-hosted, no key, and not skipped on this instance.
 */
export const RegistrationOfferGate = ({projectId}: {projectId: string}) => {
    const license = useInstanceLicense(projectId)
    const data = license.data
    const candidate =
        Boolean(data) &&
        !data?.registration_offer_dismissed &&
        shouldOfferRegistration({
            selfHosted: !isBillingEnabled(),
            isInstanceAdmin: license.isInstanceAdmin,
            hasKey: Boolean(data?.license),
        })
    return candidate ? <RegistrationOfferDialog projectId={projectId} /> : null
}
