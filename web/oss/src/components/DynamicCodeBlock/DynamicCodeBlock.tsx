import {useState} from "react"

import {CopyButton} from "@agenta/ui"
import {DownOutlined} from "@ant-design/icons"
import {Button, Dropdown, MenuProps, Space, Typography} from "antd"

import CodeBlock from "@/oss/components/DynamicCodeBlock/CodeBlock"
import {LanguageItem} from "@/oss/lib/Types"

interface DynamicCodeBlockProps {
    codeSnippets: Record<string, string>
}

const DynamicCodeBlock: React.FC<DynamicCodeBlockProps> = ({codeSnippets}) => {
    const supportedLanguages: LanguageItem[] = [
        {displayName: "Python", languageKey: "python"},
        {displayName: "cURL", languageKey: "bash"},
        {displayName: "TypeScript", languageKey: "typescript"},
    ]
    const [selectedLanguage, setSelectedLanguage] = useState(supportedLanguages[0])

    const items: MenuProps["items"] = supportedLanguages.map((languageItem, index) => ({
        key: (index + 1).toString(),
        label: languageItem.displayName,
    }))

    const handleMenuClick = ({key}: {key: string}) => {
        const newSelectedLanguage = supportedLanguages[parseInt(key, 10) - 1]
        setSelectedLanguage(newSelectedLanguage)
    }

    const {Text} = Typography

    return (
        <div className="rounded-[10px] flex flex-col">
            <div className="flex items-center justify-end">
                <div className="text-[1em] mr-[10px]">
                    <Text>Language:</Text>
                </div>

                {selectedLanguage && (
                    <Dropdown menu={{items, onClick: handleMenuClick}} placement="bottomLeft">
                        <Button size="small">
                            <Space>
                                {selectedLanguage.displayName}
                                <DownOutlined />
                            </Space>
                        </Button>
                    </Dropdown>
                )}
                <CopyButton
                    type="primary"
                    size="small"
                    text={codeSnippets[selectedLanguage.displayName]}
                    className="ml-[15px]"
                />
            </div>

            {selectedLanguage && (
                <CodeBlock
                    key={selectedLanguage.languageKey}
                    language={selectedLanguage.languageKey}
                    value={codeSnippets[selectedLanguage.displayName]}
                />
            )}
        </div>
    )
}

export default DynamicCodeBlock
