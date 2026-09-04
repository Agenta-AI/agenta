import {useEffect} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useAgentsFirstRun} from "@/oss/components/pages/agents/store"
import {urlAtom} from "@/oss/state/url"

import {useAgentHomeVariants} from "./hooks/useAgentHomeVariants"
import OnboardingLoader from "./PlaygroundOnboarding/OnboardingLoader"

import AgentHome from "./index"

/**
 * Entry gate for playground-native onboarding (`NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING`). Decides
 * BEFORE painting anything so we never flash the wrong surface:
 *  - first-run (no agents yet) → the agent-home create surface (`?new=1`);
 *  - returning (has agents)    → the agent-home list, as before;
 *  - `?new=1` (either case)    → the same create surface, which the user asked for by name.
 *
 * First run used to land on the ephemeral onboarding playground instead, which made describing an
 * agent two surfaces with two behaviours: there the connect step docked ABOVE a live composer, so
 * the user faced two "Create agent" buttons, while here it replaces the composer. One surface now.
 *
 * While the list is empty we're either still confirming it or already redirecting, and the loader
 * covers both so we never flash the wrong surface. A non-empty list is conclusive immediately, so
 * returning users never wait. `useAgentsFirstRun` (not `agentsWorkflowsAtom`) because the decision
 * happens on mount — see its docs.
 */
const OnboardingEntry = () => {
    const router = useRouter()
    const {resolving, firstRun} = useAgentsFirstRun()
    const {projectURL} = useAtomValue(urlAtom)
    // `?new=1` asks for the create surface by name (and may carry a `?template=` seed for it), so
    // it outranks the first-run redirect — which would drop the user on a bare onboarding chat.
    const {creatingAgent} = useAgentHomeVariants()

    // Warm the agent-template cache now — the create surface reads it to seed a `?template=` pick,
    // and this overlaps that network with the agents query and the redirect.
    useAtomValue(appTemplatesQueryAtom)

    // Prefetch the (large) lazy `Playground` chunk while we decide/redirect: creating an agent
    // opens it moments later, so the download overlaps this wait instead of following it.
    useEffect(() => {
        void import("@/oss/components/Playground/Playground")
    }, [])

    useEffect(() => {
        if (creatingAgent) return
        if (!firstRun || !projectURL) return
        void router.replace(`${projectURL}/apps?new=1`)
    }, [creatingAgent, firstRun, projectURL, router])

    // The shared onboarding loader, so the whole flow reads as one continuous "setting up" screen.
    if (resolving && !creatingAgent) {
        return <OnboardingLoader />
    }

    return <AgentHome />
}

export default OnboardingEntry
