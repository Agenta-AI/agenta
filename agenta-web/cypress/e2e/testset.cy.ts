import {randString} from "../../src/lib/helpers/utils"

describe("create a new testset", () => {
    beforeEach(() => {
        // navigate to the new testset page
        cy.visit("/apps")
        cy.clickLinkAndWait('[data-cy="app-card-link"]')
        cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
        cy.clickLinkAndWait('[data-cy="testset-new-manual-link"]')
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
        cy.get('[data-cy="testset-save-button"]').click()
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
