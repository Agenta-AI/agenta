import {Select, Form} from 'antd'
import type {CompoundOption} from '../../../hooks/usePlayground/types'

interface CompoundControlProps {
    value: any
    options: CompoundOption[]
    onChange: (value: any) => void
    nullable?: boolean
    placeholder?: string
}

const CompoundControl: React.FC<CompoundControlProps> = ({
    value,
    options,
    onChange,
    nullable,
    placeholder
}) => {
    const handleChange = (selectedValue: string) => {
        const option = options.find(opt => opt.value === selectedValue)
        onChange(option ? { type: selectedValue, ...option.config } : null)
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
