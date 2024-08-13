import {randString} from "../../src/lib/helpers/utils"

describe("Evaluations CRUD Operations Test", function () {
    let newEvalName = randString(5)
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get('[data-cy="playground-save-changes-button"]').eq(0).click()
    })

    context("Executing Evaluations CRUD operations", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations/results`)
            cy.location("pathname").should("include", "/evaluations/results")
        })

        it("Should successfully create an Evaluation", () => {
            cy.createNewEvaluation()
        })

        it("Should throw warning when creating an evaluation without selecting testset, variants, and evaluators", () => {
            cy.get('[data-cy="new-evaluation-button"]').click()
            cy.get(".ant-modal-content").should("exist")

            cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
            cy.get(".ant-modal-content").should("contain.text", "This field is required")
        })

        it("Should verify the successful creation and completion of the evaluation", () => {
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-cell[col-id="status"]').should("contain.text", "Completed")
        })

        it("Should select evaluation and successfully delete it", () => {
            cy.get(".ag-root-wrapper").should("exist")
            cy.get("div.ag-selection-checkbox input").eq(0).check()
            cy.get(":nth-child(1) > .ant-btn > .ant-btn-icon > .anticon > svg").click()
            cy.get(".ant-modal-confirm-btns > :nth-child(2) > span").click()
        })
    })

    context("Executing Evaluation with different answer column", () => {
        it("Should successfully rename the testset columns", () => {
            cy.visit(`/apps/${app_id}/testsets`)
            cy.location("pathname").should("include", "/testsets")
            cy.get(".ant-table-row").eq(0).click()
            cy.wait(1000)
            cy.contains(/create a new test set/i).should("be.visible")
            cy.get('[data-cy="testset-header-column-edit-button"]').eq(1).click()
            cy.get('[data-cy="testset-header-column-edit-input"]').clear()
            cy.get('[data-cy="testset-header-column-edit-input"]').type("answer")
            cy.get('[data-cy="testset-header-column-save-button"]').click()
            cy.get('[data-cy="testset-save-button"]').click()
        })

        it("Should successfully create an Evaluator", () => {
            cy.visit(`/apps/${app_id}/evaluations/new-evaluator`)
            cy.location("pathname").should("include", "/evaluations/new-evaluator")
            cy.get('[data-cy="evaluator-card"]').should("exist")
            cy.get(".ant-space > :nth-child(2) > .ant-btn").click()
            cy.get('[data-cy="new-evaluator-modal"]').should("exist")
            cy.get('[data-cy^="select-new-evaluator"]').eq(0).click()
            cy.get('[data-cy="configure-new-evaluator-modal"]').should("exist")
            cy.get('[data-cy="configure-new-evaluator-modal-input"]').type(newEvalName, {
                force: true,
            })
            cy.get('[data-cy="new-evaluator-advance-settings"]').click()
            cy.get('[data-cy="new-evaluator-column-name"]').clear()
            cy.get('[data-cy="new-evaluator-column-name"]').type("answer")
            cy.get('[data-cy="configure-new-evaluator-modal-save-btn"]').click()
            cy.get('[data-cy="evaluator-card"]').should("have.length", 2)
            cy.wait(1000)
        })

        it("Should successfully create an Evaluation", () => {
            cy.visit(`/apps/${app_id}/evaluations/results`)
            cy.location("pathname").should("include", "/evaluations/results")
            cy.createNewEvaluation(newEvalName)
        })

        it("Should verify the successful creation and completion of the evaluation", () => {
            cy.visit(`/apps/${app_id}/evaluations/results`)
            cy.location("pathname").should("include", "/evaluations/results")
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-cell[col-id="status"]').should("contain.text", "Completed")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
