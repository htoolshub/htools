import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const shared = await import(`${compiledShared.url.href}?api-error-code=1`);

after(async () => {
  await compiledShared.cleanup();
});

test("JSON error responses receive stable codes from their HTTP status", async () => {
  const cases = [
    [400, "INVALID_REQUEST"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [429, "RATE_LIMITED"],
    [500, "SERVER_ERROR"],
    [503, "SERVER_ERROR"]
  ];

  for (const [status, code] of cases) {
    const response = shared.json({ error: "Legacy message." }, { status });
    assert.deepEqual(await response.json(), {
      error: "Legacy message.",
      code
    });
  }
});

test("explicit error codes and response details are preserved", async () => {
  const response = shared.jsonError(
    "Already exists.",
    "CONFLICT",
    { status: 409, headers: { "Retry-After": "10" } },
    { resourceId: "tool-1" }
  );

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Retry-After"), "10");
  assert.deepEqual(await response.json(), {
    error: "Already exists.",
    code: "CONFLICT",
    resourceId: "tool-1"
  });
});

test("successful JSON payloads are never rewritten as API errors", async () => {
  const response = shared.json({ error: "domain value", ok: true });
  assert.deepEqual(await response.json(), { error: "domain value", ok: true });
});
