const crc32 = (bytes: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

function zip(entries: Array<[string, string]>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [path, value] of entries) {
    const name = Buffer.from(path);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function jpeg() {
  const segment = (marker: number, data: Buffer) =>
    Buffer.concat([
      Buffer.from([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 255]),
      data,
    ]);
  const table = (id: number) =>
    Buffer.concat([Buffer.from([id, 1]), Buffer.alloc(15), Buffer.from([0])]);
  const quant = Buffer.alloc(65, 1);
  quant[0] = 0;
  const frame = Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
  const scan = Buffer.from([1, 1, 0, 0, 63, 0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from([74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])),
    segment(0xdb, quant),
    segment(0xc4, Buffer.concat([table(0), table(16)])),
    segment(0xc0, frame),
    segment(0xda, scan),
    Buffer.from([0x3f, 0xff, 0xd9]),
  ]);
}

const dng = Buffer.alloc(26);
dng.write('II*\0', 0, 'ascii');
dng.writeUInt32LE(8, 4);
dng.writeUInt16LE(1, 8);
dng.writeUInt16LE(50706, 10);
dng.writeUInt16LE(1, 12);
dng.writeUInt32LE(4, 14);
dng.set([1, 4, 0, 0], 18);
const wav = Buffer.alloc(44);
wav.write('RIFF', 0);
wav.writeUInt32LE(36, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34);
wav.write('data', 36);
wav.writeUInt32LE(0, 40);
const flac = Buffer.alloc(42);
flac.write('fLaC');
flac.set([0x80, 0, 0, 34], 4);

export const samples: Record<string, Buffer> = {
  png: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/r1sAAAAASUVORK5CYII=',
    'base64',
  ),
  jpg: jpeg(),
  jpeg: jpeg(),
  webp: Buffer.from('5249464610000000574542505650384c040000002f000000', 'hex'),
  raw: Buffer.from([0, 255, 17, 44, 99]),
  dng,
  mp3: Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]),
  wav,
  ogg: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24)]),
  m4a: Buffer.from('00000014667479704d344120000000004d344120', 'hex'),
  flac,
  mp4: Buffer.from('000000146674797069736f6d0000000069736f6d', 'hex'),
  webm: Buffer.from('1a45dfa38a428681014282847765626d1853806701ffffffffffffff', 'hex'),
  mov: Buffer.from('0000001466747970717420200000000071742020', 'hex'),
  doc: oleSample('doc'),
  ppt: oleSample('ppt'),
  xls: oleSample('xls'),
  docx: officeSample('docx'),
  pptx: officeSample('pptx'),
  xlsx: officeSample('xlsx'),
  odt: officeSample('odt'),
  ods: officeSample('ods'),
  odp: officeSample('odp'),
  txt: Buffer.from('texto UTF-8 válido'),
  csv: Buffer.from('nombre,valor\nuno,1\n'),
  pdf: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
};
import { officeSample } from './office-fixtures.ts';
import { oleSample } from './ole-fixtures.ts';
