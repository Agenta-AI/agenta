import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import {Alert, AlertTitle} from "@agenta/primitive-ui/components/alert"
import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {WarningCircle} from "@phosphor-icons/react"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {Empty} from "antd"
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
    if (error)
        return (
            <Alert variant="destructive" icon={<WarningCircle size={16} />}>
                <AlertTitle>Failed to load records</AlertTitle>
            </Alert>
        )

    const records = data?.records ?? []
    if (!records.length) return <Empty description="No record events yet" />

    return (
        <>
            <Accordion
                multiple
                className="[&_[data-slot=accordion-trigger]]:!py-1.5 [&_[data-slot=accordion-content]>div]:!pt-1 [&_[data-slot=accordion-content]>div]:!pb-1.5"
            >
                {records.map((event) => (
                    <AccordionItem value={event.record_id} key={event.record_id}>
                        <AccordionTrigger>
                            <span className="flex items-center gap-2">
                                <Badge variant="secondary">{event.record_index ?? "—"}</Badge>
                                <span>{event.record_source ?? "record"}</span>
                                {event.record_type ? (
                                    <Badge variant="info">{event.record_type}</Badge>
                                ) : null}
                            </span>
                        </AccordionTrigger>
                        <AccordionContent>
                            <pre className="m-0 max-h-[40vh] overflow-auto text-xs">
                                {JSON.stringify(event.attributes ?? {}, null, 2)}
                            </pre>
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
            <div className="mt-2">
                <Button onClick={refresh} variant="ghost">
                    Refresh
                </Button>
            </div>
        </>
    )
}

export default RecordsTab
