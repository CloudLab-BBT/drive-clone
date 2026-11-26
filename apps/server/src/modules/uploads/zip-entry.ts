export type Entry = {
  name: string;
  flags: number;
  method: number;
  crc: number;
  packed: number;
  raw: number;
  local: number;
  next: number;
};

const maxEntry = 100 * 1024 * 1024;

export function parseEntry(dir: Buffer, at: number): Entry | null {
  const nameLength = dir.readUInt16LE(at + 28);
  const extra = dir.readUInt16LE(at + 30);
  const comment = dir.readUInt16LE(at + 32);
  const next = 46 + nameLength + extra + comment;
  if (
    !nameLength ||
    at + next > dir.length ||
    dir.readUInt16LE(at + 34) ||
    dir.readUInt32LE(at + 20) === 0xffffffff ||
    dir.readUInt32LE(at + 24) === 0xffffffff
  )
    return null;
  return {
    name: dir.toString('utf8', at + 46, at + 46 + nameLength),
    flags: dir.readUInt16LE(at + 8),
    method: dir.readUInt16LE(at + 10),
    crc: dir.readUInt32LE(at + 16),
    packed: dir.readUInt32LE(at + 20),
    raw: dir.readUInt32LE(at + 24),
    local: dir.readUInt32LE(at + 42),
    next,
  };
}

export function safeEntry(entry: Entry) {
  const components = entry.name.split('/');
  return (
    !(entry.flags & (1 | 64 | 8192)) &&
    [0, 8].includes(entry.method) &&
    !entry.name.startsWith('/') &&
    !entry.name.includes('\\') &&
    !components.includes('..') &&
    components.length <= 10 &&
    entry.raw <= maxEntry &&
    entry.local < 0xffffffff &&
    (entry.raw === 0 || (entry.packed > 0 && entry.raw <= entry.packed * 100)) &&
    (entry.method !== 0 || entry.raw === entry.packed)
  );
}
