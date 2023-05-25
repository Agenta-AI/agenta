import { useState } from 'react';
import React from 'react';
import { Parameter } from '@/services/api';
import { Input, Slider, Row, Col, InputNumber } from 'antd';

interface Props {
    optParams: Parameter[] | null;  // The optional parameters
    onOptParamsChange: (newOptParams: Parameter[], persist: boolean) => void;
}

const ParametersView: React.FC<Props> = ({ optParams, onOptParamsChange }) => {
    const [inputValue, setInputValue] = useState(1);
    const onChange = (param: Parameter, newValue: number) => {
        setInputValue(newValue);
        handleParamChange(param.name, newValue)
    };
    const handleParamChange = (name: string, newVal: any) => {
        const newOptParams = optParams?.map(param =>
            param.name === name ? { ...param, default: newVal } : param);
        newOptParams && onOptParamsChange(newOptParams, false)
    }
    return (
        <Row gutter={16}>
            <Col span={12}>
                {optParams?.filter(param => (param.type === 'string')).map((param, index) => (
                    <div key={index}>
                        <h3>{param.name}</h3>

                        <Input.TextArea rows={5}
                            defaultValue={param.default}
                            onChange={e => handleParamChange(param.name, e.target.value)}
                        />
                    </div>
                ))}
            </Col>

            <Col span={12}>
                {optParams?.filter(param => (!param.input) && (param.type === 'number')).map((param, index) => (
                    <div key={index}>
                        <h3>{param.name}</h3>
                        <Row>
                            <Col span={12}>
                                <Slider
                                    min={0}
                                    max={1}
                                    value={typeof param.default === 'number' ? param.default : 0}
                                    step={0.01}
                                    onChange={value => onChange(param, value)}
                                    style={{ marginBottom: 16 }}
                                />
                            </Col>
                            <Col span={4}>
                                <InputNumber
                                    min={1}
                                    max={20}
                                    style={{ margin: '0 16px' }}
                                    value={param.default}
                                    onChange={(value) => onChange(param, value)}
                                />
                            </Col>
                        </Row>
                    </div>
                ))}
            </Col>


        </Row>
    );
};
export default ParametersView;