// SubNavigation.tsx

import React from 'react';
import { Tabs } from 'antd';

const { TabPane } = Tabs;

const SubNavigation: React.FC = () => {
    return (
        <Tabs defaultActiveKey="1">
            <TabPane tab="Parameters/Prompts" key="1">
                Content of Parameters/Prompts
            </TabPane>
            <TabPane tab="Chat" key="2">
                Content of Chat
            </TabPane>
        </Tabs>
    );
};

export default SubNavigation;
