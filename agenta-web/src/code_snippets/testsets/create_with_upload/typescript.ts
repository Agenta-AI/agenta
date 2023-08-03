import {js as beautify} from "js-beautify"

export default function tsCode(uri: string, appName: string): string {
    const codeString = `import axios from 'axios';
    const fs = require('fs');
    const FormData = require('form-data');

    const url = '${uri}';
    const filePath = './cypress/data/countries-genders.csv';
    const testsetName = 'tribalafa';
    const appName = '${appName}';

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('testset_name', testsetName);
    formData.append('app_name', appName);

    const config = {
        headers: {
            ...formData.getHeaders()
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
