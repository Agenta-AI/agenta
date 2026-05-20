/**
 * Unit tests for environmentMolecule.
 *
 * The environment molecule follows the same createMolecule + extendMolecule pattern
 * as the testset molecule. All write operations make API calls (archive, commit,
 * deploy) so those are out of scope here. We test the pure Jotai layer:
 *
 *   • Molecule shape       — name, atoms, actions, invalidate, revisionsList
 *   • isNewEntity          — always false (no local creation flow)
 *   • Draft operations     — update/discard reducers change draft and isDirty
 *   • Null-safe selectors  — queryOptional / dataOptional with null/undefined
 *   • revisionsList shape  — atoms / reducers / get exposed correctly
 *   • invalidate shape     — list / detail / revisions exposed as functions
 */

import {describe, it, expect} from "vitest"
import {createStore} from "jotai"

import {environmentMolecule} from "../../src/environment/state/environmentMolecule"

// ── helpers ───────────────────────────────────────────────────────────────────

function freshStore() {
    return createStore()
}

// ── Molecule shape ────────────────────────────────────────────────────────────

describe("environmentMolecule shape", () => {
    it("exposes 'environment' as the molecule name", () => {
        expect(environmentMolecule.name).toBe("environment")
    })

    it("exposes atoms namespace", () => {
        expect(typeof environmentMolecule.atoms.data).toBe("function")
        expect(typeof environmentMolecule.atoms.isDirty).toBe("function")
        expect(typeof environmentMolecule.atoms.draft).toBe("function")
        expect(typeof environmentMolecule.atoms.serverData).toBe("function")
        expect(typeof environmentMolecule.atoms.query).toBe("function")
    })

    it("exposes extended atoms for deployments", () => {
        expect(typeof environmentMolecule.atoms.revisionDeployment).toBe("function")
        expect(typeof environmentMolecule.atoms.bySlug).toBe("function")
        expect(typeof environmentMolecule.atoms.appDeployments).toBe("function")
        expect(typeof environmentMolecule.atoms.appDeploymentsBySlug).toBe("function")
        expect(typeof environmentMolecule.atoms.appDeploymentInEnvironment).toBe("function")
    })

    it("exposes top-level data / query / isDirty aliases", () => {
        expect(typeof environmentMolecule.data).toBe("function")
        expect(environmentMolecule.query).toBeDefined()
        expect(typeof environmentMolecule.isDirty).toBe("function")
    })

    it("exposes null-safe queryOptional and dataOptional", () => {
        expect(typeof environmentMolecule.queryOptional).toBe("function")
        expect(typeof environmentMolecule.dataOptional).toBe("function")
    })

    it("exposes actions namespace", () => {
        expect(environmentMolecule.actions.update).toBeDefined()
        expect(environmentMolecule.actions.discard).toBeDefined()
        expect(environmentMolecule.actions.archive).toBeDefined()
        expect(environmentMolecule.actions.toggleGuard).toBeDefined()
        expect(environmentMolecule.actions.commit).toBeDefined()
        expect(environmentMolecule.actions.deploy).toBeDefined()
        expect(environmentMolecule.actions.undeploy).toBeDefined()
        expect(environmentMolecule.actions.revert).toBeDefined()
        expect(environmentMolecule.actions.revertToSnapshot).toBeDefined()
    })

    it("exposes invalidate namespace", () => {
        expect(typeof environmentMolecule.invalidate.list).toBe("function")
        expect(typeof environmentMolecule.invalidate.detail).toBe("function")
        expect(typeof environmentMolecule.invalidate.revisions).toBe("function")
    })

    it("exposes revisionsList namespace", () => {
        expect(environmentMolecule.revisionsList).toBeDefined()
        expect(environmentMolecule.revisionsList.atoms).toBeDefined()
        expect(environmentMolecule.revisionsList.reducers).toBeDefined()
        expect(typeof environmentMolecule.revisionsList.get).toBe("function")
    })

    it("exposes imperative get namespace", () => {
        expect(typeof environmentMolecule.get.data).toBe("function")
        expect(typeof environmentMolecule.get.isDirty).toBe("function")
    })

    it("exposes imperative set namespace", () => {
        expect(typeof environmentMolecule.set.update).toBe("function")
        expect(typeof environmentMolecule.set.discard).toBe("function")
    })
})

