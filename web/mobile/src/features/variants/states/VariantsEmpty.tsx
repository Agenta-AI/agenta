import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {GitBranch} from "lucide-react"

/** The app has no revision above version 0. */
export const VariantsEmpty = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <GitBranch />
            </EmptyMedia>
            <EmptyTitle>No variants available</EmptyTitle>
            <EmptyDescription>This app has no committed revisions yet.</EmptyDescription>
        </EmptyHeader>
    </Empty>
)
