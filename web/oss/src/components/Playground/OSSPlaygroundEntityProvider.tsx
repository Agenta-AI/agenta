/**
 * OSS Playground Entity Provider
 *
 * Wires OSS-specific entity implementations (legacyAppRevisionMolecule,
 * evaluatorMolecule) into the package's PlaygroundEntityProvider.
 *
 * Follows the same pattern as OSSdrillInUIProvider for DrillInView.
 */

import {useEffect, useMemo, type ReactNode} from "react"

import {evaluatorMolecule} from "@agenta/entities/evaluator"
import {evaluatorRevisionMolecule} from "@agenta/entities/evaluatorRevision"
import {
    legacyAppRevisionMolecule,
    appRevisionsWithDraftsAtomFamily,
    ossAppToVariantRelation,
    ossVariantToRevisionRelation,
} from "@agenta/entities/legacyAppRevision"
import {legacyEvaluatorMolecule} from "@agenta/entities/legacyEvaluator"
import {
    PlaygroundEntityProvider,
    type PlaygroundEntityProviders,
    executionItemController,
    playgroundController,
} from "@agenta/playground"
import {useSetAtom} from "jotai"

import {getJWT} from "@/oss/services/api"

// Side-effect: registers runnableBridge + CRUD callbacks with playground package
import "@/oss/state/newPlayground/legacyEntityBridge"

const ossEntityProviders: PlaygroundEntityProviders = {
    appRevision: {
        selectors: {
            data: (id: string) => legacyAppRevisionMolecule.atoms.data(id),
            query: (id: string) => legacyAppRevisionMolecule.atoms.query(id),
            isDirty: (id: string) => legacyAppRevisionMolecule.atoms.isDirty(id),
        },
        lists: {
            variantsForApp: (appId: string) => ossAppToVariantRelation.listAtomFamily?.(appId),
            revisionsForVariant: (variantId: string) =>
                ossVariantToRevisionRelation.listAtomFamily?.(variantId),
            allRevisions: appRevisionsWithDraftsAtomFamily,
            isReady: playgroundController.selectors.revisionsReady(),
        },
        // CRUD actions are handled via runnableBridge (registered in legacyEntityBridge.ts).
        // invalidateQueries is available here for direct provider consumers.
        actions: {
            invalidateQueries: playgroundController.actions.invalidateQueries,
        } as PlaygroundEntityProviders["appRevision"]["actions"],
    },
    // New evaluator entity (workflow-based SimpleEvaluator)
    evaluator: {
        selectors: {
            data: (id: string) => evaluatorMolecule.selectors.data(id),
            query: (id: string) => evaluatorMolecule.selectors.query(id),
            isDirty: (id: string) => evaluatorMolecule.selectors.isDirty(id),
            uri: (id: string) => evaluatorMolecule.selectors.uri(id),
            evaluatorKey: (id: string) => evaluatorMolecule.selectors.evaluatorKey(id),
            parameters: (id: string) => evaluatorMolecule.selectors.parameters(id),
            isCustom: (id: string) => evaluatorMolecule.selectors.isCustom(id),
        },
    },
    // Legacy evaluator entity (SimpleEvaluator facade — flat list, no variant/revision hierarchy)
    legacyEvaluator: {
        selectors: {
            data: (id: string) => legacyEvaluatorMolecule.selectors.data(id),
            query: (id: string) => legacyEvaluatorMolecule.selectors.query(id),
            isDirty: (id: string) => legacyEvaluatorMolecule.selectors.isDirty(id),
            uri: (id: string) => legacyEvaluatorMolecule.selectors.uri(id),
            evaluatorKey: (id: string) => legacyEvaluatorMolecule.selectors.evaluatorKey(id),
            parameters: (id: string) => legacyEvaluatorMolecule.selectors.parameters(id),
            isCustom: (id: string) => legacyEvaluatorMolecule.selectors.isCustom(id),
        },
    },
    // Legacy evaluator revision (stub — kept for backward compatibility)
    evaluatorRevision: {
        selectors: {
            data: evaluatorRevisionMolecule.selectors.data,
            query: evaluatorRevisionMolecule.selectors.query,
            isDirty: evaluatorRevisionMolecule.selectors.isDirty,
            presets: evaluatorRevisionMolecule.selectors.presets,
        },
        actions: {
            applyPreset: evaluatorRevisionMolecule.actions.applyPreset,
        },
    },
}

/** Stable ref: returns auth headers for worker HTTP requests */
const getAuthHeaders = async () => {
    const jwt = await getJWT()
    return jwt ? {Authorization: `Bearer ${jwt}`} : {}
}

export function OSSPlaygroundEntityProvider({children}: {children: ReactNode}) {
    const providers = useMemo(() => ossEntityProviders, [])
    const setHeaders = useSetAtom(executionItemController.actions.setExecutionHeaders)
    // Register the auth headers provider once on mount
    useEffect(() => {
        setHeaders(() => getAuthHeaders)
    }, [setHeaders])

    return <PlaygroundEntityProvider providers={providers}>{children}</PlaygroundEntityProvider>
}
