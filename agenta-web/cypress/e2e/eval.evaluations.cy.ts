import {randString} from "../../src/lib/helpers/utils"

describe("Evaluations CRUD Operations Test", function () {
    let newEvalName = randString(5)
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("Executing Evaluations CRUD operations", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
        })

        it("Should successfully create an Evaluation", () => {
            cy.createNewEvaluation()
        })

        it("Should throw warning when creating an evaluation without selecting testset, variants, and evaluators", () => {
            cy.get('[data-cy="new-evaluation-button"]').click()
            cy.get(".ant-modal-content").should("exist")

            cy.get(".ant-modal-footer > .ant-btn-primary").click()
            cy.get(".ant-message").should("contain.text", "Please select a test set")
        })

        it("Should verify the successful creation and completion of the evaluation", () => {
            cy.get(".ant-table-row").eq(0).should("exist")
            cy.get('[data-cy="evaluation-status-cell"]').should("contain.text", "Completed")
        })

        it("Should select evaluation and successfully delete it", () => {
            cy.get(".ant-checkbox-wrapper").should("exist")
            cy.get(".ant-checkbox-input").eq(0).check()
            cy.get('[data-cy="delete-evaluation-button"]').click()

            cy.get(".ant-modal-content").should("exist")
            cy.get(".ant-modal-footer > .ant-btn-primary").click()
        })
    })

    context("Executing Evaluation with different answer column", () => {
        it("Should successfully rename the testset columns", () => {
            cy.visit(`/testsets`)
            cy.location("pathname").should("include", "/testsets")
            cy.get(".ant-table-row").eq(0).click()
            cy.wait(1000)
            cy.contains(/create a new test set/i).should("be.visible")
            cy.get(".ag-root").should("exist")
            cy.wait(3000)
            cy.get('[data-cy="testset-header-column-edit-button"]').eq(1).click()
            cy.get('[data-cy="testset-header-column-edit-input"]').clear()
            cy.get('[data-cy="testset-header-column-edit-input"]').type("answer")
            cy.get('[data-cy="testset-header-column-save-button"]').click()
            cy.get('[data-cy="testset-save-button"]').click()
        })

        it("Should successfully create an Evaluator", () => {
            cy.visit(`/apps/${app_id}/evaluations?configureEvaluatorModal=open`)
            cy.url().should("include", "/evaluations?configureEvaluatorModal=open")
            cy.get(".ant-modal-content").should("exist")
            cy.get('[data-cy="create-new-evaluator-button"]').click()
            cy.get('[data-cy="new-evaluator-list"]').eq(2).click()
            cy.contains(/configure new evaluator/i)
            cy.get('[data-cy="configure-new-evaluator-modal-input"]').type(newEvalName)

            cy.get('[data-cy="new-evaluator-advance-settings"]').click()
            cy.get('[data-cy="new-evaluator-advance-settings-input"]').clear()
            cy.get('[data-cy="new-evaluator-advance-settings-input"]').type("answer")
            cy.get('[data-cy="configure-new-evaluator-modal-save-btn"]').click()
            cy.get('[data-cy="evaluator-list"]').should("have.length.gt", 2)
        })

        it("Should successfully create an Evaluation", () => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
            cy.createNewEvaluation(newEvalName)
        })

        it("Should verify the successful creation and completion of the evaluation", () => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
            cy.get(".ant-table-row").eq(0).should("exist")
            cy.get('[data-cy="evaluation-status-cell"]').should("contain.text", "Completed")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
