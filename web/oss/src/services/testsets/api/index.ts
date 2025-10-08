import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {TestSet, PreviewTestSet} from "@/oss/lib/Types"
import {getProjectValues} from "@/oss/state/project"

import {PreviewTestsetsQueryPayload} from "./types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchTestsets = async () => {
    const {projectId} = getProjectValues()

    const response = await axios.get(`${getAgentaApiUrl()}/testsets?project_id=${projectId}`)

    return response.data
}

export const fetchPreviewTestsets = async (payload: PreviewTestsetsQueryPayload = {}) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/testsets/query?project_id=${projectId}`,
        payload,
    )

    return response.data
}

export async function createNewTestset(testsetName: string, testsetData: any) {
    const {projectId} = getProjectValues()

    const response = await axios.post(`${getAgentaApiUrl()}/testsets?project_id=${projectId}`, {
        name: testsetName,
        csvdata: testsetData || [{input: null, correct_answer: null}],
    })

    return response
}

export async function updateTestset(testsetId: string, testsetName: string, testsetData: any) {
    const {projectId} = getProjectValues()

    const response = await axios.put(
        `${getAgentaApiUrl()}/testsets/${testsetId}?project_id=${projectId}`,
        {
            name: testsetName,
            csvdata: testsetData,
        },
    )
    return response
}

export async function fetchTestset<T extends boolean = false>(
    testsetId: string,
    preview?: T,
): Promise<T extends true ? PreviewTestSet : TestSet> {
    if (!testsetId) {
        return null as any
    }
    const {projectId} = getProjectValues()
    const url = preview
        ? `${getAgentaApiUrl()}/preview/simple/testsets/${testsetId}?project_id=${projectId}`
        : `${getAgentaApiUrl()}/testsets/${testsetId}?project_id=${projectId}`
    const response = await axios.get(url)

    if (!preview) {
        return response?.data as T extends true ? PreviewTestSet : TestSet
    } else {
        return response?.data?.testset as T extends true ? PreviewTestSet : TestSet
    }
}

export const uploadTestsets = async (formData: FormData) => {
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/upload?project_id=${projectId}`,
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
    const {projectId} = getProjectValues()

    const response = await axios.post(
        `${getAgentaApiUrl()}/testsets/endpoint?project_id=${projectId}`,
        formData,
        {
            headers: {"Content-Type": "multipart/form-data"},
        },
    )
    return response
}

export const deleteTestsets = async (ids: string[]) => {
    const {projectId} = getProjectValues()

    const response = await axios({
        method: "delete",
        url: `${getAgentaApiUrl()}/testsets?project_id=${projectId}`,
        data: {testset_ids: ids},
    })
    return response.data
}
