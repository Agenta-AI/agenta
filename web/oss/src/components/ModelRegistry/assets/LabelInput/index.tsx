import {Input} from "antd"
import clsx from "clsx"

import {LabelInputProps} from "./types"

const LabelInput = ({label, className, ...props}: LabelInputProps) => {
    return (
        <div className="rounded-lg border border-solid border-[#BDC7D1] p-1 pl-2.5">
            <span className="font-medium">{label}</span>
            <Input variant="borderless" className={clsx("px-0 rounded-none", className)} {...props} />
        </div>
    )
}

export default LabelInput
