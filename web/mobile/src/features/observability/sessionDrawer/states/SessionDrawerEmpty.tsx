import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {Activity} from "lucide-react"

/** A session id the project has no traces for: an old or wrong link. */
export const SessionDrawerEmpty = () => (
    <Empty className="py-16">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <Activity />
            </EmptyMedia>
            <EmptyTitle>No traces in this session</EmptyTitle>
        </EmptyHeader>
    </Empty>
)
