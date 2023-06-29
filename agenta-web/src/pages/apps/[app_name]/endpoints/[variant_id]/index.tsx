import CodeBlock from "@/components/CodeBlock/CodeBlock";
import { Parameter, Variant } from "@/lib/Types";
import { useVariant } from "@/lib/hooks/useVariant";
import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, MenuProps, Space } from "antd";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import pythonCode from '../../../../../code_snippets/endpoints/python';
import cURLCode from '../../../../../code_snippets/endpoints/curl';
import tsCode from '../../../../../code_snippets/endpoints/typescript';

type LanguageItem = { displayName: string; languageKey: string };

export default function VariantEndpoint() {
    const router = useRouter();
    const appName = router.query.app_name?.toString() || "";
    const variantName = router.query.variant_id?.toString() || "";

    const supportedLanguages: LanguageItem[] = [
        { displayName: 'Python', languageKey: 'python' },
        { displayName: 'cURL', languageKey: 'bash' },
        { displayName: 'TypeScript', languageKey: 'typescript' },
    ];

    const [selectedLanguage, setSelectedLanguage] = useState<LanguageItem>(supportedLanguages[0]);

    const createVariant = (variantName: string): Variant => {
        return {
            variantName: variantName,
            templateVariantName: null,
            persistent: true,
            parameters: null,
        };
    };

    const [variant, setVariant] = useState(createVariant(variantName));
    useEffect(() => {
        setVariant(createVariant(variantName));
    }, [variantName, appName]);

    const { inputParams, optParams, URIPath, isLoading, isError, error } = useVariant(appName, variant);
    if (isError) return <div>failed to load variants</div>
    if (isLoading) return <div>loading variant...</div>

    const createParams = (inputParams: Parameter[], optParams: Parameter[], value: string | number) => {
        let params: { [key: string]: string | number } = {};

        inputParams.forEach(item => {
            params[item.name] = item.default || value;
        });

        optParams.forEach(item => {
            params[item.name] = item.default;
        });

        return JSON.stringify(params, null, 2);
    };
    const params = createParams(inputParams!, optParams!, 'add_a_value');

    const uri = `${process.env.NEXT_PUBLIC_AGENTA_API_URL}/${URIPath}/generate`

    const codeStrings: Record<string, string> = {
        Python: pythonCode(uri, params),
        cURL: cURLCode(uri, params),
        TypeScript: tsCode(uri, params),
    };

    const items: MenuProps['items'] = supportedLanguages.map((languageItem, index) => ({
        key: (index + 1).toString(),
        label: languageItem.displayName,
    }));

    const handleMenuClick = ({ key }: { key: string }) => {
        setSelectedLanguage(supportedLanguages[parseInt(key, 10) - 1]);
    };

    return (
        <div>
            <div>
                <h3>Variant Name: {variant.variantName}</h3>
            </div>
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
                <CodeBlock language={selectedLanguage.languageKey} value={codeStrings[selectedLanguage.displayName]} />
            </div>
        </div>
    );
}
