const { readFile, mkdir, writeFile, rename } = require("node:fs/promises");
const { dirname } = require("node:path");
const valid = (value) => value === "cpu" || value === "cuda" || value === "metal";

class SolverPreferences {
  constructor(path, detect) { this.path = path; this.detect = detect; this.initializing = null; }
  get() {
    if (!this.initializing) this.initializing = this.load().catch(error => { this.initializing = null; throw error; });
    return this.initializing;
  }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.path, "utf8"));
      if (valid(saved.backend)) return saved.backend;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    const detected = await this.detect(process.platform === "darwin" ? "metal" : "cuda");
    const backend = valid(detected) ? detected : "cpu";
    await this.write(backend);
    return backend;
  }
  async write(backend) {
    if (!valid(backend)) throw new Error("Solver backend must be CPU, CUDA, or Metal.");
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path + ".tmp", JSON.stringify({ backend }) + "\n", "utf8");
    await rename(this.path + ".tmp", this.path);
  }
  async set(backend) {
    if (!valid(backend)) throw new Error("Solver backend must be CPU, CUDA, or Metal.");
    await this.get();
    await this.write(backend);
    this.initializing = Promise.resolve(backend);
    return backend;
  }
}
module.exports = { SolverPreferences };
