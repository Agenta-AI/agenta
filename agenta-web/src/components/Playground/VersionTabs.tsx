// VersionTabs.tsx

import React, { useState, useEffect } from 'react';
import { Tabs, Modal, Input, Select, Space } from 'antd';
import ViewNavigation from './ViewNavigation';
import { useRouter } from 'next/router';
import AppContext from '@/contexts/appContext';
import { listVariants } from '@/services/api';
const { TabPane } = Tabs;

function addTab(tabList, setTabList, setActiveKey, setVariantDict, newVariant) {
    const newKey = (tabList.length + 1).toString();
    setTabList(prevState => [...prevState, newKey]);
    setVariantDict(prevState => ({ ...prevState, [newKey]: newVariant }));
    setActiveKey(newKey);
}

function removeTab(targetKey, tabList, setTabList, setActiveKey, setVariantDict, activeKey, variantDict) {
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

    const newVariantDict = { ...variantDict };
    delete newVariantDict[targetKey];
    setVariantDict(newVariantDict);
}

const VersionTabs: React.FC = () => {
    const { app } = React.useContext(AppContext);
    const router = useRouter();
    const [templateVariantName, setTemplateVariantName] = useState("");
    const [variantDict, setVariantDict] = useState({});
    const [activeKey, setActiveKey] = useState('1');
    const [tabList, setTabList] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);

    useEffect(() => {
        if (app == "") {
            router.push("/");
        }
    }, [app]);

    useEffect(() => {
        if (variants && Array.isArray(variants) && variants.length > 0) {
            setActiveKey(variants[0].variant_name);
        }
    }, []);

    const { variants, isLoading, isError } = listVariants(app);
    if (isError) return <div>failed to load</div>
    if (isLoading) return <div>loading...</div>

    return (
        <div>
            <Tabs
                type="editable-card"
                activeKey={activeKey}
                onChange={setActiveKey}
                onEdit={(targetKey, action) => {
                    if (action === 'add') {
                        setIsModalOpen(true);
                    } else if (action === 'remove') {
                        removeTab(targetKey, tabList, setTabList, setActiveKey, setVariantDict, activeKey, variantDict);
                    }
                }}
            >
                {variants.map((variant, index) => (
                    <TabPane tab={`Variant ${variant.variant_name}`} key={variant.variant_name} closable={false}>
                        <ViewNavigation variant={variant} />
                    </TabPane>
                ))}

                {tabList.map((key) => (
                    <TabPane tab={`New Variant ${key}`} key={`${key}`} >
                        <ViewNavigation variant={variantDict[key]} />
                    </TabPane>
                ))}
            </Tabs>

            <Modal
                title="Choose a Starting Variant"
                visible={isModalOpen}
                onOk={() => {
                    setIsModalOpen(false);
                    addTab(tabList, setTabList, setActiveKey, setVariantDict, { "variant_name": templateVariantName });
                }}
                onCancel={() => setIsModalOpen(false)}
                centered
            >
                <div style={{ marginBottom: 20 }}>
                    Please select a variant to use as your template:
                </div>
                <Select
                    style={{ width: '100%' }}
                    placeholder="Select a variant"
                    onChange={setTemplateVariantName}
                    options={variants.map(variant => ({ value: variant.variant_name, label: variant.variant_name }))}
                />
            </Modal>
        </div>
    );
};

export default VersionTabs;
