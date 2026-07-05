import {Button} from "@agenta/primitive-ui/components/button"

const ViewTraceButton = ({onClick, disabled}: {onClick: () => void; disabled?: boolean}) => (
    <Button
        onClick={onClick}
        disabled={disabled}
        className="!border !border-neutral-300 !px-3 !py-0"
        variant="outline"
        size="sm"
    >
        View trace
    </Button>
)

export default ViewTraceButton
