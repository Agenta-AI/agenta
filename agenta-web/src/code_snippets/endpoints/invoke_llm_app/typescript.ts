import {js as beautify} from "js-beautify"

export default function tsCode(uri: string, params: string): string {
    const codeString = `import axios from 'axios';

const generate = async () => {
    const response = await axios.post('${uri}', ${params});

    console.log(response.data);
    };

    generate().catch(console.error);
`

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
