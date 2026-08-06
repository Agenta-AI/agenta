import {Button} from "antd"

const AnnotateActionButton = ({onClick}: {onClick: () => void}) => (
    <Button
        size="small"
        type="default"
        data-ivt-stop-row-click
        onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClick()
        }}
    >
        Annotate
    </Button>
)

export default AnnotateActionButton
