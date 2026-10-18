import { test } from "node:test";
import assert from "node:assert/strict";
import { formGetTarget } from "../src/shims/form-target.js";

const base = "http://localhost/search?old=1";

test("a GET form navigates to its action with the fields as the query", () => {
  const entries = [["lang", "en"], ["q", "react"]];
  assert.equal(formGetTarget({ action: "/search", method: undefined, entries, base }), "/search?lang=en&q=react");
});

test("the submitter's formAction and formMethod win over the form's", () => {
  const entries = [["lang", "de"], ["q", "x"], ["source", "submitter-method"]];
  const submitter = { formAction: "/search-alt", formMethod: "GET" };
  assert.equal(
    formGetTarget({ action: "/search", method: "POST", submitter, entries, base }),
    "/search-alt?lang=de&q=x&source=submitter-method",
  );
});

test("POST forms and file fields are left to the browser", () => {
  assert.equal(formGetTarget({ action: "/search", method: "POST", entries: [], base }), null);
  const file = { name: "f.txt" };
  assert.equal(formGetTarget({ action: "/up", method: "GET", entries: [["f", file]], base }), null);
});
