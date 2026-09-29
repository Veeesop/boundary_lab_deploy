const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { SolverPreferences } = require("../electron/solverPreferences.cjs");
for (const detected of ["cuda", "cpu", "metal"]) {
  test(`first launch selects ${detected}; later launches retain explicit choice`, async () => {
    const root = await mkdtemp(join(tmpdir(), "deploy-preferences-"));
    try {
      let probes = 0;
      const path = join(root, "preferences.json");
      const store = new SolverPreferences(path, async () => { probes++; return detected; });
      assert.deepEqual(await Promise.all([store.get(), store.get()]), [detected, detected]);
      assert.equal(probes, 1);
      const reopened = new SolverPreferences(path, async () => { throw Error("must not reprobe"); });
      assert.equal(await reopened.get(), detected);
      for (const selected of ["cpu", "cuda", "metal"]) {
        await reopened.set(selected);
        assert.equal(JSON.parse(await readFile(path, "utf8")).backend, selected);
        assert.equal(await reopened.get(), selected);
      }
      await assert.rejects(reopened.set("invalid"));
      assert.equal(await reopened.get(), "metal");
    } finally { await rm(root, {recursive:true, force:true}); }
  });
}
