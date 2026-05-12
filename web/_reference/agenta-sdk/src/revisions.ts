/**
 * Agenta TypeScript SDK — Revisions manager.
 *
 * Git-style revision operations for applications.
 *
 * Endpoints:
 *   POST /preview/applications/revisions/retrieve  → retrieve
 *   POST /preview/applications/revisions/commit     → commit
 *   POST /preview/applications/revisions/log        → log
 */

import type {AgentaClient} from "./client"
import type {
    ApplicationRevision,
    ApplicationRevisionCommit,
    ApplicationRevisionCommitRequest,
    ApplicationRevisionRetrieveRequest,
    ApplicationRevisionResponse,
    ApplicationRevisionsResponse,
    ApplicationRevisionsLogRequest,
    Reference,
} from "./types"

export class Revisions {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Retrieve a specific revision using flexible references.
     *
     * At least one reference must be provided:
     *   - By app: { applicationRef: { slug: "my-app" } }
     *   - By variant: { applicationVariantRef: { id: "..." } }
     *   - By revision: { applicationRevisionRef: { id: "..." } }
     *   - By environment: { environmentRef: { slug: "production" }, key: "my-key" }
     */
    async retrieve(options: {
        applicationRef?: Reference
        applicationVariantRef?: Reference
        applicationRevisionRef?: Reference
        environmentRef?: Reference
        environmentVariantRef?: Reference
        environmentRevisionRef?: Reference
        key?: string
        resolve?: boolean
    }): Promise<ApplicationRevisionResponse> {
        const body: ApplicationRevisionRetrieveRequest = {
            application_ref: options.applicationRef,
            application_variant_ref: options.applicationVariantRef,
            application_revision_ref: options.applicationRevisionRef,
            environment_ref: options.environmentRef,
            environment_variant_ref: options.environmentVariantRef,
            environment_revision_ref: options.environmentRevisionRef,
            key: options.key,
            resolve: options.resolve,
        }
        return this.client.post<ApplicationRevisionResponse>(
            "/applications/revisions/retrieve",
            body,
        )
    }

    /**
     * Retrieve a revision by application slug.
     * Convenience wrapper around retrieve().
     */
    async retrieveBySlug(
        slug: string,
        options?: {resolve?: boolean},
    ): Promise<ApplicationRevision | null> {
        const res = await this.retrieve({
            applicationRef: {slug},
            resolve: options?.resolve,
        })
        return res.application_revision ?? null
    }

    /**
     * Retrieve a revision by application ID.
     * Convenience wrapper around retrieve().
     */
    async retrieveByAppId(
        applicationId: string,
        options?: {resolve?: boolean},
    ): Promise<ApplicationRevision | null> {
        const res = await this.retrieve({
            applicationRef: {id: applicationId},
            resolve: options?.resolve,
        })
        return res.application_revision ?? null
    }

    /**
     * Commit a new revision to an application.
     *
     * Creates a versioned snapshot with optional commit message.
     */
    async commit(revision: ApplicationRevisionCommit): Promise<ApplicationRevisionResponse> {
        const body: ApplicationRevisionCommitRequest = {
            application_revision_commit: revision,
        }
        return this.client.post<ApplicationRevisionResponse>("/applications/revisions/commit", body)
    }

    /**
     * Get the revision log (version history) for an application.
     */
    async log(options: {
        applicationId?: string
        applicationVariantId?: string
        applicationRevisionId?: string
        depth?: number
    }): Promise<ApplicationRevisionsResponse> {
        const body: ApplicationRevisionsLogRequest = {
            application: {
                application_id: options.applicationId,
                application_variant_id: options.applicationVariantId,
                application_revision_id: options.applicationRevisionId,
                depth: options.depth,
            },
        }
        return this.client.post<ApplicationRevisionsResponse>("/applications/revisions/log", body)
    }
}
