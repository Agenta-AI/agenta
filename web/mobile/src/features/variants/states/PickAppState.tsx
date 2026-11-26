import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {GitBranch} from "lucide-react"

/** No app is chosen yet. */
export const PickAppState = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <GitBranch />
            </EmptyMedia>
            <EmptyTitle>Pick an app</EmptyTitle>
            <EmptyDescription>Choose an app to see its variants.</EmptyDescription>
        </EmptyHeader>
    </Empty>
)
