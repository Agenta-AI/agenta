import clsx from "clsx"
import {Input} from "antd"

const {TextArea} = Input

interface PromptMessageContentProps {
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
}

const PromptMessageContent = ({value, placeholder, onChange}: PromptMessageContentProps) => {
    return (
        <TextArea
            rows={4}
            autoSize={{
                minRows: 4,
            }}
            placeholder={placeholder}
            className={clsx(["border-0", "focus:ring-0"])}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    )
}

export default PromptMessageContent
