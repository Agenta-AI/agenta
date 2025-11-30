import {Button} from "antd"

const RunActionButton = ({onClick}: {onClick: () => void}) => (
    <Button size="small" type="default" onClick={onClick}>
        Run
    </Button>
)

export default RunActionButton
