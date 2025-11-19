import {Button} from "antd"

const AnnotateActionButton = ({onClick}: {onClick: () => void}) => (
    <Button size="small" type="default" onClick={onClick}>
        Annotate
    </Button>
)

export default AnnotateActionButton
