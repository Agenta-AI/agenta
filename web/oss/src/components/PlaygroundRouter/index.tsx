import {memo, useEffect, useMemo, useRef} from "react"

import {
    hasFullPagePlaygroundUX,
    workflowLatestRevisionIdAtomFamily,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {bgColors} from "@agenta/ui"
import {DownOutlined} from "@ant-design/icons"
import {Flask, Plus} from "@phosphor-icons/react"
import {Button, Space, Typography} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {appIdentifiersAtom} from "@/oss/state/appState"
import {currentWorkflowAtom, currentWorkflowContextAtom} from "@/oss/state/workflow"

const PlaygroundLoadingShell = () => {
    return (
        <div className="flex flex-col w-full h-[calc(100dvh-75px)] overflow-hidden">
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

/**
 * Stale-URL guard for evaluator playgrounds. Most evaluators (classifiers,
 * matchers, JSON validators, …) have no meaningful full-page playground UX —
 * just a handful of form fields the drawer already renders. When the
 * resolved workflow is one of those evaluators, redirect to the evaluators
 * registry with the revision pre-selected so the drawer opens automatically.
 * Prompt/code-authored evaluators (auto_ai_critique, llm, code) are kept on
 * the playground page.
 *
 * Classification source: the workflow LIST entry has no `data.uri` (data is
 * only populated on revision-detail responses), so we resolve the latest
 * revision via `workflowLatestRevisionIdAtomFamily` and read its seeded
 * entity from the molecule to get the URI. Without this, every evaluator
 * playground briefly looks "unknown" and the guard would mis-redirect
 * prompt-based evaluators like LLM-as-a-judge.
 */
const useEvaluatorPlaygroundGuard = () => {
    const ctx = useAtomValue(currentWorkflowContextAtom)
    const workflow = useAtomValue(currentWorkflowAtom)
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)
    const router = useRouter()
    const redirectedFor = useRef<string | null>(null)

    const workflowId = ctx.workflowId ?? ""
    const latestRevisionId = useAtomValue(
        useMemo(() => workflowLatestRevisionIdAtomFamily(workflowId), [workflowId]),
    )

    useEffect(() => {
        if (ctx.isResolving || ctx.isError || ctx.isNotFound) return
        if (ctx.workflowKind !== "evaluator") return
        if (!workflow || !ctx.workflowId) return
        if (!workspaceId || !projectId) return
        if (redirectedFor.current === ctx.workflowId) return

        // Resolve the latest revision data — it carries `data.uri` and the
        // URI-derived flags (`is_llm`, `is_code`) that classifier vs prompt
        // evaluators differ on. The workflow list entry has neither.
        const latestRevision = latestRevisionId
            ? (workflowMolecule.get.data(latestRevisionId) as
                  | Parameters<typeof hasFullPagePlaygroundUX>[0]
                  | null)
            : null

        // Bail until we have a classifiable record. Redirecting on a half-
        // loaded workflow would bounce prompt-based evaluators (whose URI
        // hasn't been seeded yet) into the drawer mid-load.
        const hasUri = Boolean(latestRevision?.data?.uri)
        const hasTypeFlag = Boolean(
            latestRevision?.flags?.is_llm ||
            latestRevision?.flags?.is_code ||
            workflow.flags?.is_llm ||
            workflow.flags?.is_code,
        )
        if (!hasUri && !hasTypeFlag) return

        const classifyTarget = latestRevision ?? workflow
        if (hasFullPagePlaygroundUX(classifyTarget)) return

        const base = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}`
        const target = latestRevisionId
            ? `${base}/evaluators?revisionId=${encodeURIComponent(latestRevisionId)}`
            : `${base}/evaluators`

        redirectedFor.current = ctx.workflowId
        router.replace(target)
    }, [
        ctx.isResolving,
        ctx.isError,
        ctx.isNotFound,
        ctx.workflowKind,
        ctx.workflowId,
        workflow,
        latestRevisionId,
        workspaceId,
        projectId,
        router,
    ])
}

const PlaygroundRouter = () => {
    useEvaluatorPlaygroundGuard()
    return <Playground />
}

export default memo(PlaygroundRouter)
