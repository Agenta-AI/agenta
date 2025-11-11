import {js as beautify} from "js-beautify"

export default function tsCode(uri: string, params: string): string {
    const codeString = `import axios from 'axios';

const generate = async () => {
    const url = '${uri}';
    const data = ${params};
    const headers = {
        "Content-Type": "application/json",
        "Authorization": "ApiKey x.xxxxxxxx" // Add your API key here, when using cloud
    };

    const response = await axios.post(url, data, { headers });
    
    console.log(response.data);
};

generate().catch(console.error);
`

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
