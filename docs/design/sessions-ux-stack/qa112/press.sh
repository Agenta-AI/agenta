#!/bin/bash
# press.sh <local|prod> <js expression returning an element>
#
# Dispatches the FULL pointer sequence (pointerdown -> mousedown -> pointerup -> mouseup -> click)
# at the element's centre. Radix triggers listen on `pointerdown` and ignore a synthetic `.click()`,
# so dropdowns, popovers, selects and tooltips need this.
#
# TRAP, and it nearly shipped a bogus bug: an ORDINARY button sees this sequence TWICE — once from
# the dispatched pointer events and once from the synthesised `click`. Driving the Files pane's
# collapse through here produced two transition cycles and left the pane open, and I almost filed
# "the Files pane reopens when you close it". Use plain `browse js '...el.click()'` for normal
# buttons; keep press.sh for Radix.
#
#   press.sh local "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Model')"
source "$(dirname "$0")/env.sh"
ENV="$1"; EXPR="$2"
[ -z "$EXPR" ] && { echo "usage: press.sh <local|prod> <js expr returning an element>"; exit 1; }

use_tab "$ENV" || { echo "  !! no $ENV tab"; exit 1; }

$B js "
const el = ($EXPR);
if (!el) { 'NOMATCH' } else {
  const r = el.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const opts = {bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1,
                pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1};
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', {...opts, buttons: 0}));
  el.dispatchEvent(new MouseEvent('mouseup', {...opts, buttons: 0}));
  el.dispatchEvent(new MouseEvent('click', {...opts, buttons: 0}));
  JSON.stringify({pressed: el.tagName + '.' + (el.className||'').toString().slice(0,40),
                  rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]});
}" 2>&1 | tail -1
