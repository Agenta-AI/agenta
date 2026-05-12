/**
 * Agenta TypeScript SDK — Environments manager.
 *
 * Environments are deployment targets for app revisions.
 * Instead of always using the latest revision, deploy a specific
 * revision to an environment (e.g. "development", "production")
 * and fetch the deployed version at runtime.
 *
 * Endpoints:
 *   POST /preview/simple/environments/               → create
 *   POST /preview/simple/environments/query           → query (list)
 *   GET  /preview/simple/environments/:id             → get
 *   PUT  /preview/simple/environments/:id             → update
 *   POST /preview/simple/environments/:id/archive     → archive
 *   POST /preview/simple/environments/:id/unarchive   → unarchive
 *   POST /preview/environments/revisions/commit       → deploy (link revision to env)
 *   POST /preview/environments/revisions/resolve      → resolve (get deployed data)
 */

import {schemas, validateBoundary, type SchemaOf} from "./.generated/index"
import type {AgentaClient} from "./client"
import type {
    SimpleEnvironment,
    SimpleEnvironmentCreate,
    SimpleEnvironmentQuery,
    SimpleEnvironmentCreateRequest,
    SimpleEnvironmentEditRequest,
    SimpleEnvironmentQueryRequest,
    SimpleEnvironmentResponse,
    SimpleEnvironmentsResponse,
    EnvironmentRevisionResolveRequest,
    Reference,
    Windowing,
} from "./types"

export class Environments {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Create a new environment.
     */
    async create(environment: SimpleEnvironmentCreate): Promise<SimpleEnvironmentResponse> {
        const body: SimpleEnvironmentCreateRequest = {environment}
        return this.client.post<SimpleEnvironmentResponse>("/simple/environments/", body)
    }

    /**
     * Query environments with optional filtering and pagination.
     */
    async query(options?: {
        filter?: SimpleEnvironmentQuery
        refs?: Reference[]
        includeArchived?: boolean
        windowing?: Windowing
    }): Promise<SimpleEnvironmentsResponse> {
        const body: SimpleEnvironmentQueryRequest = {
            environment: options?.filter,
            environment_refs: options?.refs,
            include_archived: options?.includeArchived,
            windowing: options?.windowing,
        }
        return this.client.post<SimpleEnvironmentsResponse>("/simple/environments/query", body)
    }

    /**
     * List all environments.
     */
    async list(): Promise<SimpleEnvironment[]> {
        const res = await this.query()
        return res.environments
    }

    /**
     * Get an environment by ID.
     */
    async get(environmentId: string): Promise<SimpleEnvironment | null> {
        const res = await this.client.get<SimpleEnvironmentResponse>(
            `/simple/environments/${environmentId}`,
        )
        return res.environment ?? null
    }

    /**
     * Find an environment by slug.
     */
    async findBySlug(slug: string): Promise<SimpleEnvironment | null> {
        const res = await this.query({refs: [{slug}]})
        return res.environments[0] ?? null
    }

    /**
     * Ensure an environment exists. Creates it if not found.
     * Returns the environment (existing or newly created).
     */
    async ensureExists(slug: string, name: string): Promise<SimpleEnvironment> {
        const existing = await this.findBySlug(slug)
        if (existing) return existing

        const res = await this.create({slug, name})
        return res.environment!
    }

    /**
     * Deploy an app revision to an environment.
     *
     * Uses the delta.set format to commit an environment revision
     * that references the app revision. Matches the frontend's
     * `deployToEnvironment` pattern.
     */
    async deploy(options: {
        environmentId: string
        environmentVariantId: string
        /** The app (workflow/artifact) ID */
        appId: string
        appSlug?: string
        /** The app variant ID */
        appVariantId?: string
        /** The specific app revision ID to deploy */
        appRevisionId: string
        appRevisionVersion?: string
        message?: string
    }): Promise<SchemaOf<"EnvironmentRevisionResponse">> {
        const appKey = options.appSlug ? `${options.appSlug}.revision` : `${options.appId}.revision`

        const slug = Math.random().toString(36).slice(2, 14)

        const body = {
            environment_revision_commit: {
                slug,
                environment_id: options.environmentId,
                environment_variant_id: options.environmentVariantId,
                delta: {
                    set: {
                        [appKey]: {
                            application: {
                                id: options.appId,
                                ...(options.appSlug ? {slug: options.appSlug} : {}),
                            },
                            application_variant: {
                                id: options.appVariantId ?? options.appId,
                            },
                            application_revision: {
                                id: options.appRevisionId,
                                ...(options.appRevisionVersion
                                    ? {version: options.appRevisionVersion}
                                    : {}),
                            },
                        },
                    },
                },
                message: options.message ?? `Deploy ${appKey}`,
            },
        }

        const raw = await this.client.post("/environments/revisions/commit", body)
        return validateBoundary(raw, schemas.EnvironmentRevisionResponse, "Environments.deploy")
    }

