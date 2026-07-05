import {Button} from "@agenta/primitive-ui/components/button"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Alert, Collapse, Empty, Tag} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {fetchRecords} from "../api"

const RecordsTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useQueryClient()

    const queryKey = ["session-inspector", "records", projectId, sessionId]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchRecords(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    const refresh = () => queryClient.invalidateQueries({queryKey})

    if (isLoading)
        return (
            <div className="flex w-full flex-col gap-3">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/5" />
            </div>
        )
    if (error) return <Alert type="error" message="Failed to load records" showIcon />

    const records = data?.records ?? []
    if (!records.length) return <Empty description="No record events yet" />

    return (
        <>
            <Collapse
                size="small"
                items={records.map((event) => ({
                    key: event.record_id,
                    label: (
                        <span className="flex items-center gap-2">
                            <Tag>{event.record_index ?? "—"}</Tag>
                            <span>{event.record_source ?? "record"}</span>
                            {event.record_type ? <Tag color="blue">{event.record_type}</Tag> : null}
                        </span>
                    ),
                    children: (
                        <pre className="m-0 max-h-[40vh] overflow-auto text-xs">
                            {JSON.stringify(event.attributes ?? {}, null, 2)}
                        </pre>
                    ),
                }))}
            />
            <div className="mt-2">
                <Button onClick={refresh} variant="ghost">
                    Refresh
                </Button>
            </div>
        </>
    )
}

export default RecordsTab
