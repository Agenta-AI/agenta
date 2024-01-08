import {randString} from "../../src/lib/helpers/utils"

describe("Evaluators CRUD Test", function () {
    let newEvalName = randString(5)
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("CRUD operation with evaluators", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
        })

        it("should create a new evaluator", () => {
            cy.get("#rc-tabs-1-tab-evaluators > :nth-child(2)").click()
            cy.get('[data-cy="evaluator-card"]').should("have.length", 1)
            cy.get(".ant-space > :nth-child(2) > .ant-btn").click()
            cy.get('[data-cy="new-evaluator-modal-input"]').type(newEvalName)
            cy.get('[data-cy="new-evaluator-modal-button-0"]').click()
            cy.get(".ant-modal-footer > .ant-btn-primary > :nth-child(2)").click()
            cy.get('[data-cy="evaluator-card"]').should("have.length", 2)
        })

        it("should update an evaluator", () => {
            cy.get("#rc-tabs-1-tab-evaluators > :nth-child(2)").click()
            cy.get('[data-cy^="evaluator-card-edit-button"]').eq(0).click()
            cy.get('[data-cy="new-evaluator-modal-input"]').type("edit")
            cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
        })

        it("should delete an evaluator", () => {
            cy.get("#rc-tabs-1-tab-evaluators > :nth-child(2)").click()
            cy.get('[data-cy^="evaluator-card-delete-button"]').eq(0).click()
            cy.get(".ant-modal-confirm-btns > :nth-child(2) > span").click()
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
