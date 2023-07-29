import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import {MenuProps, Dropdown, Button, Row, Col, Space} from "antd"
import {DownOutlined, ApiOutlined} from "@ant-design/icons"
import {useEffect, useState} from "react"
import {LanguageItem, Variant} from "@/lib/Types"

interface DynamicCodeBlockProps {
    codeSnippets: {[key: string]: string}
    includeVariantsDropdown?: boolean
    variants: Variant[]
    selectedVariant: Variant | null
    selectedLanguage: LanguageItem | null
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
    const [selectedLanguage, setSelectedLanguage] = useState(supportedLanguages[0]);
    
    useEffect(() => {
        if (selectedLanguage === null && supportedLanguages.length > 0) {
            setSelectedLanguage(supportedLanguages[0])
        }
    }, [supportedLanguages, selectedLanguage, setSelectedLanguage])

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
        const newSelectedVariant = variants.find((variant) => variant.variantName === key)
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
    return (
        <div
            style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 10,
                display: "flex",
                flexDirection: "column",
            }}
        >
            <div style={{fontSize: "1.5em", marginBottom: "25px"}}>
                {" "}
                {/* Large font similar to h3 */}
                <ApiOutlined /> API endpoint
            </div>
            <div style={{margin: "5px 0px"}}>
                Select a variant then use this endpoint to send requests to the LLM app.
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
                    <div style={{marginRight: "10px"}}>Variant:</div>
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
                    <div style={{fontSize: "1em", marginRight: "10px"}}>Language:</div>
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
