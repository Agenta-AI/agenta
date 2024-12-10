import useSWR from "swr"
import axios from "@/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {axiosFetcher} from "@/services/api"
import {getCurrentProject} from "@/contexts/project.context"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const useLoadTestsetsList = () => {
    const {projectId} = getCurrentProject()

    const {data, error, mutate, isLoading} = useSWR(`/api/testsets?project_id=${projectId}`, {
        revalidateOnFocus: false,
        shouldRetryOnError: false,
    })

    return {
        testsets: data || [],
        isTestsetsLoading: isLoading,
        isTestsetsLoadingError: error,
        mutate,
    }
}

export const fetchTestsets = async () => {
    const {projectId} = getCurrentProject()

    const response = await axios.get(`${getAgentaApiUrl()}/api/testsets?project_id=${projectId}`)

    return response.data
}

export async function createNewTestset(testsetName: string, testsetData: any) {
    const {projectId} = getCurrentProject()

    const response = await axios.post(`${getAgentaApiUrl()}/api/testsets?project_id=${projectId}`, {
        name: testsetName,
        csvdata: testsetData || [{input: null, correct_answer: null}],
    })

    return response
}

export async function updateTestset(testsetId: String, testsetName: string, testsetData: any) {
    const {projectId} = getCurrentProject()

    const response = await axios.put(
        `${getAgentaApiUrl()}/api/testsets/${testsetId}?project_id=${projectId}`,
        {
            name: testsetName,
            csvdata: testsetData,
        },
    )
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
    const {projectId} = getCurrentProject()

    const response = await axios.get(
        `${getAgentaApiUrl()}/api/testsets/${testsetId}?project_id=${projectId}`,
    )
    return response.data
}

export const uploadTestsets = async (formData: FormData) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/testsets/upload?project_id=${projectId}`,
        formData,
        {
            headers: {
                "Content-Type": "multipart/form-data",
            },
            //@ts-ignore
            _ignoreError: true,
        },
    )
    return response
}

export const importTestsetsViaEndpoint = async (formData: FormData) => {
    const {projectId} = getCurrentProject()

    const response = await axios.post(
        `${getAgentaApiUrl()}/api/testsets/endpoint?project_id=${projectId}`,
        formData,
        {
            headers: {"Content-Type": "multipart/form-data"},
        },
    )
    return response
}

export const deleteTestsets = async (ids: string[]) => {
    const {projectId} = getCurrentProject()

    const response = await axios({
        method: "delete",
        url: `${getAgentaApiUrl()}/api/testsets?project_id=${projectId}`,
        data: {testset_ids: ids},
    })
    return response.data
}
