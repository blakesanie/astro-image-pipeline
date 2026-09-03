import { describe, expect, it } from "vitest";
import { createRemotePlatform } from "./remote.js";

const options = {
  platform: "cloudflare-r2" as const,
  accountId: "account",
  bucketName: "images",
  r2AccessKey: "key",
  r2SecretKey: "secret",
  outDir: "dist",
};

describe("Cloudflare R2 public URLs", () => {
  it("uses a custom HTTPS bucket domain for browser URLs", () => {
    const platform = createRemotePlatform({ ...options, bucketDomain: "download.blakesanie.com/" });

    expect(platform.generateRemoteUrl("/_astro/photo.avif")).toBe(
      "https://download.blakesanie.com/_astro/photo.avif",
    );
  });

  it("rejects custom domains with a path", () => {
    expect(() => createRemotePlatform({ ...options, bucketDomain: "https://download.blakesanie.com/images" }).validate()).toThrow(
      "bucketDomain must be an HTTPS hostname without a path",
    );
  });
});
