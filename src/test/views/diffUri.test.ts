import * as assert from "node:assert";

describe("diff URI repo encode/decode", () => {
  it("repoId survives encode/decode roundtrip", () => {
    const repoId = "/Users/x/repos/with spaces&more";
    const uri = `idea-git:/src/a.ts?ref=abc&repo=${encodeURIComponent(repoId)}`;
    const parsed = new URLSearchParams(uri.split("?")[1]).get("repo");
    assert.strictEqual(parsed, repoId);
  });
});
