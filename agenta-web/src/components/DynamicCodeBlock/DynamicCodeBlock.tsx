import CodeBlock from "@/components/CodeBlock/CodeBlock";
import { MenuProps, Dropdown, Button, Space } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { LanguageItem, Variant } from "@/lib/Types";

interface DynamicCodeBlockProps {
    codeSnippets: { [key: string]: string };
    includeVariantsDropdown?: boolean;
    variants: Variant[];
    selectedVariant: Variant | null;
    selectedLanguage: LanguageItem | null;
    onVariantChange?: (variantName: string) => void;
    onLanguageChange?: (selectedLanguage: LanguageItem) => void;
}

const DynamicCodeBlock: React.FC<DynamicCodeBlockProps> = ({ codeSnippets, includeVariantsDropdown = false, variants, selectedVariant, selectedLanguage, onVariantChange, onLanguageChange }) => {
    const supportedLanguages: LanguageItem[] = [
        { displayName: 'Python', languageKey: 'python' },
        { displayName: 'cURL', languageKey: 'bash' },
        { displayName: 'TypeScript', languageKey: 'typescript' },
    ];

    useEffect(() => {
        if (selectedLanguage === null && supportedLanguages.length > 0) {
            onLanguageChange?.(supportedLanguages[0]);
        }
    }, [supportedLanguages, selectedLanguage, onLanguageChange]);

    const items: MenuProps['items'] = supportedLanguages.map((languageItem, index) => ({
        key: (index + 1).toString(),
        label: languageItem.displayName,
    }));

    const handleMenuClick = ({ key }: { key: string }) => {
        const newSelectedLanguage = supportedLanguages[parseInt(key, 10) - 1];
        onLanguageChange?.(newSelectedLanguage);
    };

    const variantsItems: MenuProps['items'] = variants ? variants.map((variant) => {
        return {
            label: variant.variantName,
            key: variant.variantName,
        };
    }) : [];

    const handleVariantClick = ({ key }: { key: string }) => {
        const newSelectedVariant = variants.find(variant => variant.variantName === key);
        if (newSelectedVariant) {
            onVariantChange?.(key);
        }
    };

    return (
        <div style={{ backgroundColor: '#282c34', borderRadius: 10 }}>
            <div style={{ paddingTop: '7px', paddingRight: '10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Space direction="vertical">
                    <Space wrap>
                    {selectedLanguage && (
                        <Dropdown
                            menu={{ items, onClick: handleMenuClick }}
                            placement="bottomLeft"
                        >
                            <Button size="small">
                                <Space>
                                    {selectedLanguage.displayName}
                                    <DownOutlined />
                                </Space>
                            </Button>
                        </Dropdown>)}
                        {includeVariantsDropdown &&
                            <Dropdown menu={{ items: variantsItems, onClick: handleVariantClick }}>
                                <Button style={{ marginRight: 10, width: '100%' }} size='small'>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                        {selectedVariant?.variantName || 'Select a variant'}
                                        <DownOutlined />
                                    </div>
                                </Button>
                            </Dropdown>}
                    </Space>
                </Space>
            </div>
            {selectedLanguage && (
            <CodeBlock
                key={selectedLanguage.languageKey + selectedVariant?.variantName}
                language={selectedLanguage.languageKey}
                value={codeSnippets[selectedLanguage.displayName]}
            />
            )}
        </div>
    );
};

export default DynamicCodeBlock;
