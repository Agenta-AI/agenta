import {memo} from "react"

import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {PLAYGROUND_NATIVE_ONBOARDING} from "@/oss/components/pages/agent-home/assets/constants"
import OnboardingLoader from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingLoader"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

import PlaygroundLoadingShell from "./PlaygroundLoadingShell"

const loadPlayground = () => import("../Playground/Playground")
// Warm the playground graph immediately at module eval: without this the ~10MB chunk
// is only discovered after the auth + protected-route gates release, serializing its
// download+parse behind them instead of running in parallel.
if (typeof window !== "undefined") void loadPlayground()

const Playground = dynamic(loadPlayground, {
    ssr: false,
    loading: PlaygroundLoadingShell,
})

// Same Playground component + chunk, but the onboarding loader (agent-forced shell + chat skeleton) as
// the chunk-download fallback, so the ephemeral onboarding flow shows one continuous screen (matching
// OnboardingEntry + the mint state) that morphs straight into the live panel. Webpack dedupes the chunk.
const OnboardingPlayground = dynamic(loadPlayground, {
    ssr: false,
    loading: OnboardingLoader,
})

// When the current workflow is an evaluator we render the evaluator-flavored
// page (with `EvaluatorPlaygroundHeader` + `connectAppToEvaluatorAtom`) instead
// of the generic app `<Playground />`. Same code path that powers
// `/evaluators/playground` today — `playgroundSyncAtom` matches `/playground`
// anywhere in the pathname so hydration works at both URLs unchanged.
const ConfigureEvaluatorPage = dynamic(
    () => import("@/oss/components/Evaluators/components/ConfigureEvaluator"),
    {ssr: false, loading: PlaygroundLoadingShell},
)

// The project-scoped playground route (no `app_id`), distinct from `/apps/[app_id]/playground` and the
// evaluator `/evaluators/playground`. Onboarding only activates on this exact route.
const PROJECT_PLAYGROUND_PATHNAME = "/w/[workspace_id]/p/[project_id]/playground"

const PlaygroundRouter = () => {
    const ctx = useAtomValue(currentWorkflowContextAtom)
    const router = useRouter()

    // Flag ON + landing on the bare project playground → the real playground in ONBOARDING mode (it
    // mints + drives an ephemeral agent and shows the templates + "what do you want to build?" composer).
    // Reuses the full Playground machinery; the app-scoped/evaluator routes and flag-off are unchanged.
    const onboardingActive =
        PLAYGROUND_NATIVE_ONBOARDING && router.pathname === PROJECT_PLAYGROUND_PATHNAME
    if (onboardingActive) {
        // Key on the project so switching projects (a Next nav to the SAME `/playground` route) REMOUNTS
        // the onboarding: without this the mounted instance keeps the previous project's committed state
        // (mint-once `startedRef` + `realEntityId`) and never re-mints, falling through to the generic
        // empty playground instead of a fresh onboarding for the new project.
        return (
            <OnboardingPlayground
                key={`onboarding-${String(router.query.project_id ?? "")}`}
                onboarding
            />
        )
    }

    // Evaluators get the evaluator-flavored page so the upstream-app picker
    // is visible (the generic header only exposes the reverse direction —
    // app-needs-evaluator — not evaluator-needs-app). All evaluator kinds
    // (LLM/code, declarative classifiers, custom hooks, …) land here on
    // direct URL visits + sidebar switcher clicks; for simple classifiers
    // ConfigureEvaluatorPage renders the same few form fields the drawer
    // would, with the bonus of the evaluator-as-app surface (variants,
    // traces, sidebar context).
    //
    // Exception: `is_feedback` evaluators (human-annotation workflows) are
    // intentionally drawer-only in /evaluators — they don't run, they capture
    // human input. Routing them to `ConfigureEvaluatorPage` would render a
    // page with no testset/run controls that make sense for them. Direct
    // URL visits to `/apps/<human-id>/playground` fall through to the
    // generic `<Playground />`, which will (correctly) treat them as an
    // unsupported playground target and let the upstream route guard /
    // landing logic redirect them back to /evaluators.
    const isFeedbackEvaluator = ctx.workflow?.flags?.is_feedback === true
    if (ctx.workflowKind === "evaluator" && !isFeedbackEvaluator) {
        return <ConfigureEvaluatorPage />
    }
    return <Playground />
}

export default memo(PlaygroundRouter)
