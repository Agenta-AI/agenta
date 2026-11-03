import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@agenta/ui/ui"
import {Table2} from "lucide-react"

/** The project has no testsets at all. Offers the way to make one, to a reader who may. */
export const TestsetsEmpty = ({onCreate}: {onCreate?: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Table2 />
            </EmptyMedia>
            <EmptyTitle className="text-foreground">No test sets yet</EmptyTitle>
            <EmptyDescription>
                Create one from a file, from scratch or with the API.
            </EmptyDescription>
        </EmptyHeader>
        {onCreate ? (
            <EmptyContent>
                <Button size="sm" onClick={onCreate}>
                    Create new testset
                </Button>
            </EmptyContent>
        ) : null}
    </Empty>
)
