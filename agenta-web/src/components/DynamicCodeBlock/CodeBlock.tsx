import {Prism as SyntaxHighlighter} from "react-syntax-highlighter"
import {coy, darcula} from "react-syntax-highlighter/dist/cjs/styles/prism"
import {Typography} from "antd"
import {CopyOutlined} from "@ant-design/icons"
import {FC} from "react"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {createUseStyles} from "react-jss"

interface CodeBlockProps {
    language: string
    value: string
}

const useStyles = createUseStyles({
    container: {
        margin: 0,
    },
})

const CodeBlock: FC<CodeBlockProps> = ({language, value}) => {
    const {Paragraph} = Typography

    const {appTheme} = useAppTheme()
    const classes = useStyles()
    return (
        <div className={classes.container}>
            <Paragraph>
                <SyntaxHighlighter
                    language={language}
                    style={appTheme === "dark" ? darcula : coy}
                    showLineNumbers
                    wrapLongLines={true}
                >
                    {value}
                </SyntaxHighlighter>
            </Paragraph>
        </div>
    )
}

export default CodeBlock
