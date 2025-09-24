import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {ListAppsItem} from "@/oss/lib/Types"

export const fetchAllApps = async (): Promise<ListAppsItem[]> => {
    try {
        const response = await axios.get(`${getAgentaApiUrl()}/apps`)
        return response.data
    } catch (error) {
        console.log("failed to fetch all apps", error)
        return []
    }
}
