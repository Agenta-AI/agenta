import {randString} from "../../src/lib/helpers/utils"

describe("Evaluation Comparison Test", function () {
    let app_id
    let app_v2 = randString(5)
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("When creating an app variant", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
        })

        it("Should successfully create a new app variant", () => {
            cy.clickLinkAndWait("button.ant-tabs-nav-add")
            cy.get('[data-cy="new-variant-modal"]').should("exist")
            cy.get('[data-cy="new-variant-modal-select"]').click()
            cy.get('[data-cy^="new-variant-modal-label"]').contains("app.default").click()
            cy.get('[data-cy="new-variant-modal-input"]').type(app_v2)
            cy.get('[data-cy="new-variant-modal"]').within(() => {
                cy.get("button.ant-btn").contains(/ok/i).click()
            })
            cy.url().should("include", `/playground?variant=app.${app_v2}`)
            cy.get('[data-cy="playground-save-changes-button"]').eq(1).click()
            cy.get('[data-cy="playground-publish-button"]').should("exist")
            cy.get(".ant-message-notice-content").should("exist")
        })

        it("Should verify user has more than one app variant", () => {
            cy.get(".ant-tabs-nav-list").within(() => {
                cy.get(".ant-tabs-tab").should("have.length.gt", 1)
            })
        })
    })

    context("Executing Evaluation Comparison Workflow", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.location("pathname").should("include", "/evaluations")
        })

        it("Should create 2 new Evaluations", () => {
            cy.createNewEvaluation()
        })

        it("Should verify that there are completed evaluations in the list", () => {
            cy.get(".ant-table-row").eq(0).should("exist")
            cy.get(".ant-table-row").eq(1).should("exist")
            cy.get('[data-cy="evaluation-status-cell"]', {timeout: 60000})
                .eq(0)
                .should("contain.text", "Completed")
            cy.get('[data-cy="evaluation-status-cell"]', {timeout: 60000})
                .eq(1)
                .should("contain.text", "Completed")
        })

        it("Should select 2 evaluations, click on the compare button, and successfully navigate to the comparison page", () => {
            cy.get(".ant-checkbox-input").eq(0).check()

            cy.get('[data-cy="evaluation-results-compare-button"]').should("not.be.disabled")
            cy.get('[data-cy="evaluation-results-compare-button"]').click()
            cy.location("pathname").should("include", "/evaluations/results/compare")
            cy.contains(/Evaluations Comparison/i)
            cy.get('[data-cy="evaluation-compare-table"]').should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
