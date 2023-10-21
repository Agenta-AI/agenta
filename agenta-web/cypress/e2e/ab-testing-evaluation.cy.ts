import {randString} from "../../src/lib/helpers/utils"

describe("Regex Evaluation workflow", () => {
    let app_v2 = randString(5)
    let app_id
    // before(() => {
    //     cy.createVariantsAndTestsets()
    //     cy.get("@app_id").then((appId) => {
    //         app_id = appId
    //     })
    // })

    context("SHould create second variant", () => {
        beforeEach(() => {
            cy.visit(`/apps/653390289453efd2d0a7aa32/playground`)
        })

        it("When", () => {
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

        it("check if user has more than one variant", () => {
            cy.get(".ant-tabs-nav-list").within(() => {
                cy.get(".ant-tabs-tab").should("have.length.gt", 1)
            })
        })
    })

    // context("When navigating to Evaluation Page", () => {
    //     it("Should reach the Evaluation Page", () => {
    //         cy.visit(`/apps/653390289453efd2d0a7aa32/playground`)
    //         cy.clickLinkAndWait('[data-cy="app-evaluations-link"]')
    //         cy.url().should("include", "/evaluations")
    //     })
    // })

    // context("When Variant and Testset are Selected", () => {
    //     beforeEach(() => {
    //         cy.visit(`/apps/${app_id}/evaluations`)
    //         cy.clickLinkAndWait('[data-cy="regex-button"]')

    //         cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseover")
    //         cy.get('[data-cy="variant-0"]').click()
    //         cy.get('[data-cy="variants-dropdown-0"]').trigger("mouseout")

    //         cy.get('[data-cy="selected-testset"]').trigger("mouseover")
    //         cy.get('[data-cy="testset-0"]').click()
    //         cy.get('[data-cy="selected-testset"]').trigger("mouseout")

    //         cy.clickLinkAndWait('[data-cy="start-new-evaluation-button"]')

    //         cy.location("pathname").should("include", "/auto_regex_test")

    //         cy.get(".ant-form-item-explain-error").should("not.exist")
    //     })

    // })

    // after(() => {
    //     cy.cleanupVariantAndTestset()
    // })
})
