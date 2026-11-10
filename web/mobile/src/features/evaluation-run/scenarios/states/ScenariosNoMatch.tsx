import {Button, Empty, EmptyContent, EmptyHeader, EmptyTitle} from "@agenta/ui/ui"

/** The filter matches no loaded scenario, and no pages remain to look in. */
export const ScenariosNoMatch = ({onClear}: {onClear: () => void}) => (
    <Empty className="py-14">
        <EmptyHeader>
            <EmptyTitle>No scenarios match this filter</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
            <Button size="sm" variant="outline" onClick={onClear}>
                Clear filter
            </Button>
        </EmptyContent>
    </Empty>
)
