describe("Exact Match Evaluation workflow", () => {
    let app_id
    let testset_name
    before(() => {
        cy.createVariantsAndTestsets()
        cy.get("@app_id").then((appId) => {
            app_id = appId
        })
        cy.get("@testsetName").then((testsetName) => {
            testset_name = testsetName
        })
    })

    context("When navigating to Evaluation Page", () => {
        it("Should reach the Evaluation Page", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.contains(/modify parameters/i)
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When executing the evaluation", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/evaluations`)
            cy.url().should("include", "/evaluations")
        })

        it("Should execute evaluation workflow successfully", () => {
            cy.get('[data-cy="exact-match-button"]').click()

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy^="testset"]').contains(testset_name).click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')

            cy.url().should("include", "/auto_exact_match")
            cy.wait(1500)
            cy.get('[data-cy="exact-match-evaluation-button"]').click()

            cy.get('[data-cy="exact-match-evaluation-score"]')
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "correct" or "wrong"
                    expect(text.includes("correct") || text.includes("wrong")).to.be.true
                })
        })

        it("Should display Exact Match Evaluation result", () => {
            cy.get('[data-cy="automatic-evaluation-result"]').within(() => {
                cy.get("tr").last().should("contain.text", "Exact Match")
            })
        })
    })

    after(() => {
        cy.cleanupVariantAndTestset()
    })
})
