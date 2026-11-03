import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {CloudArrowUp} from "@phosphor-icons/react"

/** The selected environment has never had this app deployed to it. */
export const DeploymentsEmpty = () => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <CloudArrowUp />
            </EmptyMedia>
            <EmptyTitle>No deployment history available</EmptyTitle>
            <EmptyDescription>Deploy a revision to see it here.</EmptyDescription>
        </EmptyHeader>
    </Empty>
)
