import {js as beautify} from "js-beautify"

export default function tsCode(appName: string, env_name: string): string {
    const codeString = `
    import axios from 'axios';
    
    const getConfig = async (appName: string, environmentSlug: string) => {
        try {
            const baseUrl = '${process.env.NEXT_PUBLIC_AGENTA_API_URL}/api';
            const params = {
                app_name: appName,
                environment_slug: environmentSlug
            };
    
            const response = await axios.get(baseUrl + "/variants/configs/fetch", {
                params: params,
                headers: {
                    'Authorization': "Bearer YOUR_API_KEY",
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            });
    
            if (response.status >= 200 && response.status < 300) {
                return response.data;
            } else if (response.status === 422) {
                throw new Error(JSON.stringify(response.data));
            }
        } catch (error: any) {
            if (error.response) {
                console.error("API Error: " + error.response.status, error.response.data);
            } else if (error.request) {
                console.error('API Error: No response received', error.request);
            } else {
                console.error('Error', error.message);
            }
            throw error;
        }
    };
    
    getConfig('${appName}', '${env_name}').then(console.log).catch(console.error);
    `

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
