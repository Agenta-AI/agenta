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

/** A count against its plan limit; a `null` limit is unlimited. */
export interface LicenseLimitUsage {
    count: number
    limit: number | null
}

/** `GET /instance/license`: the instance plan and its key. Only the instance admin may read it. */
export interface InstanceLicense {
    plan: string
    source: "environment" | "database" | null
    license: InstanceLicenseKey | null
    /** Projects and organizations: read them from `fetchLicenseUsage`, the one source. */
    usage: {users: number}
    /** The admin skipped the one-time registration prompt on this instance. */
    registration_prompt_dismissed?: boolean
}

const status = (error: unknown) =>
    (error as {response?: {status?: number}} | null)?.response?.status

/** The API refuses a reader who is not the instance admin; that is an answer, not a failure. */
export const isNotInstanceAdmin = (error: unknown) => status(error) === 403

export const isInvalidLicenseKey = (error: unknown) => status(error) === 400

/** A free key issued for another instance: it works only where it was registered. */
export const isOtherInstanceKey = (error: unknown) =>
    (error as {response?: {data?: {detail?: {code?: unknown}}}} | null)?.response?.data?.detail
        ?.code === "other_instance"

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

/** `GET /instance/license/usage`: the counts against the plan limits, for any signed-in person. */
export interface LicenseUsage {
    /** The projects of this project's organization, not of the instance. */
    projects: LicenseLimitUsage | null
    /** The organizations on the instance. */
    organizations: LicenseLimitUsage | null
}

export const fetchLicenseUsage = async (projectId: string): Promise<LicenseUsage> => {
    const {data} = await axios.get(`${getAgentaApiUrl()}/instance/license/usage`, {
        params: {project_id: projectId},
    })
    return data
}

/** At or above its limit; an unlimited usage never is. */
export const isAtLimit = (usage: LicenseLimitUsage | null | undefined): boolean =>
    Boolean(usage && usage.limit !== null && usage.count >= usage.limit)

/** The API could not reach Agenta's registration service. */
export const isRegistrationUnreachable = (error: unknown) => status(error) === 502

/** The API refused the request body, which in this form means the email address. */
export const isRegistrationRefused = (error: unknown) => [400, 422].includes(status(error) ?? 0)

/** The setup survey answers as choice labels, never typed text. */
export interface RegistrationSurvey {
    role?: string
    team_size?: string
    heard_from?: string
}

/** `POST /instance/license/registrations`: Agenta emails a free registration key. */
export const createInstanceRegistration = async (
    projectId: string,
    registration: {email: string; productUpdates: boolean; survey?: RegistrationSurvey},
): Promise<{email: string}> => {
    const {data} = await axios.post(
        `${getAgentaApiUrl()}/instance/license/registrations`,
        {
            email: registration.email,
            product_updates: registration.productUpdates,
            ...(registration.survey ? {survey: registration.survey} : {}),
        },
        {params: {project_id: projectId}},
    )
    return data
}

/** `POST /instance/license/registration-prompt/dismiss`: the prompt does not come back. */
export const dismissRegistrationPrompt = async (projectId: string): Promise<void> => {
    await axios.post(
        `${getAgentaApiUrl()}/instance/license/registration-prompt/dismiss`,
        undefined,
        {params: {project_id: projectId}},
    )
}
