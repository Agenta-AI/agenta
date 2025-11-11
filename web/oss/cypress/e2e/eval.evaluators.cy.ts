import {randString} from "../../src/lib/helpers/utils"

describe("Evaluators CRUD Operations Test", function () {
    let newEvalName = randString(5)
    let editedEvalName = randString(5)
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("Executing Evaluators CRUD operations", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations?configureEvaluatorModal=open`)
            cy.url().should("include", "/evaluations?configureEvaluatorModal=open")
        })

        it("Should successfully create an evaluator", () => {
            cy.get(".ant-modal-content").should("exist")
            cy.get('[data-cy="create-new-evaluator-button"]').click()
            cy.get('[data-cy="new-evaluator-list"]').eq(0).click()
            cy.contains(/configure new evaluator/i)
            cy.get('[data-cy="configure-new-evaluator-modal-input"]').type(newEvalName)
            cy.get('[data-cy="configure-new-evaluator-modal-save-btn"]').click()
            cy.get('[data-cy="evaluator-list"]').should("have.length.gt", 2)
        })

        it("Should successfully edit an evaluator", () => {
            cy.get(".ant-modal-content").should("exist")
            cy.get('[data-cy="evaluator-menu-button"]').eq(0).click()
            cy.get(".ant-dropdown-menu").should("be.visible")
            cy.get(".ant-dropdown-menu-item").eq(0).click()
            cy.get('[data-cy="configure-new-evaluator-modal-input"]').clear()
            cy.get('[data-cy="configure-new-evaluator-modal-input"]').type(editedEvalName)
            cy.get('[data-cy="configure-new-evaluator-modal-save-btn"]').click()
        })

        it("Should successfully delete an evaluator", () => {
            cy.get(".ant-modal-content").should("exist")
            cy.get('[data-cy="evaluator-menu-button"]').eq(0).click()
            cy.get(".ant-dropdown-menu").should("be.visible")
            cy.get(".ant-dropdown-menu-item")
                .contains(/delete/i)
                .click()
            cy.get(".ant-modal-footer > .ant-btn-primary").click()
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
