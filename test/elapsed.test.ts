import { test } from "node:test";
import assert from "node:assert/strict";
import { formatElapsed } from "../src/ui/elapsed.js";

test("sub-minute as seconds only", () => assert.equal(formatElapsed(45_000), "45s"));
test("minutes and seconds", () => assert.equal(formatElapsed(13 * 60_000 + 7_000), "13m 7s"));
test("hours", () => assert.equal(formatElapsed(2 * 3_600_000 + 5 * 60_000 + 3_000), "2h 5m 3s"));
test("clamps negatives to 0s", () => assert.equal(formatElapsed(-10), "0s"));
