import type {AppEndpointSnippets} from "./appEndpoint"

/** Written into a snippet when the reader has not given an API key. */
const API_KEY_PLACEHOLDER = "YOUR_API_KEY"

export const TESTSET_CREATE_DOCS_URL =
    "https://agenta.ai/docs/evaluation/managing-test-sets/create-programatically"

export interface TestsetCreateSnippetInput {
    /** The API origin and path, for example `https://host/api`. */
    apiUrl: string
    apiKey?: string
}

/** The text as one shell argument in single quotes. */
const shellSingleQuoted = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`

/** The text as a quoted string literal that Python and TypeScript both accept. */
const stringLiteral = (text: string): string => JSON.stringify(text)

/** The request body every JSON snippet posts: two example rows with made-up columns. */
const EXAMPLE_BODY = {
    testset: {
        slug: "your-testset-slug",
        name: "your_testset_name",
        data: {
            testcases: [
                {data: {column1: "value1", column2: "value2"}},
                {data: {column1: "value3", column2: "value4"}},
            ],
        },
    },
}

/** How to create a test set by uploading a CSV file, once per language. */
export const buildTestsetUploadSnippets = ({
    apiUrl,
    apiKey,
}: TestsetCreateSnippetInput): AppEndpointSnippets => {
    const url = `${apiUrl}/simple/testsets/upload`
    const authorization = `ApiKey ${apiKey || API_KEY_PLACEHOLDER}`
    return {
        python: `import requests

url = ${stringLiteral(url)}
headers = {
    "Authorization": ${stringLiteral(authorization)},
}
data = {
    "testset_name": "your_testset_name",
    "file_type": "csv",
}

with open("/path/to/your_file.csv", "rb") as file:
    response = requests.post(url, headers=headers, data=data, files={"file": file})

print(response.json())
`,
        bash: `curl -X POST ${shellSingleQuoted(url)} \\
-H ${shellSingleQuoted(`Authorization: ${authorization}`)} \\
-F 'file=@/path/to/your_file.csv' \\
-F 'testset_name=your_testset_name' \\
-F 'file_type=csv'
`,
        typescript: `import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

const uploadTestset = async () => {
    const url = ${stringLiteral(url)};
    const form = new FormData();
    form.append('file', fs.createReadStream('/path/to/your_file.csv'));
    form.append('testset_name', 'your_testset_name');
    form.append('file_type', 'csv');

    const response = await axios.post(url, form, {
        headers: {
            ...form.getHeaders(),
            'Authorization': ${stringLiteral(authorization)},
        },
    });

    console.log(response.data);
};

uploadTestset().catch(console.error);
`,
    }
}

/** How to create a test set with a JSON body, once per language. */
export const buildTestsetJsonSnippets = ({
    apiUrl,
    apiKey,
}: TestsetCreateSnippetInput): AppEndpointSnippets => {
    const url = `${apiUrl}/simple/testsets/`
    const authorization = `ApiKey ${apiKey || API_KEY_PLACEHOLDER}`
    const body = JSON.stringify(EXAMPLE_BODY, null, 2)
    const indented = (spaces: number) => body.split("\n").join(`\n${" ".repeat(spaces)}`)
    return {
        python: `import requests

url = ${stringLiteral(url)}
headers = {
    "Content-Type": "application/json",
    "Authorization": ${stringLiteral(authorization)},
}
payload = ${indented(0)}

response = requests.post(url, json=payload, headers=headers)

print(response.json())
`,
        bash: `curl -X POST ${shellSingleQuoted(url)} \\
-H "Content-Type: application/json" \\
-H ${shellSingleQuoted(`Authorization: ${authorization}`)} \\
-d ${shellSingleQuoted(body)}
`,
        typescript: `import axios from 'axios';

const createTestset = async () => {
    const url = ${stringLiteral(url)};
    const data = ${indented(4)};
    const headers = {
        "Content-Type": "application/json",
        "Authorization": ${stringLiteral(authorization)},
    };

    const response = await axios.post(url, data, { headers });

    console.log(response.data);
};

createTestset().catch(console.error);
`,
    }
}
