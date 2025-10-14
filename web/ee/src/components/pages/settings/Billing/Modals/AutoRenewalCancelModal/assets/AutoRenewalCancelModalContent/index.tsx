import {memo} from "react"

import {Input, Radio, Typography} from "antd"

import {CANCEL_REASONS} from "../constants"
import {AutoRenewalCancelModalContentProps} from "../types"

const AutoRenewalCancelModalContent = ({
    inputValue,
    onChangeInput,
    ...props
}: AutoRenewalCancelModalContentProps) => {
    const _value = props.value
    return (
        <section className="flex flex-col gap-2 mt-5">
            <Typography.Text className=" font-medium">
                Please select one of the reasons
            </Typography.Text>
            <Radio.Group value={_value} {...props} className="flex flex-col gap-2">
                {CANCEL_REASONS.map((option) => (
                    <Radio value={option.value} key={option.value}>
                        {option.label}
                    </Radio>
                ))}
            </Radio.Group>
            {_value === "something-else" && (
                <Input placeholder="Type here" value={inputValue} onChange={onChangeInput} />
            )}
        </section>
    )
}

export default memo(AutoRenewalCancelModalContent)
