import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {ArrowUpRight, ClipboardList, Plus} from "lucide-react"

const DOCS_URL = "https://docs.agenta.ai"

/** The project has no annotation queue and nothing narrows the list. */
export const QueuesFirstRun = ({onCreate}: {onCreate?: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <ClipboardList />
            </EmptyMedia>
            <EmptyTitle>Create your first annotation queue</EmptyTitle>
            <EmptyDescription>
                Route trace and test case reviews into a shared queue, assign work, and keep
                annotation progress visible in one place.
            </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center gap-2">
            {onCreate ? (
                <Button size="sm" onClick={onCreate}>
                    <Plus aria-hidden />
                    New Queue
                </Button>
            ) : null}
            <Button size="sm" variant="outline" asChild>
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                    Learn More
                    <ArrowUpRight aria-hidden />
                </a>
            </Button>
        </EmptyContent>
    </Empty>
)
