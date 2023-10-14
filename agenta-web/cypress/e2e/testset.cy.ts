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
        cy.wait(500)
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

    it.only("successfully tests test-set exact match evaluation", () => {
        const testsetName = randString(8)
        const countriesAndCapitals = [
            {country: "Portugal", capital: "Lisbon"},
            {country: "Brazil", capital: "Brasília"},
            {country: "Spain", capital: "Madrid"},
        ]

        cy.get('[data-cy="testset-name-input"]').type(testsetName)
        cy.wait(500)

        countriesAndCapitals.forEach((row, index) => {
            cy.get('[col-id="country"]')
                .eq(index + 1)
                .as("countryColumn") // get the first column after the header
            cy.get("@countryColumn").click()
            cy.get("@countryColumn").find("input").type(row.country)

            cy.get('[col-id="correct_answer"]')
                .eq(index + 1)
                .as("answerColumn") // get the first row after the header
            cy.get("@answerColumn").click()
            cy.get("@answerColumn")
                .find("input")
                .type(`The capital of ${row.country} is ${row.capital}.`)
        })

        cy.get('[data-cy="testset-save-button"]').click()
        cy.wait(500) // Avoid 'Unsaved changes' modal

        cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        cy.url().should("include", "/evaluations")

        cy.get('[data-cy="automatic-radio-button-exact-match"]').click()

        cy.get('[data-cy="variant-select-0"]').click()
        cy.get(".ant-dropdown-menu").first().find("li").first().click()

        cy.get('[data-cy="testset-select"]').click()
        cy.get(".ant-dropdown-menu").last().contains("span", testsetName).click()

        cy.get('[data-cy="start-evaluation-button"]').click()

        cy.wait(1000)

        cy.url().should("include", "/auto_exact_match")

        cy.get('[data-cy="exact-match-evaluation-button"]').click()

        cy.wait(5000)

        cy.get(".ant-statistic-content-value").first().should("contain", "3 out of 3")

        cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
        cy.url().should("include", "/evaluations")

        cy.wait(1000)

        cy.get(".ant-table-row").last().as("evaluationRow")

        cy.get("@evaluationRow").contains("span", testsetName)
        cy.get("@evaluationRow").find(".ant-statistic").contains("100")
    })
})
