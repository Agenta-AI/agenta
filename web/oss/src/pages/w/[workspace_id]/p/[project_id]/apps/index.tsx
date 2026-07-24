import dynamic from "next/dynamic"

import {PLAYGROUND_NATIVE_ONBOARDING} from "@/oss/components/pages/agent-home/assets/constants"
import {useConsumePendingTemplate} from "@/oss/components/pages/agent-home/hooks/useConsumePendingTemplate"
import OnboardingLoader from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingLoader"

const AgentHome = dynamic(() => import("@/oss/components/pages/agent-home"))

// With playground-native onboarding, `/apps` gates first-run users into the ephemeral onboarding
// playground (decides before rendering — see OnboardingEntry). On by default; set the flag to
// "false" to fall back to the agent-home page. The shared OnboardingLoader covers this chunk load
// so the flow shows one continuous "setting up" screen.
const OnboardingEntry = dynamic(() => import("@/oss/components/pages/agent-home/OnboardingEntry"), {
    loading: OnboardingLoader,
})

export default function Apps() {
    // A website template deep-link is consumed here, above both first-run surfaces, so the create
    // happens wherever the user lands. While a valid template is being consumed, hold the loader
    // instead of rendering a surface that would fire its own redirect and race the create.
    const consumingTemplate = useConsumePendingTemplate()
    if (consumingTemplate) return <OnboardingLoader />

    return PLAYGROUND_NATIVE_ONBOARDING ? <OnboardingEntry /> : <AgentHome />
}
