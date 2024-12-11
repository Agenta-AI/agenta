import {randString} from "../../src/lib/helpers/utils"

const countries = [
    {country: "France", capital: "Paris"},
    {country: "Germany", capital: "Berlin"},
    {country: "Sweden", capital: "Stockholm"},
]

describe("Testsets crud and UI functionality", () => {
    before(() => {
        cy.createVariant()
    })

    context("Testing creation process of testset", () => {
        beforeEach(() => {
            // navigate to the new testset page
            cy.visit(`/testsets`)
        })

        it("Should successfully creates the testset and navigates to the list", () => {
            cy.url().should("include", "/testsets")
            cy.get('[data-cy="create-testset-modal-button"]').click()
            cy.get(".ant-modal-content").should("exist")
            cy.get('[data-cy="create-testset-from-scratch"]').click()

            const testsetName = randString(8)
            cy.get('[data-cy="testset-name-input"]').type(testsetName)
            cy.clickLinkAndWait('[data-cy="create-new-testset-button"]')

            cy.get(".ag-row").should("have.length", 1)
            countries.forEach((country, index) => {
                if (index !== 0) {
                    cy.get('[data-cy="add-new-testset-row"]').click()
                }

                cy.get(`.ag-center-cols-container .ag-row[row-index="${index}"]`).within(() => {
                    cy.get(".ag-cell").eq(1).type(country.country)
                    cy.get(".ag-cell")
                        .eq(2)
                        .type(`The capital of ${country.country} is ${country.capital}.`)
                })
            })
            cy.intercept("/api/testsets/*").as("saveTestsetRequest")
            cy.get('[data-cy="testset-save-button"]').click()
            //wait for the save api to complete
            cy.wait("@saveTestsetRequest")
            cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
            cy.url().should("include", "/testsets")

            // validate that the new testset is in the list
            cy.get('[data-cy="app-testset-list"]').as("table")
            cy.get("@table").contains(testsetName).as("tempTestSet").should("be.visible")
        })
    })

    context("When uploading testset", () => {
        const testset_name = randString(8)
        beforeEach(() => {
            cy.visit(`/testsets`)
        })

        it("Should successfully upload a testset", () => {
            cy.url().should("include", "/testsets")

            cy.get('[data-cy="create-testset-modal-button"]').click()
            cy.get(".ant-modal-content").should("exist")
            cy.get('[data-cy="upload-testset"]').click()

            cy.get('[data-cy="upload-testset-file-name"]').type(testset_name)
            cy.get('[type="file"]').selectFile("cypress/data/countries-genders.csv", {force: true})
            cy.wait(1000)
            cy.contains("countries-genders.csv").should("be.visible")
            cy.clickLinkAndWait('[data-cy="testset-upload-button"]')
        })

        it("Should check the uploaded testset is present", () => {
            cy.url().should("include", "/testsets")
            cy.get('[data-cy="app-testset-list"]').as("table")
            cy.get("@table").contains(testset_name).as("tempTestSet").should("be.visible")
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
