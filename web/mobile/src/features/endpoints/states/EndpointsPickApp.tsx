import {Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {PlugsIcon} from "@phosphor-icons/react"

/** No app chosen yet: the page cannot show an endpoint until the reader picks one. */
export const EndpointsPickApp = () => (
    <Empty className="py-14" data-testid="endpoints-pick-app">
        <EmptyHeader>
            <EmptyMedia variant="icon">
                <PlugsIcon />
            </EmptyMedia>
            <EmptyTitle>Pick an app</EmptyTitle>
            <EmptyDescription>Choose an app to see how to call it.</EmptyDescription>
        </EmptyHeader>
    </Empty>
)
