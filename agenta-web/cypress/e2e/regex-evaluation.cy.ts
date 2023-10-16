import {createVariantsAndTestsets, app_id} from "../utils/helpers/createVariantsAndTestsets"

describe("Regex Evaluation workflow", () => {
    createVariantsAndTestsets()

    context("When navigating to Evaluation Page", () => {
        it("Should reach the Evaluation Page", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When no Variant and Testset are Selected", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })

        it("Should display a warning to select Variant", () => {
            cy.clickLinkAndWait('[data-cy="regex-button"]')
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get(".ant-message-notice-content")
                .should("contain.text", "Please select a variant")
                .should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })

        it("Should display a warning to select Testset", () => {
            cy.clickLinkAndWait('[data-cy="regex-button"]')

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get(".ant-message-notice-content")
                .should("contain.text", "Please select a testset")
                .should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })
    })

    context("When Variant and Testset are Selected", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
            cy.clickLinkAndWait('[data-cy="regex-button"]')

            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
            cy.get('[data-cy="variant-0"]').click()
            cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

            cy.get('[data-cy="selected-testset"]').trigger("mouseover")
            cy.get('[data-cy="testset-0"]').click()
            cy.get('[data-cy="selected-testset"]').trigger("mouseout")

            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')

            cy.location("pathname").should("include", "/auto_regex_test")

            cy.get(".ant-form-item-explain-error").should("not.exist")
        })

        it("Should display error for missing regex pattern", () => {
            cy.clickLinkAndWait('[data-cy="regex-run-evaluation"]')

            cy.get(".ant-form-item-explain-error").should("exist")
        })

        it("Should select the 'Match' strategy and run the evaluation", () => {
            cy.get('[data-cy="regex-evaluation-input"]').type(`^[A-Z][a-z]*$`)

            cy.get('[data-cy="regex-evaluation-strategy"]').within(() => {
                cy.get("label").eq(0).click()
            })

            cy.clickLinkAndWait('[data-cy="regex-run-evaluation"]')

            cy.get('[data-cy="regex-evaluation-regex-match"]', {timeout: 15000})
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "Match" or "Mismatch"
                    expect(text.includes("Match") || text.includes("Mismatch")).to.be.true
                })
            cy.get('[data-cy="regex-evaluation-score"]', {timeout: 15000})
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "correct" or "wrong"
                    expect(text.includes("correct") || text.includes("wrong")).to.be.true
                })

            cy.get(".ant-message-notice-content").should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })

        it("Should select the 'Mismatch' strategy and run the evaluation", () => {
            cy.get('[data-cy="regex-evaluation-input"]').type(`^[A-Z][a-z]*$`)

            cy.get('[data-cy="regex-evaluation-strategy"]').within(() => {
                cy.get("label").eq(1).click()
            })

            cy.clickLinkAndWait('[data-cy="regex-run-evaluation"]')

            cy.get('[data-cy="regex-evaluation-regex-match"]', {timeout: 15000})
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "Match" or "Mismatch"
                    expect(text.includes("Match") || text.includes("Mismatch")).to.be.true
                })
            cy.get('[data-cy="regex-evaluation-score"]', {timeout: 15000})
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "correct" or "wrong"
                    expect(text.includes("correct") || text.includes("wrong")).to.be.true
                })
            cy.get(".ant-message-notice-content").should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })
    })

    context("Cleanup", () => {
        it("Should delete app variant", () => {
            cy.visit("/apps")

            cy.request({
                url: `${Cypress.env().baseApiURL}/apps/${app_id}/`,
                method: "DELETE",
                body: {
                    app_id,
                },
            }).then((res) => {
                expect(res.status).to.eq(200)
            })
        })
    })
})
