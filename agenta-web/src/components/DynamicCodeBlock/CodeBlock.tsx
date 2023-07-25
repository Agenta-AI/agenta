import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { coy } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { FC } from 'react';


interface CodeBlockProps {
    language: string;
    value: string;
}

const CodeBlock: FC<CodeBlockProps> = ({ language, value }) => {
    const { Paragraph } = Typography;
    return (
        <div style={{ margin: "px 0px" }}>
            <Paragraph >
                <SyntaxHighlighter language={language} style={coy} showLineNumbers wrapLongLines={true}>
                    {value}
                </SyntaxHighlighter>
            </Paragraph>
        </div>
    );
}

export default CodeBlock;