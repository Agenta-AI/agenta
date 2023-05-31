// VersionTabs.tsx

import React, { useState, useEffect } from 'react';
import { Tabs, Modal, Input, Select, Space, Typography, message } from 'antd';
import ViewNavigation from './ViewNavigation';
import VariantRemovalWarningModal from './VariantRemovalWarningModal';
import NewVariantModal from './NewVariantModal';
import { useRouter } from 'next/router';
import { fetchVariants } from '@/lib/services/api';
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
    const router = useRouter();
    const { app_name } = router.query;
    const [templateVariantName, setTemplateVariantName] = useState("");  // We use this to save the template variant name when the user creates a new variant
    const [activeKey, setActiveKey] = useState('1');
    const [tabList, setTabList] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [variants, setVariants] = useState<Variant[]>([]);  // These are the variants that exist in the backend
    const [isLoading, setIsLoading] = useState(true);
    const [isError, setIsError] = useState(false);
    const [newVariantName, setNewVariantName] = useState("");  // This is the name of the new variant that the user is creating
    const [isWarningModalOpen, setIsWarningModalOpen] = useState(false);
    const [removalKey, setRemovalKey] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const backendVariants = await fetchVariants(app_name);

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
    }, [app_name]);

    if (isError) return <div>failed to load variants</div>
    if (isLoading) return <div>loading variants...</div>


    const handleRemove = () => {
        if (removalKey) {
            removeTab(setActiveKey, setVariants, variants, removalKey);
        }
        setIsWarningModalOpen(false);
    };

    const handleCancel = () => {
        setIsWarningModalOpen(false);
    };

    /**
     * Called when the variant is saved for the first time to the backend
     * after this point, the variant cannot be removed from the tab menu
     * but only through the button
     * @param variantName 
     */
    function handlePersistVariant(variantName: string) {
        setVariants(prevVariants => {
            return prevVariants.map(variant => {
                if (variant.variantName === variantName) {
                    return { ...variant, persistent: true };
                }
                return variant;
            });
        });
    }

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
                        setRemovalKey(targetKey);
                        setIsWarningModalOpen(true);
                    }
                }}
            >
                {variants.map((variant, index) => (
                    <TabPane tab={`Variant ${variant.variantName}`} key={variant.variantName} closable={!variant.persistent}>
                        <ViewNavigation variant={variant} handlePersistVariant={handlePersistVariant} />
                    </TabPane>
                ))}

            </Tabs>

            <NewVariantModal
                isModalOpen={isModalOpen}
                setIsModalOpen={setIsModalOpen}
                addTab={() => addTab(setActiveKey, setVariants, variants, templateVariantName, newVariantName)}
                variants={variants}
                setNewVariantName={setNewVariantName}
                setTemplateVariantName={setTemplateVariantName}
            />
            <VariantRemovalWarningModal
                isModalOpen={isWarningModalOpen}
                setIsModalOpen={setIsWarningModalOpen}
                handleRemove={handleRemove}
                handleCancel={handleCancel}
            />
        </div>
    );
};

export default VersionTabs;