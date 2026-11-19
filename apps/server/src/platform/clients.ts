import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import pg from 'pg';
import { config } from './config.ts';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 2000, query_timeout: 2000 });
const aws = {
  endpoint: config.awsEndpoint,
  region: config.awsRegion,
  credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test' },
};
export const s3 = new S3Client({ ...aws, forcePathStyle: true });
export const sqs = new SQSClient(aws);

export async function closeClients(): Promise<void> {
  await pool.end();
  s3.destroy();
  sqs.destroy();
}
