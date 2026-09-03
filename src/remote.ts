import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { existsSync } from "fs";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";


type RemotePlatformType = "cloudflare-r2";

interface CloudflareR2Options {
    platform: "cloudflare-r2";
    r2AccessKey: string;
    r2SecretKey: string;
    accountId: string;
    bucketName: string;
    bucketDomain?: string;
    outDir: string;
    cacheControl?: string;
}

export type RemoteImageOptions = CloudflareR2Options // Extendable union: CloudflareR2Options | AWSS3Options | etc.

export interface RemotePlatform {
    type: RemotePlatformType;
    generateRemoteUrl: (filepath: string) => string;
    validate: () => void;
    upload: () => Promise<void>;
    filepaths: Set<string>;
}

export function remotePlatformId(options: RemoteImageOptions): string {
    switch (options.platform) {
        case "cloudflare-r2":
            return `cloudflare-r2#${options.accountId}#${options.bucketName}`;
        default:
            throw new Error(`[vite-image-pipeline] Unsupported remote platform`);
    }
}

function publicUrlOrigin(bucketDomain: string): string {
    const url = new URL(bucketDomain.includes("://") ? bucketDomain : `https://${bucketDomain}`);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("[vite-image-pipeline] bucketDomain must be an HTTPS hostname without a path");
    }
    return url.origin;
}

export function createRemotePlatform(options: RemoteImageOptions): RemotePlatform {
    // Switch on the literal property value
    switch (options.platform) {
        case "cloudflare-r2":
            const filepathsSet = new Set<string>();
            return {
                type: "cloudflare-r2",
                generateRemoteUrl: (filepath: string) => {
                    const relativeObjectPath = filepath.startsWith("/") ? filepath.slice(1) : filepath;
                    return options.bucketDomain
                        ? `${publicUrlOrigin(options.bucketDomain)}/${relativeObjectPath}`
                        : `https://${options.bucketName}.r2.cloudflarestorage.com/${relativeObjectPath}`;
                },
                filepaths: filepathsSet,
                validate: () => {
                    if (!options.r2AccessKey) throw Error("[vite-image-pipeline] Cloudflare R2 access key is required");
                    if (!options.r2SecretKey) throw Error("[vite-image-pipeline] Cloudflare R2 secret key is required");
                    if (!options.accountId) throw Error("[vite-image-pipeline] Cloudflare R2 account ID is required");
                    if (!options.bucketName) throw Error("[vite-image-pipeline] Cloudflare R2 bucket name is required");
                    if (!options.outDir) throw Error("[vite-image-pipeline] Out directory is required (ex. 'dist')");
                    if (options.bucketDomain) publicUrlOrigin(options.bucketDomain);
                },
                upload: async () => {
                    const filepaths = Array.from(filepathsSet);
                    if (filepaths.length === 0) {
                        console.log("[vite-image-pipeline] No remote images to upload");
                        return;
                    }
                    const s3Client = new S3Client({
                        region: "auto",
                        endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
                        credentials: {
                            accessKeyId: options.r2AccessKey,
                            secretAccessKey: options.r2SecretKey,
                        },
                    });
                    const getMimeType = (ext: string) => {
                        switch (ext) {
                            case ".png": return "image/png";
                            case ".webp": return "image/webp";
                            case ".svg": return "image/svg+xml";
                            case ".avif": return "image/avif";
                            default: return "image/jpeg";
                        }
                    };
                    const BATCH_SIZE = 10;

                    for (let i = 0; i < filepaths.length; i += BATCH_SIZE) {
                        const batch = filepaths.slice(i, i + BATCH_SIZE);

                        // Fire off all uploads in the current batch concurrently
                        const results = await Promise.allSettled(
                            batch.map(async (rawPath) => {
                                const relativeObjectPath = rawPath.startsWith("/") ? rawPath.slice(1) : rawPath;
                                const targetDistLocation = path.join(options.outDir, relativeObjectPath);

                                if (!existsSync(targetDistLocation)) {
                                    throw new Error(`[vite-image-pipeline] Local build file missing for upload: ${targetDistLocation}`);
                                }

                                const fileBuffer = await fs.readFile(targetDistLocation);
                                const ext = path.extname(targetDistLocation).toLowerCase();

                                const localMD5 = crypto.createHash("md5").update(fileBuffer).digest("hex");
                                const localETag = `"${localMD5}"`;

                                console.log(`[vite-image-pipeline] Uploading to R2: "${relativeObjectPath}"`);
                                try {
                                    await s3Client.send(
                                        new PutObjectCommand({
                                            Bucket: options.bucketName,
                                            Key: relativeObjectPath,
                                            Body: fileBuffer,
                                            ContentType: getMimeType(ext),
                                            CacheControl: options.cacheControl,
                                            IfNoneMatch: localETag
                                        })
                                    );
                                } catch (uploadErr: any) {
                                    // Cloudflare returns 412 when object ETag matches this file.
                                    if (uploadErr.name === "PreconditionFailed" || uploadErr.$metadata?.httpStatusCode === 412) {
                                        console.log(`[vite-image-pipeline] Cache hit (Skipped): "${relativeObjectPath}" hashes match perfectly.`);
                                    } else {
                                        throw uploadErr;
                                    }
                                }

                                // Purge local file only after upload or matching ETag.
                                await fs.unlink(targetDistLocation);
                            })
                        );
                        const failures = results
                            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
                            .map((result) => result.reason);
                        if (failures.length > 0) {
                            throw new AggregateError(failures, "[vite-image-pipeline] One or more R2 uploads failed");
                        }
                    }
                }
            };
        default:
            throw new Error(`[vite-image-pipeline] Unsupported remote platform`);
    }
}
