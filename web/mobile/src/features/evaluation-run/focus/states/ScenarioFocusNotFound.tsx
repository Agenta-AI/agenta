import {Button, Empty, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"

/** The address names a scenario that is on no page of this evaluation. */
export const ScenarioFocusNotFound = ({onClose}: {onClose: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyTitle>This scenario is not in this evaluation</EmptyTitle>
        </EmptyHeader>
        <Button variant="outline" onClick={onClose}>
            Close
        </Button>
    </Empty>
)
