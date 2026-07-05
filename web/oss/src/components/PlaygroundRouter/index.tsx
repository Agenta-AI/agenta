import {memo} from "react"

import {bgColors} from "@agenta/ui"
import {DownOutlined} from "@ant-design/icons"
import {Flask, Plus} from "@phosphor-icons/react"
import {Button, Space, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {PLAYGROUND_NATIVE_ONBOARDING} from "@/oss/components/pages/agent-home/assets/constants"
import OnboardingLoader from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingLoader"
import {currentWorkflowContextAtom} from "@/oss/state/workflow"

const PlaygroundLoadingShell = () => {
    return (
        <div className="flex flex-col w-full h-[calc(100dvh-46px)] overflow-hidden">
            <div
                className={`flex items-center justify-between gap-4 px-2.5 py-2 ${bgColors.active}`}
            >
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>
                <div className="flex items-center gap-2">
                    <Button
                        type="text"
                        size="small"
                        icon={<Flask size={14} />}
                        className="self-start"
                        disabled
                    >
                        New Evaluation
                    </Button>
                    <Space.Compact size="small">
                        <Button
                            className="flex items-center gap-1"
                            icon={<Plus size={14} />}
                            disabled
                        >
                            Compare
                        </Button>
                        <Button icon={<DownOutlined style={{fontSize: 10}} />} disabled />
                    </Space.Compact>
                </div>
            </div>
        </div>
    )
}

const Playground = dynamic(() => import("../Playground/Playground"), {
    ssr: false,
    loading: PlaygroundLoadingShell,
})

// Same Playground component + chunk, but the onboarding-branded loader as the chunk-download fallback,
// so the ephemeral onboarding flow shows one continuous "setting up" screen (matching OnboardingEntry +
// the mint state) instead of the generic Playground header shell. Webpack dedupes the shared chunk.
const OnboardingPlayground = dynamic(() => import("../Playground/Playground"), {
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
    if (PLAYGROUND_NATIVE_ONBOARDING && typeof window !== "undefined") {
        console.log("%c[agent-onboarding]", "color:#84cc16;font-weight:bold", "PlaygroundRouter:", {
            flag: PLAYGROUND_NATIVE_ONBOARDING,
            pathname: router.pathname,
            expected: PROJECT_PLAYGROUND_PATHNAME,
            matches: router.pathname === PROJECT_PLAYGROUND_PATHNAME,
            willRenderOnboarding: onboardingActive,
        })
    }
    if (onboardingActive) {
        return <OnboardingPlayground onboarding />
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
