/**
 * Agenta TypeScript SDK — TestCases manager.
 *
 * Query testcases across test sets and revisions.
 *
 * Endpoints:
 *   POST /preview/testcases/query → query
 */

import {schemas, validateBoundary, type SchemaOf} from "./.generated/index"
import type {AgentaClient} from "./client"
import type {Reference, Windowing} from "./types"

export class TestCases {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Query testcases with filtering and pagination.
     */
    async query(options?: {
        testcaseRefs?: Reference[]
        testsetRevisionRefs?: Reference[]
        windowing?: Windowing
        includeData?: boolean
    }): Promise<SchemaOf<"TestcasesResponse">> {
        const body = {
            testcase_refs: options?.testcaseRefs,
            testset_revision_refs: options?.testsetRevisionRefs,
            windowing: options?.windowing,
            include_data: options?.includeData,
        }
        const raw = await this.client.post("/testcases/query", body)
        return validateBoundary(raw, schemas.TestcasesResponse, "TestCases.query")
    }

    /**
     * Query testcases with pagination windowing.
     * Convenience wrapper that forwards windowing options.
     */
    async queryPage(options?: {
        testcaseRefs?: Reference[]
        testsetRevisionRefs?: Reference[]
        windowing?: Windowing
        includeData?: boolean
    }): Promise<SchemaOf<"TestcasesResponse">> {
        return this.query(options)
    }
}
