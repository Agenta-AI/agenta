import { js as beautify } from 'js-beautify';

export default function tsCode(uri: string, params: string): string {
    const codeString =  `import axios from 'axios';

const generateBabyName = async () => {
    const response = await axios({
        method: 'post',
        url: '${uri}',
        params: ${params}
    });

    console.log(response.data);
    };

    generateBabyName().catch(console.error);
`;

    const formattedCodeString = beautify(codeString);
    return formattedCodeString;

}