import {randString} from "../../src/lib/helpers/utils"

describe("Evaluators CRUD Operations Test", function () {
    let newEvalName = randString(5)
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("Executing Evaluators CRUD operations", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
            cy.get('[data-cy="evaluation-results-compare-button"]').should("exist")
            cy.get('[data-cy="evaluation-results-delete-button"]').should("exist")
            cy.get('[data-cy="new-evaluation-button"]').should("exist")
            cy.get("#rc-tabs-1-tab-evaluators > :nth-child(2)").click()
        })

        it("Should successfully create an Evaluator", () => {
            cy.get('[data-cy="evaluator-card"]').should("have.length", 1)
            cy.get(".ant-space > :nth-child(2) > .ant-btn").click()
            cy.get('[data-cy="new-evaluator-modal-input"]').type(newEvalName)
            cy.get('[data-cy="new-evaluator-modal-button-0"]').click()
            cy.get(".ant-modal-footer > .ant-btn-primary > :nth-child(2)").click()
            cy.get('[data-cy="evaluator-card"]').should("have.length", 2)
        })

        it("Should click on the edit button and successfully edit an evaluator", () => {
            cy.get('[data-cy^="evaluator-card-edit-button"]').eq(0).click()
            cy.get('[data-cy="new-evaluator-modal-input"]').type("edit")
            cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
        })

        it("Should click on the delete button and successfully delete an evaluator", () => {
            cy.get('[data-cy^="evaluator-card-delete-button"]').eq(0).click()
            cy.get(".ant-modal-confirm-btns > :nth-child(2) > span").click()
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
