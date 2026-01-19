import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

export const mergeSessionIdentities = async (sessionIdentities: string[]) => {
    const response = await axios.patch(
        `${getAgentaApiUrl()}/auth/session/identities`,
        {session_identities: sessionIdentities},
        {
            _skipAuthUpgradeRedirect: true,
            _ignoreError: true,
        } as any,
    )
    return response.data
}
