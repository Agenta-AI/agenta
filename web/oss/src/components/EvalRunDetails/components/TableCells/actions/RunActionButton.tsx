import {MouseEvent} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"

interface RunActionButtonProps {
    onClick: () => void
    loading?: boolean
}

const RunActionButton = ({onClick, loading}: RunActionButtonProps) => {
    const handleClick = (e: MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        onClick()
    }

    return (
        <Button onClick={handleClick} disabled={loading || loading} variant="outline" size="sm">
            {loading ? <Spinner /> : null}
            Run
        </Button>
    )
}

export default RunActionButton
