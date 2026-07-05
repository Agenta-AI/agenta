import {Button} from "@agenta/primitive-ui/components/button"

const AnnotateActionButton = ({onClick}: {onClick: () => void}) => (
    <Button
        data-ivt-stop-row-click
        onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClick()
        }}
        variant="outline"
        size="sm"
    >
        Annotate
    </Button>
)

export default AnnotateActionButton
