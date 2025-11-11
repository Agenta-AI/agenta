import {PushPin, XCircle} from "@phosphor-icons/react"
import {Tag, TagProps} from "antd"
import clsx from "clsx"

interface EvalNameTagProps extends TagProps {
    name: string
    id?: string
    showClose?: boolean
    showPin?: boolean
    isBaseEval?: boolean
}
const EvalNameTag = ({
    name,
    id,
    showClose = false,
    showPin = false,
    isBaseEval = false,
    className,
    ...props
}: EvalNameTagProps) => {
    return (
        <Tag className={clsx("flex items-center gap-1 w-fit", className)} {...props}>
            {showPin && <PushPin size={12} />}
            {name}
            {showClose && <XCircle className="cursor-pointer ml-0.5" size={12} />}
        </Tag>
    )
}

export default EvalNameTag
