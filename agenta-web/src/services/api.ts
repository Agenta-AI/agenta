import useSWR from 'swr';
import axios from 'axios';
import { parseOpenApiSchema } from '@/helpers/openapi_parser';

const API_BASE_URL = "http://localhost";  // Replace this with your actual API base URL

const fetcher = (...args) => fetch(...args).then(res => res.json());

export function listVariants(app_name: string) {
    const { data, error } = useSWR(`${API_BASE_URL}/api/app_variant/list_variants/?app_name=${app_name}`, fetcher)
    return {
        variants: data,
        isLoading: !error && !data,
        isError: error
    }
}

/**
 * This function runs a variant and returns the result. It calls the right api endpoint.
 * and take care of specifying the right parameters if needed.
 * @param app_name
 * @param variantName
 * @param inputs
 * @returns - the result of the variant as a json object
 */
export function runVariant(appName: string, variantName: string, inputs: any) {
    const urlParams = Object.entries(inputs).map(([key, val]) => `${key}=${encodeURIComponent(val)}`).join('&');
    console.log(urlParams);
    return axios.post(`${API_BASE_URL}/${appName}/${variantName}/generate?${urlParams}`, {
        headers: {
            'accept': 'application/json',
        }
    }).then(res => res.data);
}

/**
 * Parses the openapi.json from a variant and returns the parameters as an array of objects.
 * @param app
 * @param variantName
 * @returns
 */
export const fetchVariantParameters = async (app: string, variantName: string) => {
    try {
        const url = `${API_BASE_URL}/${app}/${variantName}/openapi.json`;
        const response = await axios.get(url);
        const initialParams = parseOpenApiSchema(response.data)
        return initialParams;
    } catch (error) {
        throw error;
    }
};

/**
 * Loads the list of datasets
 * @returns
 */
export const loadDatasetsList = () => {
    const { data, error } = useSWR(`${API_BASE_URL}/api/datasets`, fetcher)
    return {
        datasets: data,
        isDatasetsLoading: !error && !data,
        isDatasetsLoadingError: error
    }
};