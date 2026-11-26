export function oleSample(ext: string) {
  const streamName = { doc: 'WordDocument', ppt: 'PowerPoint Document', xls: 'Workbook' }[ext];
  const header = Buffer.alloc(512);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header);
  header.writeUInt16LE(0x3e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(1, 48);
  header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(0xfffffffe, 60);
  header.writeUInt32LE(0, 76);
  for (let at = 80; at < 512; at += 4) header.writeUInt32LE(0xffffffff, at);
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(0xfffffffe, 4);
  for (let sector = 2; sector < 9; sector++) fat.writeUInt32LE(sector + 1, sector * 4);
  fat.writeUInt32LE(0xfffffffe, 9 * 4);
  const directory = Buffer.alloc(512);
  const entry = (index: number, name: string, type: number, start: number, size: number) => {
    const offset = index * 128;
    Buffer.from(`${name}\0`, 'utf16le').copy(directory, offset);
    directory.writeUInt16LE(Buffer.byteLength(`${name}\0`, 'utf16le'), offset + 64);
    directory[offset + 66] = type;
    directory[offset + 67] = 1;
    directory.writeUInt32LE(0xffffffff, offset + 68);
    directory.writeUInt32LE(0xffffffff, offset + 72);
    directory.writeUInt32LE(index === 0 ? 1 : 0xffffffff, offset + 76);
    directory.writeUInt32LE(start, offset + 116);
    directory.writeBigUInt64LE(BigInt(size), offset + 120);
  };
  entry(0, 'Root Entry', 5, 0xfffffffe, 0);
  entry(1, streamName!, 2, 2, 4096);
  const data = Buffer.alloc(4096);
  data.writeUInt16LE(ext === 'doc' ? 0xa5ec : 0x0809);
  return Buffer.concat([header, fat, directory, data]);
}
