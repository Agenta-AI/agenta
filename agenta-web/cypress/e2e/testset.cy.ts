import {randString} from "../../src/lib/helpers/utils"

describe("Testsets crud and UI functionality", () => {
    let app_id
    before(() => {
        cy.createVariant()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
    })

    context("Testing creation process of testset", () => {
        beforeEach(() => {
            // navigate to the new testset page
            cy.visit(`/apps/${app_id}/testsets/new/manual`)
        })

        it("navigates successfully to the new testset page", () => {
            cy.url().should("include", "/testsets/new/manual")
        })

        it("don't allow creation of a testset without a name", () => {
            cy.get('[data-cy="testset-save-button"]').click()
            cy.get('[data-cy="testset-name-reqd-error"]').should("be.visible")
        })

        it("successfully creates the testset and navigates to the list", () => {
            const testsetName = randString(8)
            cy.get('[data-cy="testset-name-input"]').type(testsetName)
            cy.intercept("/api/testsets/*").as("saveTestsetRequest")
            cy.get('[data-cy="testset-save-button"]').click()
            //wait for the save api to complete
            cy.wait("@saveTestsetRequest")
            cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
            cy.url().should("include", "/testsets")

            // validate that the new testset is in the list
            cy.get('[data-cy="app-testset-list"]').as("table")
            cy.get("@table").get(".ant-table-pagination li a").last().click()
            cy.get("@table").contains(testsetName).as("tempTestSet").should("be.visible")

            //cleanup
            cy.get("@tempTestSet")
                .parent()
                .invoke("attr", "data-row-key")
                .then((id) => {
                    cy.request("DELETE", `${Cypress.env().baseApiURL}/testsets/`, {
                        testset_ids: [id],
                    })
                })
        })
    })
})
