import {useMemo} from "react"

import {AnnotationUIProvider, type AnnotationUINavigation} from "@agenta/annotation-ui/context"
import AnnotationQueuesView from "@agenta/annotation-ui/queue-list"
import {PageLayout} from "@agenta/ui"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

const AnnotationQueuesPage = () => {
    const router = useRouter()
    const {projectURL} = useURL()

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

    return (
        <AnnotationUIProvider navigation={navigation}>
            <PageLayout
                title={<span className="inline-flex items-center gap-2">Queues</span>}
                className="h-full min-h-0"
            >
                <AnnotationQueuesView />
            </PageLayout>
        </AnnotationUIProvider>
    )
}

export default AnnotationQueuesPage
