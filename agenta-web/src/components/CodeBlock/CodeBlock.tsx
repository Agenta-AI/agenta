import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { FC } from 'react';

const { Paragraph } = Typography;

interface CodeBlockProps {
    language: string;
    value: string;
}

const CodeBlock: FC<CodeBlockProps> = ({ language, value }) => {
    return (
        <Typography>
            <Paragraph copyable={{ text: value, icon: <CopyOutlined /> }}>
                <SyntaxHighlighter language={language} style={oneDark} showLineNumbers>
                    {value}
                </SyntaxHighlighter>
            </Paragraph>
        </Typography>
    );
}

export default CodeBlock;