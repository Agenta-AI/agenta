import {randString} from "../../src/lib/helpers/utils"

describe("Regex Evaluation workflow", () => {
    let app_id
    context("When creating variants and testsets", () => {
        it("Should create app variant", () => {
            cy.visit("/settings")
            cy.get('[data-cy="apikeys-input"]').type(`${Cypress.env("OPENAI_API_KEY")}`)
            cy.get('[data-cy="apikeys-save-button"]').click()
            cy.visit("/apps")
            cy.get('[data-cy="create-new-app-button"]').click()
            cy.get('[data-cy="add-new-app-modal"]').should("exist")
            cy.get('[data-cy="create-from-template"]').click()
            cy.get('[data-cy="choose-template-modal"]').should("exist")
            cy.get('[data-cy="create-app-button"]').click()
            const appName = randString(5)

            cy.get('[data-cy="enter-app-name-modal"]')
                .should("exist")
                .within(() => {
                    cy.get("input").type(appName)
                })

            cy.get('[data-cy="enter-app-name-modal-button"]').click()
            cy.intercept("POST", "/api/apps/app_and_variant_from_template/").as("postRequest")
            cy.wait("@postRequest", {requestTimeout: 15000}).then((interception) => {
                expect(interception.response.statusCode).to.eq(200)

                cy.intercept("GET", `/api/apps/${interception.response.body.app_id}/variants/`).as(
                    "getRequest",
                )
                cy.wait("@getRequest", {requestTimeout: 15000}).then((interception) => {
                    expect(interception.response.statusCode).to.eq(200)
                })
                cy.url().should("include", `/apps/${interception.response.body.app_id}/playground`)
                app_id = interception.response.body.app_id
            })
        })

        it("Should create testset", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.clickLinkAndWait('[data-cy="app-testsets-link"]')
            cy.clickLinkAndWait('[data-cy="testset-new-manual-link"]')
            const testsetName = randString(5)

            cy.get('[data-cy="testset-name-input"]').type(testsetName)

            cy.get(".ag-row")
                .eq(0)
                .within(() => {
                    cy.get("div.ag-cell")
                        .eq(1)
                        .within(() => {
                            cy.get("span").eq(0).dblclick()
                            cy.get(".ag-input-field-input").type("Germany")
                        })
                })
            cy.get(".ag-row")
                .eq(1)
                .within(() => {
                    cy.get("div.ag-cell")
                        .eq(1)
                        .within(() => {
                            cy.get("span").eq(0).dblclick()
                            cy.get(".ag-input-field-input").type("Sweden")
                        })
                })
            cy.get(".ag-row")
                .eq(2)
                .within(() => {
                    cy.get("div.ag-cell")
                        .eq(1)
                        .within(() => {
                            cy.get("span").eq(0).dblclick()
                            cy.get(".ag-input-field-input").type("France")
                        })
                })
            cy.get('[data-cy="testset-save-button"]').click()
        })
    })

    context("When navigating to Evaluation Page", () => {
        it("Should reach the Evaluation Page", () => {
            cy.visit(`/apps/${app_id}/playground`)
            cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
            cy.url().should("include", "/evaluations")
        })
    })

    context("When starting without Selection", () => {
        beforeEach(() => {
            cy.visit(`/apps/${app_id}/playground`)
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

        it("Should user to select 'Match' strategy", () => {
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

        it("Should user to select 'Mismatch' strategy", () => {
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
