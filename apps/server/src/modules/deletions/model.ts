export interface DeletionRow {
  id: string;
  resourceId: string;
  ownerId: string;
  requestedById: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  affectedResources: number;
  processedResources: number;
  attemptCount: number;
  attemptId: string | null;
  createdAt: Date;
  updatedAt: Date;
  errorCode: string | null;
}

export function publicDeletion(row: DeletionRow) {
  return {
    id: row.id,
    resourceId: row.resourceId,
    status: row.status,
    affectedResources: row.affectedResources,
    processedResources: row.processedResources,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  };
}
