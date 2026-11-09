import {axios, getAgentaApiUrl} from "@agenta/shared/api"

export interface InstanceLicenseKey {
    key_id: string
    plan: string
    customer: string
    seats: number | null
    issued_at: string
    expires_at: string | null
    telemetry: "required" | "exempt"
}

/** `GET /instance/license`: the instance plan and its key. Only the instance admin may read it. */
export interface InstanceLicense {
    plan: string
    source: "environment" | "database" | null
    license: InstanceLicenseKey | null
    usage: {users: number}
}

const status = (error: unknown) =>
    (error as {response?: {status?: number}} | null)?.response?.status

/** The API refuses a reader who is not the instance admin; that is an answer, not a failure. */
export const isNotInstanceAdmin = (error: unknown) => status(error) === 403

export const isInvalidLicenseKey = (error: unknown) => status(error) === 400

export const fetchInstanceLicense = async (projectId: string): Promise<InstanceLicense> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/instance/license`, {
        params: {project_id: projectId},
    })
    return data
}

export const activateInstanceLicense = async (
    projectId: string,
    key: string,
): Promise<InstanceLicense> => {
    const {data} = await axios.put(
        `${getAgentaApiUrl()}/instance/license`,
        {key},
        {params: {project_id: projectId}},
    )
    return data
}

/** The API could not reach Agenta's registration service. */
export const isRegistrationUnreachable = (error: unknown) => status(error) === 502

/** `POST /instance/license/registrations`: Agenta emails a free registration key. */
export const createInstanceRegistration = async (
    projectId: string,
    email: string,
): Promise<{email: string}> => {
    const {data} = await axios.post(
        `${getAgentaApiUrl()}/instance/license/registrations`,
        {email, product_updates: true},
        {params: {project_id: projectId}},
    )
    return data
}
