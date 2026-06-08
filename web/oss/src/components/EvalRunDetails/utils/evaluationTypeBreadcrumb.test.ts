import assert from "node:assert/strict"

import {buildEvaluationTypeBreadcrumb} from "./evaluationTypeBreadcrumb"

assert.deepEqual(
    buildEvaluationTypeBreadcrumb({
        evaluationType: "custom",
        projectURL: "/w/workspace/p/project",
    }),
    {
        label: "SDK Evals",
        href: "/w/workspace/p/project/evaluations?kind=custom",
    },
)

assert.deepEqual(
    buildEvaluationTypeBreadcrumb({
        evaluationType: "auto",
        projectURL: "/w/workspace/p/project",
    }),
    {
        label: "Auto Evals",
        href: "/w/workspace/p/project/evaluations?kind=auto",
    },
)
