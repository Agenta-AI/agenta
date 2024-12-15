import {memo, useMemo} from "react"
import {Select, Typography} from "antd"
import type {SelectProps} from "antd"

type BaseOption = {
    label: string;
    value: string;
}

type GroupedOptions = {
    label: string;
    options: BaseOption[];
}

type Options = BaseOption[] | Record<string, string[]>;

interface SelectControlProps {
    mode?: SelectProps["mode"]
    label: string
    options: Options
    value?: string | string[]
    onChange?: (value: string | string[]) => void
}

const SelectControl = ({
    mode,
    label,
    options: _options,
    value,
    onChange,
}: SelectControlProps) => {
    const options = useMemo((): (BaseOption | GroupedOptions)[] => {
        if (!_options) return []
        if (Array.isArray(_options)) {
            return _options
        }
        return Object.keys(_options).map((group) => ({
            label: group,
            options: _options[group].map((option) => ({
                value: option,
                label: option,
            })),
        }))
    }, [_options])

    return (
        <div className="flex flex-col gap-2 mb-[13px]">
            <Typography.Text>{label}</Typography.Text>
            <Select<string | string[]>
                mode={mode}
                value={value}
                onChange={onChange}
                options={options}
            />
        </div>
    )
}

export default memo(SelectControl)
