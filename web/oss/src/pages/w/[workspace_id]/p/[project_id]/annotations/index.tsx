import {useEffect, useMemo, useState, useTransition} from "react"

import {AnnotationUIProvider, type AnnotationUINavigation} from "@agenta/annotation-ui/context"
import AnnotationQueuesView from "@agenta/annotation-ui/queue-list"
import AnnotationTasksView from "@agenta/annotation-ui/tasks"
import {PageLayout} from "@agenta/ui"
import {ClipboardText, Queue} from "@phosphor-icons/react"
import type {TabsProps} from "antd"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {useQueryParamState} from "@/oss/state/appState"

type AnnotationTabKey = "queues" | "tasks"

const TAB_CONTENT_SWITCH_DELAY_MS = 220

const TAB_ITEMS: {key: AnnotationTabKey; label: string; icon: React.ReactNode}[] = [
    {key: "queues", label: "Queues", icon: <Queue />},
    {key: "tasks", label: "Tasks", icon: <ClipboardText />},
]

const AnnotationQueuesPage = () => {
    const router = useRouter()
    const {projectURL} = useURL()

    const [tabParam, setTabParam] = useQueryParamState("tab", "queues")
    const [isPending, startTransition] = useTransition()
    const [displayedTab, setDisplayedTab] = useState<AnnotationTabKey>(
        ((Array.isArray(tabParam) ? tabParam[0] : tabParam) as AnnotationTabKey) ?? "queues",
    )

    const activeTab = useMemo<AnnotationTabKey>(() => {
        const value = Array.isArray(tabParam) ? tabParam[0] : tabParam
        return (value as AnnotationTabKey) ?? "queues"
    }, [tabParam])

    useEffect(() => {
        if (activeTab === displayedTab || isPending) return
        const handle = window.setTimeout(
            () => setDisplayedTab(activeTab),
            TAB_CONTENT_SWITCH_DELAY_MS,
        )
        return () => window.clearTimeout(handle)
    }, [activeTab, displayedTab, isPending])

    const navigation = useMemo<AnnotationUINavigation>(
        () => ({
            navigateToQueue: (queueId: string) =>
                router.push(`${projectURL}/annotations/${queueId}`),
            navigateToQueueList: () => router.push(`${projectURL}/annotations`),
            navigateToResults: (runId: string) =>
                router.push(`${projectURL}/evaluations/results/${runId}`),
        }),
        [router, projectURL],
    )

    const tabItemsWithIcons = useMemo(
        () =>
            TAB_ITEMS.map((item) => ({
                key: item.key,
                label: (
                    <span className="inline-flex items-center gap-2">
                        {item.icon}
                        {item.label}
                    </span>
                ),
            })),
        [],
    )

    const headerTabsProps = useMemo<TabsProps>(
        () => ({
            className: "[&_.ant-tabs-nav]:mb-0",
            activeKey: activeTab,
            items: tabItemsWithIcons,
            onChange: (key) => {
                startTransition(() => {
                    setTabParam(key)
                })
            },
            destroyOnHidden: true,
        }),
        [activeTab, setTabParam, startTransition, tabItemsWithIcons],
    )

    return (
        <AnnotationUIProvider navigation={navigation}>
            <PageLayout
                title="Annotation queue"
                headerTabsProps={headerTabsProps}
                className="h-full min-h-0"
            >
                {displayedTab === "queues" && <AnnotationQueuesView />}
                {displayedTab === "tasks" && <AnnotationTasksView />}
            </PageLayout>
        </AnnotationUIProvider>
    )
}

export default AnnotationQueuesPage
