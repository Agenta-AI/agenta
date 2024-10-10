import useSWR from "swr"
import axios from "@/lib/helpers/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {axiosFetcher} from "@/services/api"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const useLoadTestsetsList = (appId: string) => {
    const {data, error, mutate, isLoading} = useSWR(
        `${getAgentaApiUrl()}/api/testsets/?app_id=${appId}`,
        axiosFetcher,
        {revalidateOnFocus: false, shouldRetryOnError: false},
    )

    return {
        testsets: data || [],
        isTestsetsLoading: isLoading,
        isTestsetsLoadingError: error,
        mutate,
    }
}

export const fetchTestsets = async (appId: string) => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/testsets/?app_id=${appId}`)
    return response.data
}

export async function createNewTestset(appId: string, testsetName: string, testsetData: any) {
    const response = await axios.post(`${getAgentaApiUrl()}/api/testsets/${appId}/`, {
        name: testsetName,
        csvdata: testsetData,
    })
    return response
}

export async function updateTestset(testsetId: String, testsetName: string, testsetData: any) {
    const response = await axios.put(`${getAgentaApiUrl()}/api/testsets/${testsetId}/`, {
        name: testsetName,
        csvdata: testsetData,
    })
    return response
}

export const fetchTestset = async (testsetId: string | null) => {
    if (!testsetId) {
        return {
            id: undefined,
            name: "No Test Set Associated",
            created_at: "",
            updated_at: "",
            csvdata: [],
        }
    }
    const response = await axios.get(`${getAgentaApiUrl()}/api/testsets/${testsetId}/`)
    return response.data
}

export const uploadTestsets = async (formData: FormData) => {
    const response = await axios.post(`${getAgentaApiUrl()}/api/testsets/upload/`, formData, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
        //@ts-ignore
        _ignoreError: true,
    })
    return response
}

export const importTestsetsViaEndpoint = async (formData: FormData) => {
    const response = await axios.post(`${getAgentaApiUrl()}/api/testsets/endpoint/`, formData, {
        headers: {"Content-Type": "multipart/form-data"},
    })
    return response
}

export const deleteTestsets = async (ids: string[]) => {
    const response = await axios({
        method: "delete",
        url: `${getAgentaApiUrl()}/api/testsets/`,
        data: {testset_ids: ids},
    })
    return response.data
}
