import assert from 'node:assert/strict';
import { popupPlacement } from '../public/posi-notice/notice.mjs';
assert.equal(popupPlacement(440, 360, 1280, 800), 'top-right');
// A visible submit control makes the popup move to the opposite side.
const submit = Object.freeze({ left: 900, right: 1200, top: 200, bottom: 300 });
assert.equal(popupPlacement(440, 360, 1280, 800, [submit]), 'top-left');
// At phone widths, defer rather than cover the form or its submit button.
const form = Object.freeze({ left: 0, right: 375, top: 180, bottom: 812 });
assert.equal(popupPlacement(351, 440, 375, 812, [form]), null);
assert.equal(popupPlacement(351, 440, 375, 812), 'top-right');
assert.equal(popupPlacement(440, 360, 320, 568), null);
assert.equal(popupPlacement(300, 440, 375, 500), null);
console.log('POSI popup placement checks passed: 6, including submit avoidance, small screens and safe deferral.');
