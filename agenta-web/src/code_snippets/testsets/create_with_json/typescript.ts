import {js as beautify} from "js-beautify"

export default function tsCode(uri: string, params: string): string {
    const codeString = `import axios from 'axios';

const url = '${uri}';
const data = {
    name: 'your_testset_name',
    csvdata: [
        {column1: 'value1', column2: 'value2'},
        {column1: 'value3', column2: 'value4'}
    ]
};

axios.post(url, data)
    .then((response) => {
        console.log(response.status);
        console.log(response.data);
    })
    .catch((error) => {
        console.error(error);
    });`

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
