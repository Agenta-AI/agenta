import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {Org, OrgDetails} from "@/oss/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllOrgsList = async (ignoreAxiosError = false) => {
    const response = await axios.get(`${getAgentaApiUrl()}/organizations/`, {
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data as Org[]
}

export const fetchSingleOrg = async ({orgId}: {orgId: string}, ignoreAxiosError = false) => {
    const response = await axios.get(`${getAgentaApiUrl()}/organizations/${orgId}/`, {
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data as OrgDetails
}

export const updateOrganization = async (orgId: string, name: string, ignoreAxiosError = false) => {
    const response = await axios.put(`${getAgentaApiUrl()}/organizations/${orgId}/`, {name}, {
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data
}
