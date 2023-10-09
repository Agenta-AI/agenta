describe("Regex Evaluation workflow", () => {
    context("When navigating to Evaluation Page", () => {
        it("Should reach the Evaluation Page", () => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When starting without Selection", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })

        it("Should display a warning to select", () => {
            cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')
            cy.get(".ant-message-notice-content")
                .should("contain.text", "Please select a variant")
                .should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
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

    context("When starting After Selection", () => {
        beforeEach(() => {
            cy.visit("/apps")
            cy.clickLinkAndWait('[data-cy="app-card-link"]')
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

        it("Should user to select 'Match' strategy", () => {
            cy.get('[data-cy="regex-evaluation-input"]').type(`^[A-Z][a-z]*$`)

            cy.get('[data-cy="regex-evaluation-strategy"]').within(() => {
                cy.get("label").eq(0).click()
            })

            cy.clickLinkAndWait('[data-cy="regex-run-evaluation"]')

            cy.get('[data-cy="regex-evaluation-regex-match"]', {timeout: 10000})
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "Match" or "Mismatch"
                    expect(text.includes("Match") || text.includes("Mismatch")).to.be.true
                })
            cy.get('[data-cy="regex-evaluation-score"]', {timeout: 10000})
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "correct" or "wrong"
                    expect(text.includes("correct") || text.includes("wrong")).to.be.true
                })

            cy.get(".ant-message-notice-content").should("exist")
            cy.wait(3000)
            cy.get(".ant-message-notice-content").should("not.exist")
        })

        it("Should user to select 'Mismatch' strategy", () => {
            cy.get('[data-cy="regex-evaluation-input"]').type(`^[A-Z][a-z]*$`)

            cy.get('[data-cy="regex-evaluation-strategy"]').within(() => {
                cy.get("label").eq(1).click()
            })

            cy.clickLinkAndWait('[data-cy="regex-run-evaluation"]')

            cy.get('[data-cy="regex-evaluation-regex-match"]', {timeout: 10000})
                .invoke("text")
                .then((text) => {
                    // Check if the text contains either "Match" or "Mismatch"
                    expect(text.includes("Match") || text.includes("Mismatch")).to.be.true
                })
            cy.get('[data-cy="regex-evaluation-score"]', {timeout: 10000})
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
})
