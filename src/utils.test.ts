import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveCache } from "./utils.js";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("saveCache", () => {
  it("atomically replaces cache JSON", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "vite-image-pipeline-"));
    const cachePath = path.join(temporaryDirectory, "cache.json");

    await saveCache(cachePath, { photo: { color: "blue" } });

    await expect(readFile(cachePath, "utf8")).resolves.toBe(
      '{\n  "photo": {\n    "color": "blue"\n  }\n}',
    );
  });
});
