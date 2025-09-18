import {getDefaultStore} from "jotai"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {fetchJson, getBaseUrl} from "@/oss/lib/api/assets/fetchClient"
import {Environment} from "@/oss/lib/Types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {getProjectValues} from "@/oss/state/project"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchEnvironments = async (appId: string): Promise<Environment[]> => {
    try {
        // Test mode detection and URL construction
        const testApiUrl = process.env.VITEST_TEST_API_URL
        const testProjectId = process.env.VITEST_TEST_PROJECT_ID
        const isTestMode = !!testApiUrl

        let base: string
        let projectId: string | undefined

        if (isTestMode) {
            base = testApiUrl
            projectId = testProjectId
            console.log("🧪 Test mode detected:", {testApiUrl, testProjectId})
        } else {
            const projectValues = getProjectValues()
            base = getBaseUrl()
            projectId = projectValues.projectId
            console.log("🏭 Production mode:", {base, projectId})
        }

        const urlString = `${base}/apps/${appId}/environments?project_id=${projectId}`
        const url = new URL(urlString)

        console.log("🔍 Environments fetcher debug:", {base, urlString, isTestMode})
        console.log("🚀 Calling fetchJson with URL:", urlString)

        const environments = await fetchJson(url)

        console.log("✅ Environments fetcher success:", {count: environments.length})
        console.log("📋 Fetched environments successfully:", environments.length)

        return environments
    } catch (error) {
        console.error("❌ Environments fetcher error:", error)
        throw new Error("Failed to fetch environments")
    }
}

export const createPublishVariant = async (payload: {
    variant_id: string
    revision_id?: string
    environment_name: string
    note?: string
}) => {
    const {projectId} = getProjectValues()
    const {note, revision_id, ..._payload} = payload
    await axios.post(`/environments/deploy?project_id=${projectId}`, {
        ..._payload,
        commit_message: note,
    })
}

export const createPublishRevision = async (payload: {
    revision_id?: string
    environment_ref: string
    application_id?: string
    revision_number?: number
    note?: string
}) => {
    const {projectId} = getProjectValues()
    const store = getDefaultStore()
    const applicationId = payload.application_id || store.get(selectedAppIdAtom)

    if (!applicationId) {
        throw new Error("No application id available for publishRevision")
    }

    await axios.post(`/variants/configs/deploy?project_id=${projectId}`, {
        application_ref: {
            id: applicationId,
            version: null,
            slug: null,
        },
        variant_ref: {
            id: payload.revision_id,
            version: payload.revision_number || null,
            slug: null,
        },
        environment_ref: {
            slug: payload.environment_ref,
            version: null,
            id: null,
            commit_message: payload.note || null,
        },
    })
}
