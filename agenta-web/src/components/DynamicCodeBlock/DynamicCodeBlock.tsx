import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import {MenuProps, Dropdown, Button, Space} from "antd"
import {DownOutlined, ApiOutlined} from "@ant-design/icons"
import {useState} from "react"
import {LanguageItem, Variant} from "@/lib/Types"
import {Typography} from "antd"

interface DynamicCodeBlockProps {
    codeSnippets: {[key: string]: string}
    includeVariantsDropdown?: boolean
    variants?: Variant[]
    selectedVariant?: Variant | null
    selectedLanguage?: LanguageItem | null
    onVariantChange?: (variantName: string) => void
    onLanguageChange?: (selectedLanguage: LanguageItem) => void
}

const DynamicCodeBlock: React.FC<DynamicCodeBlockProps> = ({
    codeSnippets,
    includeVariantsDropdown = false,
    variants,
    selectedVariant,
    onVariantChange,
}) => {
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

    const variantsItems: MenuProps["items"] = variants
        ? variants.map((variant) => {
              return {
                  label: variant.variantName,
                  key: variant.variantName,
              }
          })
        : []

    const handleVariantClick = ({key}: {key: string}) => {
        const newSelectedVariant = variants?.find((variant) => variant.variantName === key)
        if (newSelectedVariant) {
            onVariantChange?.(key)
        }
    }
    const copyToClipboard = async (e: React.MouseEvent) => {
        e.preventDefault()
        try {
            await navigator.clipboard.writeText(codeSnippets[selectedLanguage.displayName])
        } catch (err) {
            console.error("Failed to copy text to clipboard")
        }
    }

    const {Text, Title} = Typography

    return (
        <div
            style={{
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
            }}
        >
            <div style={{marginBottom: "25px"}}>
                <Title level={3}>
                    <ApiOutlined />
                    API endpoint
                </Title>
            </div>
            <div style={{margin: "5px 0px"}}>
                <Text>
                    Select a variant then use this endpoint to send requests to the LLM app.
                </Text>
            </div>
            <div
                style={{
                    paddingTop: "20px",
                    marginBottom: "5px",
                    display: "flex",
                    justifyContent: "space-between",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        fontSize: "1.2em",
                        width: "20%",
                    }}
                >
                    {" "}
                    {/* Larger font */}
                    <div style={{marginRight: "10px", minWidth: "55px"}}>
                        <Text>Variant: </Text>
                    </div>
                    {includeVariantsDropdown && (
                        <Dropdown menu={{items: variantsItems, onClick: handleVariantClick}}>
                            <Button style={{marginLeft: 5, width: "100%"}} size="small">
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        width: "100%",
                                    }}
                                >
                                    {selectedVariant?.variantName || "Select a variant"}
                                    <DownOutlined />
                                </div>
                            </Button>
                        </Dropdown>
                    )}
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        width: "50%",
                        marginRight: "10px",
                    }}
                >
                    <div style={{fontSize: "1em", marginRight: "10px"}}>
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
                    <Button
                        type="primary"
                        onClick={copyToClipboard}
                        size="small"
                        style={{marginLeft: "15px"}}
                    >
                        Copy
                    </Button>
                </div>
            </div>
            {selectedLanguage && (
                <CodeBlock
                    key={selectedLanguage.languageKey + selectedVariant?.variantName}
                    language={selectedLanguage.languageKey}
                    value={codeSnippets[selectedLanguage.displayName]}
                />
            )}
        </div>
    )
}

export default DynamicCodeBlock
