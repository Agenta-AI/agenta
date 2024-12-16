import {type ChangeEvent, memo, useState, useMemo} from "react"
import clsx from "clsx"
import {CaretUpDown} from "@phosphor-icons/react"
import {Input, Button, Dropdown} from "antd"

const {TextArea} = Input

const PromptInput = ({
    value,
    title,
    onChange,
    options = ["User", "System"],
}: {
    value: string
    title: string
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void
    type?: string
    options?: string[]
}) => {
    const [selected, setSelected] = useState(options[0])

    const items = useMemo(
        () =>
            options.map((opt) => ({
                key: opt,
                label: opt,
                onClick: () => setSelected(opt),
            })),
        [options],
    )

    return (
        <div className="relative border-solid border border-[#bdc7d1] rounded-[theme(spacing.2)]">
            <Dropdown menu={{items}} trigger={["click"]}>
                <Button
                    className={clsx([
                        "rounded-md",
                        "bg-white",
                        "mt-1 mx-2 px-2",
                        "border-0",
                        "flex items-center",
                    ])}
                >
                    {selected}
                    <CaretUpDown size={14} />
                </Button>
            </Dropdown>
            <TextArea
                rows={4}
                autoSize={{
                    minRows: 4,
                }}
                placeholder={title}
                className={clsx(["border-0", "focus:ring-0"])}
                value={value}
                onChange={onChange}
            />
        </div>
    )
}

export default memo(PromptInput)
