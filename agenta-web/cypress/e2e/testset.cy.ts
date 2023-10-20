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

    it("successfully creates the testset and adds options to it", () => {
        const testsetName = randString(8)

        const countries = [
            {country: "USA", capital: "Washington DC", dummy: "Stuff"},
            {country: "Nigeria", capital: "Abuja", dummy: "Thing"},
            {country: "Egypt", capital: "Cairo", dummy: "Nothing"},
            {country: "Ethopia", capital: "Addis Ababa", dummy: "Infinity"},
        ]
        cy.get(".ag-root-wrapper").as("grid")

        // set values for the cells
        cy.get("@grid").find('[row-id="0"]').as("row0")
        cy.get("@grid").find('[row-id="1"]').as("row1")
        cy.get("@grid").find('[row-id="2"]').as("row2")

        countries.slice(0, 3).forEach(({country, capital}, index) => {
            cy.get(`@row${index}`).find('[col-id="country"]').click().type(country)
            cy.get(`@row${index}`).find('[col-id="correct_answer"]').click().type(capital)
        })

        cy.get('[data-cy="testset-name-input"]').type(testsetName)

        // save and go back
        cy.get('[data-cy="testset-save-button"]').as("saveButton").click()
        cy.get(".ant-message-success").should("be.visible")

        cy.get('[data-cy="app-testsets-link"]').as("testsetsLink")
        cy.clickLinkAndWait("@testsetsLink")
        cy.url().should("include", "/testsets")

        // validate that the new testset is in the list
        cy.get('[data-cy="app-testset-list"]').as("table")

        // define a function for navigating to the last table item
        cy.get("@table").get(".ant-table-pagination li a").last().as("last-tesetset-page").click()
        cy.get("@table").contains(testsetName).as("tempTestSet").should("be.visible")

        // set the id of the newly created testset
        let testsetId = ""

        cy.get("@tempTestSet")
            .parent()
            .invoke("attr", "data-row-key")
            .then((id) => {
                testsetId = id
            })

        // navigate to the testset
        cy.get("@tempTestSet").click()
        cy.url().should("include", `/testsets/${testsetId}`)

        countries.slice(0, 3).forEach((countryObj, index) => {
            cy.get("@grid").find(`[row-id="${index}"]`).as("row")

            cy.get(`[row-id="${index}"]`)
                .find('[col-id="country"]')
                .should("contain.text", countryObj.country)
            cy.get(`[row-id="${index}"]`)
                .find('[col-id="correct_answer"]')
                .should("contain.text", countryObj.capital)
        })

        // edit values in the table
        cy.get("@row0").find('[col-id="country"]').click().type(`${countries[0].country}-edit`)
        cy.get("@row0")
            .find('[col-id="correct_answer"]')
            .click()
            .type(`${countries[0].capital}-edit`)
        cy.get("@saveButton").click()
        cy.get(".ant-message-success").should("be.visible")

        // go back to testsets
        cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
        cy.url().should("include", "/testsets")

        // go to the last testset
        cy.get("@last-tesetset-page").click()
        cy.get("@tempTestSet").click()

        // verify that the edits were applied
        cy.get("@table").get(".ant-table-pagination li a").last().click()
        cy.get("@row0")
            .find('[col-id="country"]')
            .should("contain.text", `${countries[0].country}-edit`)
        cy.get("@row0")
            .find('[col-id="correct_answer"]')
            .should("contain.text", `${countries[0].capital}-edit`)

        // add a new row
        cy.get("@grid").get('[data-cy="testset-addrow-button"]').click()
        cy.get("@grid").find('[row-id="3"]').as("row3")

        cy.get("@row3").find('[col-id="country"]').click().type(countries[3].country)
        cy.get("@row3").find('[col-id="correct_answer"]').click().type(countries[3].capital)

        cy.get("@saveButton").click()
        cy.get(".ant-message-success").should("be.visible")

        cy.clickLinkAndWait("@testsetsLink")
        cy.get("@last-tesetset-page").click()
        cy.get("@tempTestSet").click()

        cy.get("@row3").should("contain.text", countries[3].country)
        cy.get("@row3").should("contain.text", countries[3].capital)

        // add a new column
        cy.get('[aria-colindex="4"] button').click()
        cy.get('[aria-colindex="4"]').find("button").first().click()

        const countryObjectKeys = Object.keys(countries[0])
        const lastKey = countryObjectKeys[countryObjectKeys.length - 1]

        cy.get('[aria-colindex="4"]').find('input[type="text"]').clear().type(lastKey)
        cy.get('[aria-colindex="4"]').contains("button", "Save").click()

        // fill new column with data
        countries.forEach((countryObj, index) => {
            cy.get("@grid").find(`[row-id="${index}"]`).as("row")
            cy.get("@row").find(`[col-id="${lastKey}"]`).type(countryObj[lastKey])
        })
        cy.get("@saveButton").click()
        cy.get(".ant-message-success").should("be.visible")

        cy.clickLinkAndWait("@testsetsLink")
        cy.get("@last-tesetset-page").click()
        cy.get("@tempTestSet").click()

        // verify that the column and data are present
        cy.get('[aria-colindex="4"]').should(
            "contain.text",
            lastKey[0].toUpperCase() + lastKey.substring(1),
        )
        countries.forEach((countryObj, index) => {
            cy.get("@grid").find(`[row-id="${index}"]`).as("row")
            cy.get("@row").find(`[col-id="${lastKey}"]`).should("contain.text", countryObj[lastKey])
        })

        // delete the last row
        cy.get("@row3").find('input[type="checkbox"]').click()
        cy.get('[data-cy="testset-deleterow-button"]').click()
        cy.get("@saveButton").click()
        cy.get(".ant-message-success").should("be.visible")

        // go back to testsets
        cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
        cy.url().should("include", "/testsets")
        cy.get("@last-tesetset-page").click()
        cy.get("@tempTestSet").click()

        // confirm that the last row has been deleted
        cy.get("@row3").should("not.exist")

        // delete the last column
        cy.get('[aria-colindex="4"]').find("button").eq(1).click()
        cy.get("@saveButton").click()
        cy.get(".ant-message-success").should("be.visible")

        // go back to testsets
        cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
        cy.url().should("include", "/testsets")
        cy.get("@last-tesetset-page").click()
        cy.get("@tempTestSet").click()

        // confirm that the last column has been deleted
        cy.get('[aria-colindex="4"]').should("not.exist")

        // go back to testsets page
        cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
        cy.url().should("include", "/testsets")
        cy.get("@last-tesetset-page").click()

        // cleanup
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
