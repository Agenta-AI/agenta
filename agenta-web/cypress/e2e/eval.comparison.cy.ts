import {randString} from "../../src/lib/helpers/utils"

describe("Evaluation Comparison Test", function () {
    let app_id
    let app_v2 = randString(5)
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get('[data-cy="playground-save-changes-button"]').eq(0).click()
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
            cy.visit(`/apps/${app_id}/evaluations/results`)
            cy.location("pathname").should("include", "/evaluations/results")
        })

        it("Should create 2 new Evaluations", () => {
            cy.request({
                url: `${Cypress.env().baseApiURL}/evaluations/?app_id=${app_id}`,
                method: "GET",
            }).then((resp) => {
                if (resp.body.length) {
                    cy.get('[data-cy="new-evaluation-button"]').click()
                } else {
                    cy.get('[data-cy="new-evaluation-button__no_variants"]').click()
                }
            })
            cy.get(".ant-modal-content").should("exist")

            cy.get('[data-cy="select-testset-group"]').click()
            cy.get('[data-cy="select-testset-option"]').eq(0).click()

            cy.get('[data-cy="select-variant-group"]').click()
            cy.get('[data-cy="select-variant-option"]').eq(0).click()
            cy.get('[data-cy="select-variant-option"]').eq(1).click()
            cy.get('[data-cy="select-variant-group"]').click()

            cy.get('[data-cy="select-evaluators-group"]').click()
            cy.get('[data-cy="select-evaluators-option"]').eq(0).click()
            cy.get('[data-cy="select-evaluators-group"]').click()

            cy.get(".ant-modal-footer > .ant-btn-primary > .ant-btn-icon > .anticon > svg").click()
            cy.wait(1000)
        })

        it("Should verify that there are completed evaluations in the list", () => {
            cy.get('.ag-row[row-index="0"]').should("exist")
            cy.get('.ag-row[row-index="1"]').should("exist")
            cy.get('.ag-cell[col-id="status"]', {timeout: 60000})
                .eq(0)
                .should("contain.text", "Completed")
            cy.get('.ag-cell[col-id="status"]', {timeout: 60000})
                .eq(1)
                .should("contain.text", "Completed")
        })

        it("Should select 2 evaluations, click on the compare button, and successfully navigate to the comparison page", () => {
            cy.get("div.ag-selection-checkbox input").eq(0).check()
            cy.get("div.ag-selection-checkbox input").eq(1).check()
            cy.get('[data-cy="evaluation-results-compare-button"]').should("not.be.disabled")
            cy.get('[data-cy="evaluation-results-compare-button"]').click()
            cy.location("pathname").should("include", "/evaluations/compare")
            cy.contains(/Evaluations Comparison/i)
            cy.get('[data-cy="evaluation-compare-table"]').should("exist")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
