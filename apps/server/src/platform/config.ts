export const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  awsEndpoint: process.env.AWS_ENDPOINT ?? 'http://localstack:4566',
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'drive-files',
  queueName: process.env.SQS_QUEUE ?? 'drive-uploads',
  dlqName: process.env.SQS_DLQ ?? 'drive-uploads-dlq',
  tempDir: process.env.TEMP_DIR ?? '/app/temp',
  port: Number(process.env.PORT ?? 3000),
};

export function requireConfig(): void {
  if (!config.databaseUrl) throw new Error('Falta DATABASE_URL');
  if (!Number.isInteger(config.port) || config.port < 1) throw new Error('PORT inválido');
}
