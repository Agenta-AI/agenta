import { useState } from 'react';
import React from 'react';
import { Tabs, Input, Select, Slider, Row, Col } from 'antd';
const ParametersView: React.FC = () => {
    const { TabPane } = Tabs;
    const { Option } = Select;
    const [inputValue, setInputValue] = useState(1);
    const onChange = (newValue: number) => {
        setInputValue(newValue);
    };

    return (
        <Row gutter={16}>
            <Col span={12}>
                <h3>Prompts</h3>
                <Input.TextArea rows={5} defaultValue="please write a short linkedin message (2 SENTENCES MAX) to an investor pitchin the following startup:
    startup name: {startup_name}
    startup idea: {startup_idea}" />
            </Col>
            <Col span={12}>
                <h3>Parameters</h3>
                {/* <h5>Mode</h5>
                <Select defaultValue="complete" style={{ width: '100%', marginBottom: 16 }}>
                    <Option value="complete">Complete</Option>
                    <Option value="chat">Chat</Option>
                </Select>
                <h5>Model</h5>
                <Select defaultValue="text-davinci-003" style={{ width: '100%', marginBottom: 16 }}>
                    <Option value="text-davinci-003">text-davinci-003</Option>
                    <Option value="text-curie-001">text-curie-001</Option>
                </Select>
                <h5>Processing Technique</h5>
                <Select defaultValue="map-reduce" style={{ width: '100%', marginBottom: 16 }}>
                    <Option value="map-reduce">map-reduce</Option>
                    <Option value="stuffing">stuffing</Option>
                </Select> */}

                <h5>Temperature</h5>
                <Slider
                    min={0}
                    max={1}
                    efaultValue={0.9}
                    onChange={onChange}
                    value={typeof inputValue === 'number' ? inputValue : 0}
                    step={0.01}
                    style={{ marginBottom: 16 }}
                />

            </Col>
        </Row>
    );
};
export default ParametersView;