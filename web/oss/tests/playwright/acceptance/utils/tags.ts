import {createTagString} from "@agenta/web-tests/playwright/config/testTags"

type AcceptanceTagConfig = {
    caseType?: string
    cost: string
    coverage: string[]
    lens: string
    license: string
    path: string
    plan?: string
    role?: string
    scope: string[]
    speed?: string
}

export const buildAcceptanceTags = ({
    caseType,
    cost,
    coverage,
    lens,
    license,
    path,
    plan,
    role,
    scope,
    speed,
}: AcceptanceTagConfig) => {
    const tags = [
        ...scope.map((value) => createTagString("scope", value)),
        ...coverage.map((value) => createTagString("coverage", value)),
        createTagString("path", path),
        createTagString("lens", lens),
        createTagString("cost", cost),
        createTagString("license", license),
    ]

    if (role) {
        tags.push(createTagString("role", role))
    }

    if (plan) {
        tags.push(createTagString("plan", plan))
    }

    if (caseType) {
        tags.push(createTagString("case", caseType))
    }

    if (speed) {
        tags.push(createTagString("speed", speed))
    }

    return tags
}
