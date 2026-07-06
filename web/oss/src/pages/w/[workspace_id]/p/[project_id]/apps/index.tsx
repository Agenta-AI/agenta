import dynamic from "next/dynamic"

import {PLAYGROUND_NATIVE_ONBOARDING} from "@/oss/components/pages/agent-home/assets/constants"
import OnboardingLoader from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingLoader"

const AgentHome = dynamic(() => import("@/oss/components/pages/agent-home"))

// With playground-native onboarding, `/apps` gates first-run users into the ephemeral onboarding
// playground (decides before rendering — see OnboardingEntry). Off by default → the agent-home page.
// The shared OnboardingLoader covers this chunk load so the flow shows one continuous "setting up" screen.
const OnboardingEntry = dynamic(() => import("@/oss/components/pages/agent-home/OnboardingEntry"), {
    loading: OnboardingLoader,
})

export default function Apps() {
    return PLAYGROUND_NATIVE_ONBOARDING ? <OnboardingEntry /> : <AgentHome />
}