// ── isNewEntity ───────────────────────────────────────────────────────────────

describe("environmentMolecule isNewEntity", () => {
    it("isNew is false for any ID (environments have no local creation flow)", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.atoms.isNew("env-1"))).toBe(false)
        expect(store.get(environmentMolecule.atoms.isNew("new-env"))).toBe(false)
        expect(store.get(environmentMolecule.atoms.isNew("local-env"))).toBe(false)
    })
})

// ── Draft operations ──────────────────────────────────────────────────────────

describe("environmentMolecule draft operations", () => {
    it("isDirty is false before any update", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(false)
    })

    it("isDirty is true after calling actions.update", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "Production"})
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(true)
    })

    it("draft atom reflects staged changes", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "Staging"})
        expect(store.get(environmentMolecule.atoms.draft("env-1"))).toMatchObject({
            name: "Staging",
        })
    })

    it("actions.update accumulates across multiple calls", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "First"})
        store.set(environmentMolecule.actions.update, "env-1", {description: "Second"})
        const draft = store.get(environmentMolecule.atoms.draft("env-1"))
        expect(draft).toMatchObject({name: "First", description: "Second"})
    })

    it("actions.discard clears draft and isDirty returns false", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "Pending"})
        store.set(environmentMolecule.actions.discard, "env-1")
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(false)
        expect(store.get(environmentMolecule.atoms.draft("env-1"))).toBeNull()
    })

    it("draft for one env ID does not affect another", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-A", {name: "A"})
        expect(store.get(environmentMolecule.atoms.isDirty("env-B"))).toBe(false)
    })

    it("imperative set.update changes draft", () => {
        const store = freshStore()
        environmentMolecule.set.update("env-1", {name: "Imperative"}, {store})
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(true)
    })

    it("imperative set.discard reverts draft", () => {
        const store = freshStore()
        environmentMolecule.set.update("env-1", {name: "Changed"}, {store})
        environmentMolecule.set.discard("env-1", {store})
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(false)
    })
})

// ── Null-safe selectors ───────────────────────────────────────────────────────

describe("environmentMolecule null-safe selectors", () => {
    it("queryOptional(null) returns atom with isPending=false, data=null", () => {
        const store = freshStore()
        const result = store.get(environmentMolecule.queryOptional(null))
        expect(result.isPending).toBe(false)
        expect(result.data).toBeNull()
    })

    it("queryOptional(undefined) returns atom with isPending=false, data=null", () => {
        const store = freshStore()
        const result = store.get(environmentMolecule.queryOptional(undefined))
        expect(result.isPending).toBe(false)
        expect(result.data).toBeNull()
    })

    it("dataOptional(null) returns null", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.dataOptional(null))).toBeNull()
    })

    it("dataOptional(undefined) returns null", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.dataOptional(undefined))).toBeNull()
    })

    it("queryOptional with a real ID returns a truthy atom (delegates to query family)", () => {
        const atom = environmentMolecule.queryOptional("real-env-id")
        expect(atom).toBeDefined()
        expect(typeof atom).toBe("object")
    })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe("environmentMolecule lifecycle", () => {
    it("lifecycle.isActive is false before any access", () => {
        expect(environmentMolecule.lifecycle.isActive("env-lifecycle-1")).toBe(false)
    })

    it("lifecycle.isActive is true after atoms.serverData is first accessed", () => {
        const store = freshStore()
        store.get(environmentMolecule.atoms.serverData("env-lifecycle-2"))
        expect(environmentMolecule.lifecycle.isActive("env-lifecycle-2")).toBe(true)
    })

    it("lifecycle.isActive is false after cleanup.remove", () => {
        const store = freshStore()
        store.get(environmentMolecule.atoms.serverData("env-lifecycle-3"))
        environmentMolecule.cleanup.remove("env-lifecycle-3")
        expect(environmentMolecule.lifecycle.isActive("env-lifecycle-3")).toBe(false)
    })
})
