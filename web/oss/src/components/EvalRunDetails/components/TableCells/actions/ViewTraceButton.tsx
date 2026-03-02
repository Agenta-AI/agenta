import {Button} from "antd"

const ViewTraceButton = ({onClick, disabled}: {onClick: () => void; disabled?: boolean}) => (
    <Button
        size="small"
        type="default"
        onClick={onClick}
        disabled={disabled}
        className="!border !border-neutral-300 !px-3 !py-0"
    >
        View trace
    </Button>
)

export default ViewTraceButton
