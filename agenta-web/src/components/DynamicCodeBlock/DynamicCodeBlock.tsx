import CodeBlock from "@/components/DynamicCodeBlock/CodeBlock"
import {LanguageItem} from "@/lib/Types"
import {DownOutlined} from "@ant-design/icons"
import {Button, Dropdown, MenuProps, Space, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import CopyButton from "../CopyButton/CopyButton"

interface DynamicCodeBlockProps {
    codeSnippets: {[key: string]: string}
}

const useStyles = createUseStyles({
    container: {
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
    },
    headerText: {
        fontSize: "1em",
        marginRight: "10px",
    },
    copyBtn: {
        marginLeft: "15px",
    },
})

const DynamicCodeBlock: React.FC<DynamicCodeBlockProps> = ({codeSnippets}) => {
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

    const {Text} = Typography

    return (
        <div className={classes.container}>
            <div className={classes.header}>
                <div className={classes.headerText}>
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
