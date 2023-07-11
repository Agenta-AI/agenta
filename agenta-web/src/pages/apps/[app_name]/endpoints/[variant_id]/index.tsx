import { Parameter, Variant } from "@/lib/Types";
import { useVariant } from "@/lib/hooks/useVariant";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import pythonCode from '../../../../../code_snippets/endpoints/python';
import cURLCode from '../../../../../code_snippets/endpoints/curl';
import tsCode from '../../../../../code_snippets/endpoints/typescript';

import DynamicCodeBlock from '../../../../../components/DynamicCodeBlock/DynamicCodeBlock';

export default function VariantEndpoint() {
    const router = useRouter();
    const appName = router.query.app_name?.toString() || "";
    const variantName = router.query.variant_id?.toString() || "";

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

    const codeSnippets: Record<string, string> = {
        Python: pythonCode(uri, params),
        cURL: cURLCode(uri, params),
        TypeScript: tsCode(uri, params),
    };

    return (
        <div>
            <div>
                <h3>Variant Name: {variant.variantName}</h3>
            </div>
            <DynamicCodeBlock
                codeSnippets={codeSnippets}
            />
        </div>
    );
}
