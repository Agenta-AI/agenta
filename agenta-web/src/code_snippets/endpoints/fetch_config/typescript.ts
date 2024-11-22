import {js as beautify} from "js-beautify"

export default function tsCode(appName: string, env_name: string): string {
    const codeString = `import axios from 'axios';

const getConfig = async (appName: string, environmentSlug: string) => {
    const baseUrl = 'https://oss.agenta.ai/api/variants/configs/fetch';

    try {
        const response = await axios.post(baseUrl, {
            environment_ref: {
                slug: environmentSlug,
                version: null,
                id: null,
            },
            application_ref: {
                slug: appName,
                version: null,
                id: null,
            },
        }, {
            headers: {
                'Authorization': "Bearer YOUR_API_KEY",
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        return response.data;
    } catch {
        throw new Error('Failed to fetch configuration.');
    }
};

getConfig('demo', 'production').then(console.log).catch(console.error);
    `

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
