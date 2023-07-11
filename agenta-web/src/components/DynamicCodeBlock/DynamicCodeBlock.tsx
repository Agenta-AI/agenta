import CodeBlock from "@/components/CodeBlock/CodeBlock";
import { MenuProps, Dropdown, Button, Space } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { useState } from "react";

type LanguageItem = { displayName: string; languageKey: string };

interface DynamicCodeBlockProps {
    codeSnippets: { [key: string]: string };
}

const DynamicCodeBlock: React.FC<DynamicCodeBlockProps> = ({ codeSnippets }) => {
    const supportedLanguages: LanguageItem[] = [
        { displayName: 'Python', languageKey: 'python' },
        { displayName: 'cURL', languageKey: 'bash' },
        { displayName: 'TypeScript', languageKey: 'typescript' },
    ];

    const [selectedLanguage, setSelectedLanguage] = useState<LanguageItem>(supportedLanguages[0]);

    const items: MenuProps['items'] = supportedLanguages.map((languageItem, index) => ({
        key: (index + 1).toString(),
        label: languageItem.displayName,
    }));

    const handleMenuClick = ({ key }: { key: string }) => {
        setSelectedLanguage(supportedLanguages[parseInt(key, 10) - 1]);
    };

    return (
        <div style={{ backgroundColor: '#282c34', borderRadius: 10 }}>
            <div style={{ paddingTop: '7px', paddingRight: '10px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Space direction="vertical">
                    <Space wrap>
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
                        </Dropdown>
                    </Space>
                </Space>
            </div>
            <CodeBlock language={selectedLanguage.languageKey} value={codeSnippets[selectedLanguage.displayName]} />
        </div>
    );
};

export default DynamicCodeBlock;
