import {useCallback, useMemo} from "react"

import {ArrowLeft, Code, TreeView, Rocket} from "@phosphor-icons/react"
import {Typography, Card, Button} from "antd"
import {useRouter} from "next/router"

import {
    SetupTracingModalContent,
    useStyles as useTracingStyles,
} from "@/oss/components/pages/app-management/modals/SetupTracingModal"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {buildPostLoginPath, waitForWorkspaceContext} from "@/oss/state/url/postLoginRedirect"

import {RunEvaluationView} from "./views/RunEvaluationView"

const {Title} = Typography

type ViewState = "selection" | "trace" | "eval"

const GetStarted = () => {
    const tracingClasses = useTracingStyles()
    const router = useRouter()
    const posthog = usePostHogAg()

    const view = useMemo<ViewState>(() => {
        const path = router.query.path
        if (path === "trace" || path === "eval") return path
        return "selection"
    }, [router.query.path])

    const setView = useCallback(
        (newView: ViewState) => {
            if (newView === "selection") {
                router.replace("/get-started", undefined, {shallow: true})
            } else {
                router.replace(`/get-started?path=${newView}`, undefined, {shallow: true})
            }
        },
        [router],
    )

    const navigateToDestination = useCallback(async () => {
        try {
            const context = await waitForWorkspaceContext({
                timeoutMs: 5000,
                requireProjectId: true,
                requireWorkspaceId: true,
                requireOrgData: true,
            })
            const path = buildPostLoginPath(context)
            router.push(path)
        } catch (e) {
            console.error("Failed to resolve workspace context", e)
            router.push("/w")
        }
    }, [router])

    const handleSelection = useCallback(
        async (selection: "trace" | "eval" | "test_prompt") => {
            posthog?.capture?.("onboarding_selection_v1", {
                selection,
            })

            if (selection === "test_prompt") {
                try {
                    const context = await waitForWorkspaceContext({
                        timeoutMs: 5000,
                        requireProjectId: true,
                        requireWorkspaceId: true,
                        requireOrgData: true,
                    })
                    const path = buildPostLoginPath(context)
                    router.push(`${path}?create_prompt=true`)
                } catch (e) {
                    console.error("Failed to resolve workspace context", e)
                    router.push("/apps?create_prompt=true")
                }
            } else {
                setView(selection)
            }
        },
        [posthog, router, setView],
    )

    const handleNext = useCallback(
        async (destination: string) => {
            try {
                const context = await waitForWorkspaceContext({
                    timeoutMs: 5000,
                    requireProjectId: true,
                    requireWorkspaceId: true,
                    requireOrgData: true,
                })
                const path = buildPostLoginPath(context)
                const basePath = path.replace("/apps", "")
                router.push(`${basePath}/${destination}`)
            } catch (e) {
                console.error("Failed to resolve workspace context", e)
                router.push("/apps")
            }
        },
        [router],
    )

    if (view === "trace") {
        return (
            <div className="w-full max-w-[800px] mx-auto p-6 bg-[var(--ant-color-bg-container)] rounded-lg border border-[var(--ant-color-border-secondary)] mb-10">
                <SetupTracingModalContent
                    classes={tracingClasses}
                    onCancel={() => {}}
                    isModal={false}
                    isPostLogin={true}
                />
                <div className="flex justify-between mt-6">
                    <Button type="text" icon={<ArrowLeft />} onClick={() => setView("selection")}>
                        Back
                    </Button>
                    <Button type="primary" onClick={() => handleNext("observability")}>
                        Next
                    </Button>
                </div>
            </div>
        )
    }

    if (view === "eval") {
        return (
            <div className="w-full max-w-[800px] mx-auto p-6 bg-[var(--ant-color-bg-container)] rounded-lg border border-[var(--ant-color-border-secondary)] mb-10">
                <RunEvaluationView />
                <div className="flex justify-between mt-6">
                    <Button type="text" icon={<ArrowLeft />} onClick={() => setView("selection")}>
                        Back
                    </Button>
                    <Button
                        type="primary"
                        onClick={() =>
                            handleNext("evaluations?selectedEvaluation=custom_evaluation")
                        }
                    >
                        Next
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-10 px-5 py-10">
            <Title level={2}>How would you like to start?</Title>

            <div className="flex gap-6 flex-wrap justify-center">
                <Card
                    className="w-[300px] h-[300px] cursor-pointer transition-all duration-200 hover:border-[var(--ant-color-primary)] hover:shadow-md [&_.ant-card-body]:flex [&_.ant-card-body]:flex-col [&_.ant-card-body]:items-center [&_.ant-card-body]:p-0 [&_.ant-card-body]:h-full [&_.ant-card-body]:w-full"
                    onClick={() => handleSelection("trace")}
                >
                    <div className="h-1/2 w-full flex items-end justify-center pb-6">
                        <TreeView size={48} />
                    </div>
                    <div className="h-1/2 w-full px-6 py-3 flex flex-col items-center">
                        <div className="text-lg font-semibold mb-2">Trace your application</div>
                        <div className="text-[var(--ant-color-text-secondary)] text-sm leading-relaxed">
                            Monitor and debug your application.
                        </div>
                    </div>
                </Card>

                <Card
                    className="w-[300px] h-[300px] cursor-pointer transition-all duration-200 hover:border-[var(--ant-color-primary)] hover:shadow-md [&_.ant-card-body]:flex [&_.ant-card-body]:flex-col [&_.ant-card-body]:items-center [&_.ant-card-body]:p-0 [&_.ant-card-body]:h-full [&_.ant-card-body]:w-full"
                    onClick={() => handleSelection("test_prompt")}
                >
                    <div className="h-1/2 w-full flex items-end justify-center pb-6">
                        <Rocket size={48} />
                    </div>
                    <div className="h-1/2 w-full px-6 py-3 flex flex-col items-center">
                        <div className="text-lg font-semibold mb-2">Create and test prompts</div>
                        <div className="text-[var(--ant-color-text-secondary)] text-sm leading-relaxed">
                            Manage and test prompts across models
                        </div>
                    </div>
                </Card>

                <Card
                    className="w-[300px] h-[300px] cursor-pointer transition-all duration-200 hover:border-[var(--ant-color-primary)] hover:shadow-md [&_.ant-card-body]:flex [&_.ant-card-body]:flex-col [&_.ant-card-body]:items-center [&_.ant-card-body]:p-0 [&_.ant-card-body]:h-full [&_.ant-card-body]:w-full"
                    onClick={() => handleSelection("eval")}
                >
                    <div className="h-1/2 w-full flex items-end justify-center pb-6">
                        <Code size={48} />
                    </div>
                    <div className="h-1/2 w-full px-6 py-3 flex flex-col items-center">
                        <div className="text-lg font-semibold mb-2">Run an evaluation from SDK</div>
                        <div className="text-[var(--ant-color-text-secondary)] text-sm leading-relaxed">
                            Evaluate complex AI apps to compare changes and ensure they are
                            reliable.
                        </div>
                    </div>
                </Card>
            </div>

            <Button type="link" onClick={navigateToDestination}>
                Skip
            </Button>
        </div>
    )
}

export default GetStarted
