// SubNavigation.tsx
import { useState } from 'react';
import React from 'react';
import { Tabs, Input, Select, Slider, Row, Col } from 'antd';
import Chat from './Chat';
const { TabPane } = Tabs;
const { Option } = Select;

const SubNavigation: React.FC = () => {
    const [inputValue, setInputValue] = useState(1);
    const onChange = (newValue: number) => {
        setInputValue(newValue);
    };

    return (
        <Tabs defaultActiveKey="1">
            <TabPane tab="Parameters/Prompts" key="1">
                <Row gutter={16}>
                    <Col span={12}>
                        <h3>Prompts</h3>
                        <Input.TextArea rows={5} defaultValue="Summarize each of the following text. Make sure to take into account the following context of the task {{context}}" />
                        <Input.TextArea rows={5} defaultValue="Make a scaffold for a blog post based on the following summary: {{summary}}>>" style={{ marginTop: 16 }} />
                        <Input.TextArea rows={5} defaultValue="Write a blog post based on the following scaffold and summary {{scaffold}}" style={{ marginTop: 16 }} />
                    </Col>
                    <Col span={12}>
                        <h3>Parameters</h3>
                        <h5>Mode</h5>
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
                        </Select>

                        <h5>Temperature</h5>
                        <Slider
                            min={0}
                            max={1}
                            efaultValue={0.5}
                            onChange={onChange}
                            value={typeof inputValue === 'number' ? inputValue : 0}
                            step={0.01}
                            style={{ marginBottom: 16 }}
                        />

                    </Col>
                </Row>
            </TabPane>
            <TabPane tab="Chat" key="2">
                <Chat />
            </TabPane>
        </Tabs>
    );
};

export default SubNavigation;

