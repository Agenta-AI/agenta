# SDK Gaps & Implementation Priorities

> What needs to be added to the TS SDK for auto-agenta to work.

---

## Current SDK State (as of this writing)

### Implemented ✅
| Module | Status | Notes |
|---|---|---|
| HTTP Client | Complete | Fetch-based, auth, timeouts, error handling |
| Types | Complete | 900+ lines, mirrors Python DTOs |
| Applications | Complete | CRUD, query, archive/unarchive, findBySlug |
| Revisions | Complete | Retrieve, commit, log |
| Evaluators | Complete | CRUD, revision management |
| Evaluations | Complete | Runs, scenarios, results, metrics, simple evaluations |
| Tracing | Complete | Spans, traces query and retrieval |
| Workflows | Complete | Full CRUD, variants, revisions, interface schemas |

### Missing ❌
| Module | Priority | Blocks |
|---|---|---|
| **Test Sets** | P0 — Critical | Everything. Can't evaluate without test sets. |
| **Environments** | P1 — High | Deployment step. Can't promote variants to production. |
| **Online Evaluation** | P1 — High | Monitoring step. Can't set up continuous evaluation. |
| **Trace Annotation** | P2 — Medium | Trace-to-test-set conversion. |

---

## P0: Test Sets Manager

### What We Need

Based on Agenta docs, test sets support:
- CRUD operations (create, read, update, delete)
- Revision model (each update creates a new revision, stable ID)
- Column schema (inputs, expected outputs, annotations)
- Import from CSV, traces, or programmatic creation

### Proposed Interface

```typescript
class TestSets {
  // Core CRUD
  create(options: {
    name: string;
    data: TestCaseData[];
    description?: string;
  }): Promise<TestSet>;

  query(filter?: {
    name?: string;
    ids?: string[];
  }): Promise<TestSet[]>;

  get(id: string): Promise<TestSet>;
  getRevision(revisionId: string): Promise<TestSetRevision>;

  // Upsert — full replacement, creates new revision
  upsert(name: string, data: TestCaseData[]): Promise<TestSet>;

  // Incremental — add cases to existing set
  addCases(testSetId: string, cases: TestCaseData[]): Promise<TestSetRevision>;

  // From traces
  createFromTraces(options: {
    name: string;
    traceIds: string[];
    columnMapping?: Record<string, string>;  // trace field → test set column
  }): Promise<TestSet>;

  // Delete
  delete(id: string): Promise<void>;
}

interface TestCaseData {
  [key: string]: unknown;  // flexible schema
  // Convention:
  // - inputs go in arbitrary keys
  // - `correct_answer` or `expected_output` for ground truth
  // - `_metadata` for annotations
}
```

### Open Questions for agenta agent
1. What are the actual REST endpoints for test set CRUD?
2. Is there a schema definition for test set columns, or is it freeform?
3. How does the revision model work — does `upsert` create a new revision automatically?
4. Is `createFromTraces` an API call, or do we need to fetch traces and construct test cases client-side?

---

## P1: Environments Manager

### What We Need

Deploy a specific revision to an environment (dev, staging, production).

### Proposed Interface

```typescript
class Environments {
  list(): Promise<Environment[]>;
  get(slug: string): Promise<Environment>;

  // Deploy a revision to an environment
  deploy(options: {
    applicationRef: Reference;
    revisionRef: Reference;
    environmentSlug: string;  // "production", "staging", etc.
  }): Promise<void>;

  // Get current deployment for an environment
  getDeployment(options: {
    applicationRef: Reference;
    environmentSlug: string;
  }): Promise<{ revision: ApplicationRevision; deployedAt: string }>;
}
```

**Note**: The seed script already uses a deploy endpoint (`/api/applications/revisions/deploy`). This just needs to be formalized in the SDK.

---

## P1: Online Evaluation Configuration

### What We Need

Set up continuous evaluation on live traces.

### Proposed Interface

```typescript
class OnlineEvaluation {
  // Configure online evaluation for an application
  create(options: {
    applicationRef: Reference;
    evaluatorRefs: Reference[];
    samplingRate: number;      // 0.0 to 1.0
    filterBy?: {
      variant?: string;
      environment?: string;
      metadata?: Record<string, unknown>;
    };
  }): Promise<OnlineEvaluationConfig>;

  list(applicationRef: Reference): Promise<OnlineEvaluationConfig[]>;
  update(id: string, options: Partial<OnlineEvaluationConfig>): Promise<void>;
  delete(id: string): Promise<void>;

  // Get aggregated online evaluation results
  getResults(id: string, options?: {
    timeRange?: { from: string; to: string };
  }): Promise<OnlineEvaluationResults>;
}
```

### Open Questions for agenta agent
1. What's the API for configuring online evaluations? Is it the same as the UI?
2. Can online evaluations use the same evaluator definitions as offline ones?
3. How are sampling and filtering configured at the API level?

---

## P2: Trace Annotation

### What We Need

Ability to annotate traces (label them as good/bad, add metadata) for downstream use in test set creation.

### Proposed Interface

```typescript
// Extension to existing Tracing class
class Tracing {
  // ... existing methods ...

  annotate(traceId: string, annotation: {
    score?: number;
    label?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;

  getAnnotations(traceId: string): Promise<Annotation[]>;

  queryAnnotated(filter: {
    minScore?: number;
    label?: string;
    timeRange?: { from: string; to: string };
  }): Promise<AnnotatedTrace[]>;
}
```

---

## Implementation Order

For the auto-agenta POC:

```
Week 1: Test Sets CRUD (unblocks everything)
Week 2: Environment deployment (unblocks promotion)
Week 3: Online evaluation config (unblocks monitoring)
Week 4: Trace annotation (enables trace→test set pipeline)
```

The orchestration layer (auto-agenta agent logic) can start development in parallel once Test Sets are available — it can run offline evaluations immediately.
