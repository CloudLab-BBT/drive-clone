import { readFileSync } from 'node:fs';

const media = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

export const samples: Record<string, Buffer> = {
  png: media('sample.png'),
  jpg: media('sample.jpg'),
  jpeg: media('sample.jpg'),
  webp: media('sample.webp'),
  raw: Buffer.from([0, 255, 17, 44, 99]),
  dng: media('sample.dng'),
  mp3: media('sample.mp3'),
  wav: media('sample.wav'),
  ogg: media('sample.ogg'),
  m4a: media('sample.m4a'),
  flac: media('sample.flac'),
  mp4: media('sample.mp4'),
  webm: media('sample.webm'),
  mov: media('sample.mov'),
  doc: media('sample.doc'),
  ppt: media('sample.ppt'),
  xls: media('sample.xls'),
  docx: media('sample.docx'),
  pptx: media('sample.pptx'),
  xlsx: media('sample.xlsx'),
  odt: media('sample.odt'),
  ods: media('sample.ods'),
  odp: media('sample.odp'),
  txt: Buffer.from('texto UTF-8 válido'),
  csv: Buffer.from('nombre,valor\nuno,1\n'),
  pdf: media('sample.pdf'),
};
