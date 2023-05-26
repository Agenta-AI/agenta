// VersionTabs.tsx

import React, { useState, useEffect } from 'react';
import { Tabs, Modal, Input, Select, Space, Typography, message } from 'antd';
import ViewNavigation from './ViewNavigation';
import { useRouter } from 'next/router';
import AppContext from '@/contexts/appContext';
import { fetchVariants } from '@/lib/services/api';
import axios from 'axios';
import { Variant } from '@/lib/Types';
const { TabPane } = Tabs;


function addTab(setActiveKey: any, setVariants: any, variants: Variant[], templateVariantName: string, newVariantName: string) {
    // 1) Check if variant with the same name already exists
    const existingVariant = variants.find(variant => variant.variantName === newVariantName);

    if (existingVariant) {
        message.error('A variant with this name already exists. Please choose a different name.');
        return;
    }

    // Find the template variant
    const templateVariant = variants.find(variant => variant.variantName === templateVariantName);

    // Check if the template variant exists
    if (!templateVariant) {
        message.error('Template variant not found. Please choose a valid variant.');
        return;
    }

    const newTemplateVariantName = templateVariant.templateVariantName ? templateVariant.templateVariantName : templateVariantName;

    const newVariant: Variant = {
        variantName: newVariantName,
        templateVariantName: newTemplateVariantName,
        persistent: false,
        parameters: templateVariant.parameters,
    }

    setVariants(prevState => [...prevState, newVariant])
    setActiveKey(newVariantName);
}

function removeTab(setActiveKey: any, setVariants: any, variants: Variant[], activeKey: string) {
    console.log(activeKey)
    const newVariants = variants.filter(variant => variant.variantName !== activeKey);

    let newActiveKey = '';
    if (newVariants.length > 0) {

        newActiveKey = newVariants[newVariants.length - 1].variantName;
    }
    console.log(newActiveKey, newVariants)
    setVariants(newVariants);
    setActiveKey(newActiveKey);
}



const VersionTabs: React.FC = () => {
    const { app } = React.useContext(AppContext);
    const router = useRouter();
    const [templateVariantName, setTemplateVariantName] = useState("");  // We use this to save the template variant name when the user creates a new variant
    const [activeKey, setActiveKey] = useState('1');
    const [tabList, setTabList] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [variants, setVariants] = useState<Variant[]>([]);  // These are the variants that exist in the backend
    const [isLoading, setIsLoading] = useState(true);
    const [isError, setIsError] = useState(false);
    const [newVariantName, setNewVariantName] = useState("");  // This is the name of the new variant that the user is creating
    const { Text } = Typography; // Destructure Text from Typography for text components
    useEffect(() => {
        if (app == "") {
            router.push("/");
        }
    }, [app]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const backendVariants = await fetchVariants(app);

                if (backendVariants.length > 0) {
                    setVariants(backendVariants);
                    setActiveKey(backendVariants[0].variantName);
                }

                setIsLoading(false);
            } catch (error) {
                setIsError(true);
                setIsLoading(false);
            }
        };

        fetchData();
    }, [app]);

    if (isError) return <div>failed to load variants</div>
    if (isLoading) return <div>loading variants...</div>

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
                        removeTab(setActiveKey, setVariants, variants, targetKey);
                    }
                }}
            >
                {variants.map((variant, index) => (
                    <TabPane tab={`Variant ${variant.variantName}`} key={variant.variantName} closable={!variant.persistent}>
                        <ViewNavigation variant={variant} />
                    </TabPane>
                ))}

            </Tabs>

            <Modal
                title="Create a New Variant"
                visible={isModalOpen}
                onOk={() => {
                    setIsModalOpen(false);
                    addTab(setActiveKey, setVariants, variants, templateVariantName, newVariantName);
                }}
                onCancel={() => setIsModalOpen(false)}
                centered
            >
                <Space direction="vertical" size={20}>
                    <div>
                        <Text>Enter a unique name for the new variant:</Text>
                        <Input
                            placeholder="New variant name"
                            onChange={e => setNewVariantName(e.target.value)}
                        />
                    </div>

                    <div>
                        <Text>Select an existing variant to use as a template:</Text>
                        <Select
                            style={{ width: '100%' }}
                            placeholder="Select a variant"
                            onChange={setTemplateVariantName}
                            options={variants.map(variant => ({ value: variant.variantName, label: variant.variantName }))}
                        />
                    </div>
                </Space>
            </Modal> </div>
    );
};

export default VersionTabs;
