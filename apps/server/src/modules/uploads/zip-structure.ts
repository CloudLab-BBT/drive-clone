import type { Entry } from './zip-entry.ts';

export function validStructure(
  ext: string,
  entries: Map<string, Entry>,
  content: Map<string, Buffer>,
) {
  if (ext.startsWith('o')) return validOdf(ext, entries, content);
  const main =
    ext === 'docx'
      ? 'word/document.xml'
      : ext === 'pptx'
        ? 'ppt/presentation.xml'
        : 'xl/workbook.xml';
  const types = content.get('[Content_Types].xml')?.toString() ?? '';
  const relationships = content.get('_rels/.rels')?.toString() ?? '';
  const flavor =
    ext === 'docx' ? 'wordprocessingml' : ext === 'pptx' ? 'presentationml' : 'spreadsheetml';
  return (
    entries.has(main) &&
    types.includes('<Types') &&
    types.includes(flavor) &&
    relationships.includes('Relationships') &&
    relationships.includes(main)
  );
}

function validOdf(ext: string, entries: Map<string, Entry>, content: Map<string, Buffer>) {
  const mime = {
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    odp: 'application/vnd.oasis.opendocument.presentation',
  }[ext];
  const first = entries.values().next().value as Entry | undefined;
  const manifest = content.get('META-INF/manifest.xml')?.toString() ?? '';
  return (
    first?.name === 'mimetype' &&
    first.method === 0 &&
    first.local === 0 &&
    content.get('mimetype')?.toString() === mime &&
    manifest.includes('manifest:manifest')
  );
}
