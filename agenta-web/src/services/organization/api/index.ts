import axios from "@/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/lib/helpers/utils"
import {Org, OrgDetails} from "@/lib/Types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllOrgsList = async (ignoreAxiosError: boolean = false) => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/organizations/`, {
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data as Org[]
}

export const fetchSingleOrg = async (
    {orgId}: {orgId: string},
    ignoreAxiosError: boolean = false,
) => {
    const response = await axios.get(`${getAgentaApiUrl()}/api/organizations/${orgId}/`, {
        _ignoreError: ignoreAxiosError,
    } as any)
    return response.data as OrgDetails
}
