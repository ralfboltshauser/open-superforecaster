import { createS3CompatibleObjectStore } from "../packages/artifact-store/src/index";
import { loadAppConfig } from "../packages/config/src/index";

const config = loadAppConfig();
const store = createS3CompatibleObjectStore({
  endpoint: config.MINIO_ENDPOINT,
  accessKey: config.MINIO_ACCESS_KEY,
  secretKey: config.MINIO_SECRET_KEY,
  region: config.MINIO_REGION,
});

const now = new Date().toISOString();
const checks = [
  {
    label: "artifacts bucket",
    bucket: config.MINIO_BUCKET_ARTIFACTS,
    key: "diagnostics/object-storage-smoke.txt",
  },
  {
    label: "evals bucket",
    bucket: config.MINIO_BUCKET_EVALS,
    key: "diagnostics/object-storage-smoke.txt",
  },
  {
    label: "exports bucket",
    bucket: config.MINIO_BUCKET_EXPORTS,
    key: "diagnostics/object-storage-smoke.txt",
  },
];

const results = [];
for (const check of checks) {
  const result = await store.putObject({
    bucket: check.bucket,
    key: check.key,
    body: `open-superforecaster ${check.label} smoke ${now}\n`,
    contentType: "text/plain; charset=utf-8",
  });
  results.push({
    label: check.label,
    storageUri: result.storageUri,
    etag: result.etag,
  });
}

console.log(JSON.stringify({
  ok: true,
  endpoint: config.MINIO_ENDPOINT,
  results,
}, null, 2));
