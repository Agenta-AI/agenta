import OnboardingTriggerButton from "@/oss/components/Onboarding/components/OnboardingTriggerButton"

const InstructionButton = () => {
    return (
        <OnboardingTriggerButton
            triggerPayload={{state: "evaluations"}}
            tooltipTitle="Need a refresher? Launch the guided walkthrough for this run."
            buttonProps={{
                type: "default",
                size: "middle",
            }}
        ></OnboardingTriggerButton>
    )
}

export default InstructionButton
