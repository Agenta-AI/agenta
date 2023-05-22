// VersionTabs.tsx

import React, { useState, useEffect } from 'react';
import { Tabs } from 'antd';
import ViewNavigation from './ViewNavigation';
import useSWR, { Fetcher } from 'swr';
import { useRouter } from 'next/router';

// import { VersionProvider, useVersionContext } from './VersionContext';
import AppContext from '@/contexts/appContext';

const { TabPane } = Tabs;
const fetcher = (...args) => fetch(...args).then(res => res.json());

function useParams(app_name: string) {

    const { data, error, isLoading } = useSWR(`http://localhost/api/app_variant/list_variants/?app_name=${app_name}`, fetcher)

    return {
        variants: data,
        isLoading,
        isError: error
    }
}

const VersionTabs: React.FC = () => {
    // const { versionState, setVersionState } = useVersionContext();
    const router = useRouter();
    const [activeKey, setActiveKey] = useState('1');
    const [tabList, setTabList] = useState(['1']);
    const { app } = React.useContext(AppContext);
    console.log("app", app, app == null, app == undefined, app == "");
    useEffect(() => {
        if (app == "") {
            router.push("/");
        }
    }, [app]);
    // const addTab = () => {
    //     const newKey = (tabList.length + 1).toString();
    //     setTabList(prevState => [...prevState, newKey]);
    //     setActiveKey(newKey);
    //     // setVersionState(prevState => ({
    //     //     ...prevState,
    //     //     [newKey]: { parameters: {}, chat: {} },
    //     // }));
    // };

    // const removeTab = (targetKey) => {
    //     let newActiveKey = activeKey;
    //     let lastIndex;
    //     tabList.forEach((tab, i) => {
    //         if (tab === targetKey) {
    //             lastIndex = i - 1;
    //         }
    //     });
    //     const newTabList = tabList.filter(tab => tab !== targetKey);
    //     if (newTabList.length && newActiveKey === targetKey) {
    //         newActiveKey = newTabList[lastIndex >= 0 ? lastIndex : 0];
    //     }
    //     setTabList(newTabList);
    //     setActiveKey(newActiveKey);
    //     // setVersionState(prevState => {
    //     //     const newState = { ...prevState };
    //     //     delete newState[targetKey];
    //     //     return newState;
    //     // });
    // };

    const { variants, isLoading, isError } = useParams(app);
    if (isError) return <div>failed to load</div>
    if (isLoading) return <div>loading...</div>

    console.log(variants);
    return (
        <Tabs
            type="card"
            activeKey={activeKey}
            onChange={setActiveKey}

        // onEdit={(targetKey, action) => {
        //     if (action === 'add') {
        //         addTab();
        //     } else if (action === 'remove') {
        //         removeTab(targetKey);
        //     }
        // }}
        >
            {variants.map((variant, index) => (
                <TabPane tab={`Variant ${variant.variant_name}`} key={index}>
                    <ViewNavigation variant={variant} />
                </TabPane>
            ))}
            {/* 
            {tabList.map(key => (
                <TabPane tab={`Version ${key}`} key={key} closable={tabList.length > 1}>
                    <ViewNavigation />
                </TabPane>
            ))} */}
        </Tabs>
    );
};

export default VersionTabs;
