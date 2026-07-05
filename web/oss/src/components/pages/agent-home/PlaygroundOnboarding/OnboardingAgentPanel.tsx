import dynamic from "next/dynamic"

import {useOnboardingContext} from "./OnboardingContext"
import OnboardingGenerationPanel from "./OnboardingGenerationPanel"

// Lazy — pulls in the AI SDK only once the agent goes live (post-commit).
const AgentChatPanel = dynamic(() => import("@/oss/components/AgentChatSlice/AgentChatPanel"), {
    ssr: false,
})

/**
 * The agent-generation arm for playground-native onboarding: the "what do you want to build?" composer
 * while ephemeral, the live chat once committed in place. Injected as the playground's
 * `AgentGenerationPanel` and rendered deep in `MainLayout`, so it reads the ephemeral→real transition
 * from the onboarding context rather than props. `MainLayout`'s generation-host latch keeps this slot
 * mounted across the entity swap, so the change flows through as a child swap, not a remount.
 */
const OnboardingAgentPanel = () => {
    const {realEntityId} = useOnboardingContext()
    if (realEntityId) return <AgentChatPanel entityId={realEntityId} />
    return <OnboardingGenerationPanel />
}

export default OnboardingAgentPanel
