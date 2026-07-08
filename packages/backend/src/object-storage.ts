import {
  buildArtifactObjectKey,
  createS3CompatibleObjectStore,
  type ObjectStorageTarget,
  type PutObjectInput,
  type PutObjectResult,
} from "@open-superforecaster/artifact-store";
import type { AppConfig } from "@open-superforecaster/config";

export type ObjectStorageTargets = {
  artifacts: ObjectStorageTarget;
  evals: ObjectStorageTarget;
  exports: ObjectStorageTarget;
};

export type ObjectUploadOutcome = {
  ok: boolean;
  storageUri: string | null;
  error: string | null;
  result: PutObjectResult | null;
};

export type ObjectBucketCheckOutcome = {
  ok: boolean;
  bucket: string;
  status: number | null;
  statusText: string | null;
  error: string | null;
};

export function createObjectStorageTargets(config: AppConfig): ObjectStorageTargets {
  const store = createS3CompatibleObjectStore({
    endpoint: config.MINIO_ENDPOINT,
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
    region: config.MINIO_REGION,
  });

  return {
    artifacts: {
      store,
      bucket: config.MINIO_BUCKET_ARTIFACTS,
    },
    evals: {
      store,
      bucket: config.MINIO_BUCKET_EVALS,
    },
    exports: {
      store,
      bucket: config.MINIO_BUCKET_EXPORTS,
    },
  };
}

export async function tryPutObject(
  target: ObjectStorageTarget | undefined,
  input: Omit<PutObjectInput, "bucket">,
): Promise<ObjectUploadOutcome> {
  if (!target) {
    return {
      ok: false,
      storageUri: null,
      error: "object storage target was not configured",
      result: null,
    };
  }

  try {
    const result = await target.store.putObject({
      bucket: target.bucket,
      ...input,
    });
    return {
      ok: true,
      storageUri: result.storageUri,
      error: null,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      storageUri: null,
      error: error instanceof Error ? error.message : String(error),
      result: null,
    };
  }
}

export async function tryHeadBucket(target: ObjectStorageTarget): Promise<ObjectBucketCheckOutcome> {
  try {
    const result = await target.store.headBucket(target.bucket);
    return {
      ok: result.ok,
      bucket: target.bucket,
      status: result.status,
      statusText: result.statusText,
      error: result.ok ? null : `${result.status} ${result.statusText}`,
    };
  } catch (error) {
    return {
      ok: false,
      bucket: target.bucket,
      status: null,
      statusText: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function tryPutArtifactObject(
  target: ObjectStorageTarget | undefined,
  input: {
    artifactId: string;
    fileName: string;
    body: PutObjectInput["body"];
    contentType: string;
  },
) {
  return tryPutObject(target, {
    key: buildArtifactObjectKey(input.artifactId, input.fileName),
    body: input.body,
    contentType: input.contentType,
  });
}
