import {js as beautify} from "js-beautify"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

export default function tsCode(appName: string, env_name: string, apiKey: string): string {
    const codeString = `import axios from 'axios';

const getConfig = async (appName: string, environmentSlug: string) => {
    const baseUrl = '${getEnv("NEXT_PUBLIC_AGENTA_API_URL")}/applications/revisions/retrieve';

    try {
        const response = await axios.post(baseUrl, {
            application_ref: {
                slug: appName,
            },
            environment_ref: {
                slug: environmentSlug,
            },
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': "ApiKey ${apiKey}",
            },
        });

        return response.data;
    } catch {
        throw new Error('Failed to fetch configuration.');
    }
};

getConfig('${appName}', '${env_name}').then(console.log).catch(console.error);
    `

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
