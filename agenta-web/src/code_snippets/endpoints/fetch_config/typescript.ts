import {js as beautify} from "js-beautify"

export default function tsCode(uri: string, config_url: string, params: string): string {
    const codeString = `
        const generate = async () => {
            try {
                const config_response = await axios.get("${config_url}");
                let params = ${params}
                const response = await axios.post("${uri}", {...params, ...config_response.data});
                console.log(response.data);
            } catch (error) {
                console.error(error);
            }
        };

        generate();
    `

    const formattedCodeString = beautify(codeString)
    return formattedCodeString
}
