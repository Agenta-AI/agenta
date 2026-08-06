import {js as beautify} from "js-beautify"

import {isDemo} from "@/oss/lib/helpers/utils"

export default function tsCode(uri: string, params: string): string {
    const codeString = `import axios from 'axios';

const url = '${uri}';

const data = {
    testset: {
        slug: 'your-testset-slug',
        name: 'your_testset_name',
        data: {
            testcases: [
                {data: {column1: 'value1', column2: 'value2'}},
                {data: {column1: 'value3', column2: 'value4'}},
            ],
        },
    },
};

axios.post(url, data${!isDemo() ? "" : ", {headers: {Authorization: 'your_api_key'}}"})
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
