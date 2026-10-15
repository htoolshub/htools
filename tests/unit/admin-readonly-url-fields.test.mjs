import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminSource = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);

test("the fixed subscription URL uses the shared read-only field", () => {
  assert.match(
    adminSource,
    /<input\s+aria-describedby="public-source-description"\s+readOnly\s+type="url"\s+value=\{publicSourceUrl\}\s+\/>/
  );
  assert.doesNotMatch(adminSource, /className="callback-box"/);
  assert.doesNotMatch(adminSource, /callbackUrl|OAuth Client/);
  assert.doesNotMatch(adminSource, /className="source-public-label"/);
});
