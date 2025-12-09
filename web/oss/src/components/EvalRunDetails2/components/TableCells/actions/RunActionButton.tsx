import {MouseEvent} from "react"

import {Button} from "antd"

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
        <Button
            size="small"
            type="default"
            onClick={handleClick}
            loading={loading}
            disabled={loading}
        >
            Run
        </Button>
    )
}

export default RunActionButton
