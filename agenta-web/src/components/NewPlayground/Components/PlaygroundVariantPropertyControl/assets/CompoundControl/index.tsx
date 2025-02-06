import {Select, Form} from "antd"
import {CompoundControlProps} from "./types"

const CompoundControl: React.FC<CompoundControlProps> = ({
    value,
    options,
    onChange,
    nullable,
    placeholder,
}) => {
    const handleChange = (selectedValue: string) => {
        const option = options.find((opt) => opt.value === selectedValue)
        onChange(option ? {...option.config, type: selectedValue} : null)
    }

    return (
        <Form.Item>
            <Select
                value={value?.type}
                onChange={handleChange}
                options={options}
                allowClear={nullable}
                placeholder={placeholder}
            />
            {/* Additional configuration UI based on selected type can be added here */}
        </Form.Item>
    )
}

export default CompoundControl
