// VersionTabs.tsx

import React, { useState } from 'react';
import { Tabs } from 'antd';
import ViewNavigation from './ViewNavigation';
// import { VersionProvider, useVersionContext } from './VersionContext';

const { TabPane } = Tabs;

const VersionTabs: React.FC = () => {
    // const { versionState, setVersionState } = useVersionContext();
    const [activeKey, setActiveKey] = useState('1');
    const [tabList, setTabList] = useState(['1']);

    const addTab = () => {
        const newKey = (tabList.length + 1).toString();
        setTabList(prevState => [...prevState, newKey]);
        setActiveKey(newKey);
        // setVersionState(prevState => ({
        //     ...prevState,
        //     [newKey]: { parameters: {}, chat: {} },
        // }));
    };

    const removeTab = (targetKey) => {
        let newActiveKey = activeKey;
        let lastIndex;
        tabList.forEach((tab, i) => {
            if (tab === targetKey) {
                lastIndex = i - 1;
            }
        });
        const newTabList = tabList.filter(tab => tab !== targetKey);
        if (newTabList.length && newActiveKey === targetKey) {
            newActiveKey = newTabList[lastIndex >= 0 ? lastIndex : 0];
        }
        setTabList(newTabList);
        setActiveKey(newActiveKey);
        // setVersionState(prevState => {
        //     const newState = { ...prevState };
        //     delete newState[targetKey];
        //     return newState;
        // });
    };

    return (
        <Tabs
            type="editable-card"
            activeKey={activeKey}
            onChange={setActiveKey}
            onEdit={(targetKey, action) => {
                if (action === 'add') {
                    addTab();
                } else if (action === 'remove') {
                    removeTab(targetKey);
                }
            }}
        >
            {tabList.map(key => (
                <TabPane tab={`Version ${key}`} key={key} closable={tabList.length > 1}>
                    <ViewNavigation />
                </TabPane>
            ))}
        </Tabs>
    );
};

export default VersionTabs;
