import { createHash, createHmac, randomUUID } from "node:crypto";
import type { ArtifactType } from "@open-superforecaster/workflow-contracts";

export type ArtifactMetadata = {
  artifactId: string;
  artifactType: ArtifactType;
  schemaJson: Record<string, unknown>;
  rowCount: number;
  storageUri?: string;
  parentArtifactIds: string[];
  createdBy: string;
};

export type ArtifactRowInput = {
  rowIndex: number;
  rowJson: Record<string, unknown>;
  sourceRowId?: string;
  sourceBankIds?: string[];
  citationIds?: string[];
};

export function createArtifactMetadata(input: Omit<ArtifactMetadata, "artifactId">): ArtifactMetadata {
  return {
    artifactId: randomUUID(),
    ...input,
  };
}

export function hashArtifactRow(rowJson: Record<string, unknown>) {
  return createHash("sha256").update(canonicalJson(rowJson)).digest("hex");
}

export function buildArtifactObjectKey(artifactId: string, fileName: string) {
  return `artifacts/${artifactId}/${fileName}`;
}

export function buildBenchmarkTraceBundleKey(benchmarkRunId: string, benchmarkCaseId: string) {
  return `traces/benchmarks/${benchmarkRunId}/${benchmarkCaseId}/bundle.tar.zst`;
}

export type ObjectStorageConfig = {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
};

export type PutObjectInput = {
  bucket: string;
  key: string;
  body: string | Uint8Array | ArrayBuffer;
  contentType?: string;
};

export type PutObjectResult = {
  bucket: string;
  key: string;
  storageUri: string;
  httpUrl: string;
  etag: string | null;
};

export type HeadBucketResult = {
  bucket: string;
  ok: boolean;
  httpUrl: string;
  status: number;
  statusText: string;
};

export type ObjectStore = {
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  headBucket(bucket: string): Promise<HeadBucketResult>;
};

export type ObjectStorageTarget = {
  store: ObjectStore;
  bucket: string;
};

export function buildObjectStorageUri(bucket: string, key: string) {
  return `s3://${bucket}/${key}`;
}

export function createS3CompatibleObjectStore(config: ObjectStorageConfig): ObjectStore {
  return {
    async headBucket(bucket) {
      const payloadHash = sha256Hex("");
      const signed = signS3Request({
        config,
        method: "HEAD",
        bucket,
        payloadHash,
      });
      const response = await fetch(signed.url, {
        method: "HEAD",
        headers: {
          authorization: signed.authorization,
          "x-amz-content-sha256": payloadHash,
          "x-amz-date": signed.amzDate,
        },
      });

      return {
        bucket,
        ok: response.ok,
        httpUrl: signed.url,
        status: response.status,
        statusText: response.statusText,
      };
    },
    async putObject(input) {
      const body = toBuffer(input.body);
      const payloadHash = sha256Hex(body);
      const signed = signS3Request({
        config,
        method: "PUT",
        bucket: input.bucket,
        key: input.key,
        payloadHash,
      });
      const headers: Record<string, string> = {
        authorization: signed.authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": signed.amzDate,
      };
      if (input.contentType) {
        headers["content-type"] = input.contentType;
      }

      const response = await fetch(signed.url, {
        method: "PUT",
        headers,
        body: new Uint8Array(body).buffer,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Object upload failed for ${input.bucket}/${input.key}: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
      }

      return {
        bucket: input.bucket,
        key: input.key,
        storageUri: buildObjectStorageUri(input.bucket, input.key),
        httpUrl: signed.url,
        etag: response.headers.get("etag"),
      };
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function signS3Request(input: {
  config: ObjectStorageConfig;
  method: string;
  bucket: string;
  key?: string;
  payloadHash: string;
}) {
  const endpoint = new URL(input.config.endpoint);
  const canonicalUri = buildCanonicalS3Path(endpoint.pathname, input.bucket, input.key);
  endpoint.pathname = canonicalUri;
  endpoint.search = "";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${input.config.region}/s3/aws4_request`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${endpoint.host}`,
    `x-amz-content-sha256:${input.payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSignatureKey(input.config.secretKey, dateStamp, input.config.region, "s3");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.config.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: endpoint.toString(),
    amzDate,
    authorization,
  };
}

function buildCanonicalS3Path(endpointPath: string, bucket: string, key?: string) {
  const prefix = endpointPath === "/" ? "" : endpointPath.replace(/\/+$/, "");
  if (!key) {
    return `${prefix}/${encodeURIComponent(bucket)}`;
  }
  return `${prefix}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function getSignatureKey(secretKey: string, dateStamp: string, region: string, service: string) {
  const kDate = createHmac("sha256", `AWS4${secretKey}`).update(dateStamp, "utf8").digest();
  const kRegion = createHmac("sha256", kDate).update(region, "utf8").digest();
  const kService = createHmac("sha256", kRegion).update(service, "utf8").digest();
  return createHmac("sha256", kService).update("aws4_request", "utf8").digest();
}

function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function toBuffer(value: string | Uint8Array | ArrayBuffer) {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