    /**
     * Resolve an environment — returns the full deployed revision data
     * with all references resolved.
     *
     * This is the key method for runtime: it tells you exactly which
     * app revision is currently deployed to the environment.
     */
    async resolve(options: {
        environmentRef?: Reference
        environmentVariantRef?: Reference
        environmentRevisionRef?: Reference
        maxDepth?: number
    }): Promise<SchemaOf<"EnvironmentRevisionResolveResponse">> {
        const body: EnvironmentRevisionResolveRequest = {
            environment_ref: options.environmentRef,
            environment_variant_ref: options.environmentVariantRef,
            environment_revision_ref: options.environmentRevisionRef,
            max_depth: options.maxDepth,
        }
        const raw = await this.client.post("/environments/revisions/resolve", body)
        return validateBoundary(
            raw,
            schemas.EnvironmentRevisionResolveResponse,
            "Environments.resolve",
        )
    }

    /**
     * Update an environment.
     */
    async update(
        environmentId: string,
        options: {name?: string; description?: string},
    ): Promise<SimpleEnvironmentResponse> {
        const body: SimpleEnvironmentEditRequest = {
            environment: {id: environmentId, ...options},
        }
        return this.client.put<SimpleEnvironmentResponse>(
            `/simple/environments/${environmentId}`,
            body,
        )
    }

    /**
     * Archive (soft delete) an environment.
     */
    async archive(environmentId: string): Promise<SimpleEnvironmentResponse> {
        return this.client.post<SimpleEnvironmentResponse>(
            `/simple/environments/${environmentId}/archive`,
        )
    }

    /**
     * Unarchive (restore) an environment.
     */
    async unarchive(environmentId: string): Promise<SimpleEnvironmentResponse> {
        return this.client.post<SimpleEnvironmentResponse>(
            `/simple/environments/${environmentId}/unarchive`,
        )
    }

    /**
     * Guard an environment (enable deployment protection).
     */
    async guard(environmentId: string): Promise<SchemaOf<"SimpleEnvironmentResponse">> {
        const raw = await this.client.post(`/simple/environments/${environmentId}/guard`)
        return validateBoundary(raw, schemas.SimpleEnvironmentResponse, "Environments.guard")
    }

    /**
     * Unguard an environment (disable deployment protection).
     */
    async unguard(environmentId: string): Promise<SchemaOf<"SimpleEnvironmentResponse">> {
        const raw = await this.client.post(`/simple/environments/${environmentId}/unguard`)
        return validateBoundary(raw, schemas.SimpleEnvironmentResponse, "Environments.unguard")
    }

    /**
     * Query environment revisions with filtering and pagination.
     */
    async queryRevisions(options?: {
        environmentRefs?: Reference[]
        applicationRefs?: Reference[]
        environmentRevision?: Record<string, unknown>
        windowing?: Windowing
    }): Promise<SchemaOf<"EnvironmentRevisionsResponse">> {
        const body = {
            environment_refs: options?.environmentRefs,
            application_refs: options?.applicationRefs,
            environment_revision: options?.environmentRevision,
            windowing: options?.windowing,
        }
        const raw = await this.client.post("/environments/revisions/query", body)
        return validateBoundary(
            raw,
            schemas.EnvironmentRevisionsResponse,
            "Environments.queryRevisions",
        )
    }
}
