import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import {MenuProps, Dropdown, Button, Space} from "antd"
import {DownOutlined, ApiOutlined} from "@ant-design/icons"
import React, {useState} from "react"
import {LanguageItem, Variant} from "@/lib/Types"
import {Typography} from "antd"
import {createUseStyles} from "react-jss"
import CopyButton from "../CopyButton/CopyButton"

interface DynamicCodeBlockProps {
    codeSnippets: {[key: string]: string}
    includeVariantsDropdown?: boolean
    variants?: Variant[]
    selectedVariant?: Variant | null
    selectedLanguage?: LanguageItem | null
    onVariantChange?: (variantName: string) => void
    onLanguageChange?: (selectedLanguage: LanguageItem) => void
}

const useStyles = createUseStyles({
    container: {
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
    },
    headerTitle: {
        marginBottom: "25px",
    },
    headerText: {
        margin: "5px 0px",
    },
    header: {
        paddingTop: "20px",
        marginBottom: "5px",
        display: "flex",
        justifyContent: "space-between",
    },
    headerOpts: {
        display: "flex",
        alignItems: "center",
        fontSize: "1.2em",
        width: "20%",
    },
    headerOptsText: {
        marginRight: "10px",
        minWidth: "55px",
    },
    headerOpts2: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        width: "50%",
        marginRight: "10px",
    },
    headerOptsText2: {
        fontSize: "1em",
        marginRight: "10px",
    },
    dropdownBtn: {
        marginLeft: 5,
        width: "100%",
    },
    dropdownDiv: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
    },
    copyBtn: {
        marginLeft: "15px",
    },
})

const DynamicCodeBlock: React.FC<DynamicCodeBlockProps> = ({
    codeSnippets,
    includeVariantsDropdown = false,
    variants,
    selectedVariant,
    onVariantChange,
}) => {
    const classes = useStyles()
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

    const {Text, Title} = Typography

    return (
        <div className={classes.container}>
            <div className={classes.headerTitle}>
                <Title level={3}>
                    <ApiOutlined />
                    API endpoint
                </Title>
            </div>
            <div className={classes.headerText}>
                <Text>
                    Select a variant then use this endpoint to send requests to the LLM app.
                </Text>
            </div>
            <div className={classes.header}>
                <div className={classes.headerOpts}>
                    {" "}
                    {/* Larger font */}
                    <div className={classes.headerOptsText}>
                        <Text>Variant: </Text>
                    </div>
                    {includeVariantsDropdown && (
                        <Dropdown menu={{items: variantsItems, onClick: handleVariantClick}}>
                            <Button size="small" className={classes.dropdownBtn}>
                                <div className={classes.dropdownDiv}>
                                    {selectedVariant?.variantName || "Select a variant"}
                                    <DownOutlined />
                                </div>
                            </Button>
                        </Dropdown>
                    )}
                </div>
                <div className={classes.headerOpts2}>
                    <div className={classes.headerOptsText2}>
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
                        text="Copy"
                        type="primary"
                        size="small"
                        target={codeSnippets[selectedLanguage.displayName]}
                        className={classes.copyBtn}
                    />
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
