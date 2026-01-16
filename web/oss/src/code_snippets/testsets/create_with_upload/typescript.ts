import {js as beautify} from "js-beautify"

import {isDemo} from "@/oss/lib/helpers/utils"

export default function tsCode(uri: string): string {
    const codeString = `import axios from 'axios';
    const fs = require('fs');
    const FormData = require('form-data');

    const url = '${uri}';
    const filePath = '/path/to/your/file.csv';
    const testsetName = 'your_testset_name';

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('file_type', 'csv');
    formData.append('testset_name', testsetName);

    const config = {
        headers: {
            ...formData.getHeaders() ${!isDemo() ? "" : ", Authorization: 'your_api_key'"}
        }
    };

    axios.post(url, formData, config)
        .then((response) => {
            console.log(response.status);
            console.log(response.data);
        })
        .catch((error) => {
            console.error(error);
        });
`

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
