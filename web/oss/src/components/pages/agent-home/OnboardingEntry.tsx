import {useEffect} from "react"

import {appTemplatesQueryAtom} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
import {urlAtom} from "@/oss/state/url"

import OnboardingLoader from "./PlaygroundOnboarding/OnboardingLoader"

import AgentHome from "./index"

/**
 * Entry gate for playground-native onboarding (`NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING`). Decides
 * BEFORE painting anything so we never flash the wrong surface:
 *  - first-run (no agents yet) → redirect to the ephemeral onboarding playground (`/playground`);
 *  - returning (has agents)    → the agent-home list, as before.
 *
 * The decision needs the agents query, so a loading state covers both the query and the redirect
 * (a blank wait would be jarring). `!loading` = the query resolved (`isPending` false), so an empty
 * list only counts as first-run once we've actually loaded it — no false redirect during the fetch.
 */
const OnboardingEntry = () => {
    const router = useRouter()
    const agents = useAtomValue(agentsWorkflowsAtom)
    const loading = useAtomValue(agentsWorkflowsLoadingAtom)
    const {projectURL} = useAtomValue(urlAtom)
    const firstRun = !loading && agents.length === 0

    // Warm the agent-template cache now so the ephemeral mint on `/playground` finds it cached (no
    // fetch) — overlaps that network with the agents query + redirect. Same cache agent-home warms.
    useAtomValue(appTemplatesQueryAtom)

    // Prefetch the (large) lazy `Playground` chunk while we decide/redirect, so landing on `/playground`
    // doesn't pay the chunk download — it overlaps with the redirect nav instead of following it.
    useEffect(() => {
        void import("@/oss/components/Playground/Playground")
    }, [])

    useEffect(() => {
        if (loading || !firstRun || !projectURL) return
        void router.replace(`${projectURL}/playground`)
    }, [loading, firstRun, projectURL, router])

    // Loading the agents query, or redirecting a first-run user — the shared onboarding loader, so the
    // whole flow reads as one continuous "setting up" screen (never the wrong surface, never blank).
    if (loading || firstRun) {
        return <OnboardingLoader />
    }

    return <AgentHome />
}

export default OnboardingEntry
