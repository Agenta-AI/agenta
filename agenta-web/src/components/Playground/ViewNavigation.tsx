// SubNavigation.tsx
import { useState } from 'react';
import React from 'react';
import { Tabs, Input, Select, Slider, Row, Col, Button } from 'antd';
import TestView from './Views/TestView';
import LogsView from './Views/LogsView';
import ParametersView from './Views/ParametersView';
const { TabPane } = Tabs;
const { Option } = Select;


const ViewNavigation: React.FC = () => {
    const [inputValue, setInputValue] = useState(1);
    const onChange = (newValue: number) => {
        setInputValue(newValue);
    };

    return (
        <Tabs defaultActiveKey="1">
            <TabPane tab="Parameters" key="1">
                <ParametersView />
            </TabPane>
            <TabPane tab="Test" key="2">
                <TestView />
            </TabPane>
            <TabPane tab="Logs" key="3">
                <LogsView />
            </TabPane>

        </Tabs>
    );
};

export default ViewNavigation;

