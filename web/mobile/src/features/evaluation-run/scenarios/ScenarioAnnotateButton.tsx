import {Button} from "@agenta/ui/ui"

/** A row's Annotate action. The click stays on the button, so the row does not open too. */
export const ScenarioAnnotateButton = ({onClick}: {onClick: () => void}) => (
    <span className="flex items-center">
        <Button
            variant="outline"
            size="sm"
            onClick={(event) => {
                event.stopPropagation()
                onClick()
            }}
        >
            Annotate
        </Button>
    </span>
)
