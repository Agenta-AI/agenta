// VersionTabs.tsx

import React, { useState, useEffect } from 'react';
import { Tabs, Modal, Input, Select, Space } from 'antd';
import ViewNavigation from './ViewNavigation';
import { useRouter } from 'next/router';
import AppContext from '@/contexts/appContext';
import { API_BASE_URL } from '@/services/api';
import axios from 'axios';
import { set } from 'cypress/types/lodash';
const { TabPane } = Tabs;

export interface Variant {
    variantName: string;
    templateVariantName: string | null; // template name of the variant in case it has a precursor. Needed to compute the URI path
    persistent: boolean;  // whether the variant is persistent in the backend or not
}

function addTab(setActiveKey: any, setVariants: any, templateVariantName: string, newVariantName: string) {
    const newVariant = {
        variantName: newVariantName,
        templateVariantName: templateVariantName,
        persistent: false
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

    useEffect(() => {
        if (app == "") {
            router.push("/");
        }
    }, [app]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const backendVariants = await axios.get(`${API_BASE_URL}/api/app_variant/list_variants/?app_name=${app}`);

                if (backendVariants.data && Array.isArray(backendVariants.data) && backendVariants.data.length > 0) {
                    console.log(backendVariants)
                    const backendVariantsProcessed = backendVariants.data.map((variant: Record<string, string>) => {
                        return {
                            variantName: variant.variant_name,
                            templateVariantName: null,
                            persistent: true
                        }
                    });
                    setVariants(backendVariantsProcessed);
                    setActiveKey(backendVariantsProcessed[0].variant_name);
                }
                setIsLoading(false);
            } catch (error) {
                setIsError(true);
                setIsLoading(false);
            }
        };

        fetchData();
    }, [app]);

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
                title="Choose a Starting Variant"
                visible={isModalOpen}
                onOk={() => {
                    setIsModalOpen(false);
                    addTab(setActiveKey, setVariants, templateVariantName, newVariantName);
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
                    options={variants.map(variant => ({ value: variant.variantName, label: variant.variantName }))}
                />
                <div style={{ marginBottom: 20 }}>
                    Please give a name for the new variant:
                </div>
                <Input.TextArea
                    defaultValue=""
                    onChange={e => setNewVariantName(e.target.value)}
                />


            </Modal>
        </div>
    );
};

export default VersionTabs;
