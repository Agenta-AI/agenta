import {useCallback, useEffect} from "react"

import {ArrowClockwise, GridFour, Scales} from "@phosphor-icons/react"
import {Button, Card, Space, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {appIdentifiersAtom} from "@/oss/state/appState"

const {Title, Paragraph, Text} = Typography

interface WorkflowNotFoundProps {
    /** The bad workflow ID from the URL — may be null if URL had no ID. */
    workflowId: string | null
    /** Which sub-route segment the user landed on (for telemetry). */
    routeSegment?: string
}

/**
 * Per-tab dedup of `workflow_not_found` telemetry events. Module-level Set
 * persists across page navigations within the tab; cleared on full reload.
 *
 * Behavior (per eng review decision 1.3): a user bouncing between 3 dead
 * bookmarks fires 3 events; revisiting the same dead ID fires once.
 */
const firedTelemetryKeys = new Set<string>()

function truncateId(id: string | null): string {
    if (!id) return "(no id)"
    if (id.length <= 16) return id
    return `${id.slice(0, 8)}…${id.slice(-4)}`
}

function WorkflowNotFound({workflowId, routeSegment}: WorkflowNotFoundProps) {
    const router = useRouter()
    const posthog = usePostHogAg()
    const {workspaceId, projectId} = useAtomValue(appIdentifiersAtom)

    // Fire telemetry once per (workflowId, routeSegment) per tab session.
    useEffect(() => {
        const dedupKey = `${workflowId ?? "no-id"}|${routeSegment ?? "unknown"}`
        if (firedTelemetryKeys.has(dedupKey)) return
        firedTelemetryKeys.add(dedupKey)
        posthog?.capture?.("workflow_not_found", {
            workflow_id: workflowId,
            route_segment: routeSegment,
        })
        if (process.env.NODE_ENV !== "production") {
            console.warn(
                `[workflow-not-found] id=${workflowId ?? "(none)"} route=${routeSegment ?? "(unknown)"}`,
            )
        }
    }, [workflowId, routeSegment, posthog])

    const buildBaseUrl = useCallback(() => {
        if (!workspaceId || !projectId) return null
        return `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}`
    }, [workspaceId, projectId])

    const handleBackToApps = useCallback(() => {
        const base = buildBaseUrl()
        router.replace(base ? `${base}/apps` : "/apps")
    }, [buildBaseUrl, router])

    const handleBackToEvaluators = useCallback(() => {
        const base = buildBaseUrl()
        router.replace(base ? `${base}/evaluators` : "/evaluators")
    }, [buildBaseUrl, router])

    const handleReload = useCallback(() => {
        router.reload()
    }, [router])

    return (
        <div className="flex flex-col grow h-full overflow-hidden items-center justify-center p-6">
            <Card className="max-w-[520px] w-[90%]">
                <Space direction="vertical" className="w-full" size="middle">
                    <Title level={3} className="!mb-0">
                        Workflow not found
                    </Title>
                    <Paragraph className="!mb-0" type="secondary">
                        The workflow you tried to open isn’t available anymore. It may have been
                        deleted, archived, or the link is no longer valid.
                    </Paragraph>
                    <Text type="secondary" className="text-xs">
                        ID:&nbsp;<code>{truncateId(workflowId)}</code>
                    </Text>
                    <Space wrap>
                        <Button
                            type="primary"
                            icon={<GridFour size={14} />}
                            onClick={handleBackToApps}
                        >
                            Back to apps
                        </Button>
                        <Button icon={<Scales size={14} />} onClick={handleBackToEvaluators}>
                            Back to evaluators
                        </Button>
                        <Button icon={<ArrowClockwise size={14} />} onClick={handleReload}>
                            Reload
                        </Button>
                    </Space>
                </Space>
            </Card>
        </div>
    )
}

export default WorkflowNotFound
