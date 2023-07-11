import { js as beautify } from 'js-beautify';

export default function tsCode(uri: string, appName: string): string {
    const codeString =  `import axios from 'axios';
    import fs from 'fs';

    const url = '${uri}';
    const filePath = '/path/to/your/file.csv';
    const datasetName = 'your_dataset_name';
    const appName = '${appName}';

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('dataset_name', datasetName);
    formData.append('app_name', appName);

    axios.post(url, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
    })
    .then((response) => {
        console.log(response.status);
        console.log(response.data);
    })
    .catch((error) => {
        console.error(error);
    });
`;

    const formattedCodeString = beautify(codeString);
    return formattedCodeString;

}