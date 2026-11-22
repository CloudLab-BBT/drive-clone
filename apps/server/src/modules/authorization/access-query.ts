// La misma resolución de visibilidad se aplica a consultas individuales y listados.
export const accessQuery = `
WITH RECURSIVE candidates AS (
  SELECT r.id, r."ownerId", r."parentId", r.kind, r."isRoot",
         ($2 = 'children' AND r.id = $3::uuid) AS anchor,
         CASE WHEN $2 = 'shared' THEN direct."createdAt" ELSE r."createdAt" END AS ordered_at
  FROM "Resource" r
  LEFT JOIN "Share" direct ON direct."resourceId" = r.id AND direct."userId" = $1::uuid
  WHERE r.status = 'ACTIVE'
    AND (
      ($2 = 'one' AND r.id = $3::uuid)
      OR ($2 = 'children' AND (r.id = $3::uuid OR r."parentId" = $3::uuid))
      OR ($2 = 'shared' AND direct.permission IN ('READ', 'EDIT')
          AND NOT r."isRoot" AND r."ownerId" <> $1::uuid)
    )
    AND (($2 = 'children' AND r.id = $3::uuid) OR $4::timestamptz IS NULL OR
      (CASE WHEN $2 = 'shared' THEN direct."createdAt" ELSE r."createdAt" END, r.id)
      > ($4::timestamptz, $5::uuid))
), lineage AS (
  SELECT id AS target, "ownerId", id, "parentId", "isRoot", kind,
         'ACTIVE'::text AS status, 0 AS depth, ARRAY[id] AS visited
  FROM candidates
  UNION ALL
  SELECT l.target, p."ownerId", p.id, p."parentId", p."isRoot", p.kind,
         p.status, l.depth + 1, l.visited || p.id
  FROM lineage l
  JOIN "Resource" p ON p.id = l."parentId" AND p."ownerId" = l."ownerId"
  WHERE l.depth < 10 AND NOT p.id = ANY(l.visited)
), access AS (
  SELECT l.target,
    bool_or(l."isRoot" AND l."parentId" IS NULL AND l.kind = 'FOLDER')
      AND bool_and(l.status = 'ACTIVE' AND (l.depth = 0 OR l.kind = 'FOLDER'))
      AS valid,
    max(CASE WHEN l."isRoot" THEN 0
             WHEN s.permission = 'EDIT' THEN 2
             WHEN s.permission = 'READ' THEN 1 ELSE 0 END) AS rank
  FROM lineage l
  LEFT JOIN "Share" s ON s."resourceId" = l.id AND s."userId" = $1::uuid
  GROUP BY l.target
)
SELECT c.id, c.kind, c."isRoot", c.anchor,
       CASE WHEN c."ownerId" = $1::uuid THEN 'OWNER'
            WHEN a.rank = 2 THEN 'EDIT' ELSE 'READ' END AS "effectivePermission",
       to_char(c.ordered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
         AS "cursorCreatedAt"
FROM candidates c JOIN access a ON a.target = c.id
WHERE a.valid AND (c."ownerId" = $1::uuid OR a.rank > 0)
  AND ($2 <> 'children' OR EXISTS (
    SELECT 1 FROM candidates parent JOIN access pa ON pa.target = parent.id
    WHERE parent.anchor AND parent.kind = 'FOLDER' AND pa.valid
      AND (parent."ownerId" = $1::uuid OR pa.rank > 0)
  ))
ORDER BY c.anchor DESC, c.ordered_at, c.id
LIMIT $6::integer
`;
