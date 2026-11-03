"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./lib.cjs");

const { consequenceOf } = load("guard");

test("pay controls are pay", () => {
  for (const label of [
    '- button "Pay now"',
    '- button "Place your order"',
    '- button "Buy now"',
    '- button "Proceed to checkout"',
    '- button "Subscribe for $9.99/month"',
    '- button "Start Premium subscription"',
  ])
    assert.equal(consequenceOf(label), "pay", label);
});

test("delete controls are delete", () => {
  for (const label of [
    '- button "Delete account"',
    '- button "Remove item"',
    '- menuitem "Close my account"',
    '- checkbox "Delete my data"',
    '- button "Remove filter and delete all"',
  ])
    assert.equal(consequenceOf(label), "delete", label);
});

test("ordinary controls pass", () => {
  for (const label of [
    '- button "Search"',
    '- button "Subscribe"',
    '- button "Subscribe to our newsletter"',
    '- button "Remove filter: Price"',
    '- button "Remove all filters"',
    '- link "Display settings"',
    '- button "Payday loans explained"',
    "",
  ])
    assert.equal(consequenceOf(label), null, label);
});
