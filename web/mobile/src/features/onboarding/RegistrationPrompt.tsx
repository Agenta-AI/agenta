import {useState} from "react"

import {useProfile} from "@agenta/entities/profile"
import {Dialog, DialogContent, DialogTitle} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"

import {dismissRegistrationPrompt, type InstanceLicense} from "../settings/licenseApi"
import {instanceLicenseQueryKey} from "../settings/useInstanceLicense"

import {isOnboardingPending} from "./onboardingPending"
import {RegistrationOffer} from "./RegistrationOffer"

/**
 * The registration step, once, over the app after an upgrade. Skip and Continue store the
 * dismissal on the instance, so it does not come back in another browser. Escape and a click
 * outside do nothing: the step asks for one of the two answers.
 */
export const RegistrationPrompt = ({projectId}: {projectId: string}) => {
    const {user} = useProfile()
    const queryClient = useQueryClient()
    const [closed, setClosed] = useState(false)
    // A new account answers it in onboarding instead.
    const pending = user?.id ? isOnboardingPending(user.id) : true

    const close = () => {
        setClosed(true)
        queryClient.setQueryData<InstanceLicense>(instanceLicenseQueryKey(projectId), (data) =>
            data ? {...data, registration_prompt_dismissed: true} : data,
        )
        void dismissRegistrationPrompt(projectId).catch(() => undefined)
    }

    return (
        <Dialog open={!closed && !pending}>
            <DialogContent
                showCloseButton={false}
                // The gain list under the title describes the step.
                aria-describedby={undefined}
                onEscapeKeyDown={(event) => event.preventDefault()}
                onInteractOutside={(event) => event.preventDefault()}
                className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-[560px]"
            >
                <RegistrationOffer
                    projectId={projectId}
                    email={user?.email ?? null}
                    largeCompany={false}
                    renderTitle={(title) => (
                        <DialogTitle className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.02em]">
                            {title}
                        </DialogTitle>
                    )}
                    onSkip={close}
                    onDone={close}
                />
            </DialogContent>
        </Dialog>
    )
}
