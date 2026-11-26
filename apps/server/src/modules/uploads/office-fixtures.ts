import { zip } from './office-zip.ts';

export function officeSample(
  ext: string,
  options: { encrypted?: boolean; compressionRatio?: boolean } = {},
) {
  if (ext.startsWith('o')) {
    const mime = {
      odt: 'application/vnd.oasis.opendocument.text',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
      odp: 'application/vnd.oasis.opendocument.presentation',
    }[ext];
    return zip(
      [
        ['mimetype', mime!],
        [
          'META-INF/manifest.xml',
          `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
        ],
        ['content.xml', odfContent(ext)],
      ],
      options.encrypted,
      options.compressionRatio,
    );
  }

  const main =
    ext === 'docx'
      ? ['word/document.xml', 'wordprocessingml']
      : ext === 'pptx'
        ? ['ppt/presentation.xml', 'presentationml']
        : ['xl/workbook.xml', 'spreadsheetml'];
  return zip(officeXmlParts(ext, main), options.encrypted, options.compressionRatio);
}

function odfContent(ext: string) {
  const body =
    ext === 'odt'
      ? '<text:p>O09 sample document</text:p>'
      : ext === 'ods'
        ? '<table:table table:name="Sheet1"><table:table-row><table:table-cell office:value-type="string"><text:p>O09</text:p></table:table-cell></table:table-row></table:table>'
        : '<draw:page draw:name="Slide 1" draw:style-name="dp1"/>';
  return `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.2"><office:body><office:${ext === 'odt' ? 'text' : ext === 'ods' ? 'spreadsheet' : 'presentation'}>${body}</office:${ext === 'odt' ? 'text' : ext === 'ods' ? 'spreadsheet' : 'presentation'}</office:body></office:document-content>`;
}

function officeXmlParts(ext: string, main: string[]) {
  const types = `application/vnd.openxmlformats-officedocument.${main[1]}.document.main+xml`;
  const rootType =
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
  const entries: Array<[string, string]> = [
    [
      '[Content_Types].xml',
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main[0]}" ContentType="${types}"/></Types>`,
    ],
    [
      '_rels/.rels',
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rootType}" Target="${main[0]}"/></Relationships>`,
    ],
  ];
  if (ext === 'docx')
    entries.push([
      main[0],
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>O09 sample document</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    ]);
  if (ext === 'xlsx')
    entries.push(
      [
        main[0],
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
      ],
      [
        'xl/_rels/workbook.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ],
      [
        'xl/worksheets/sheet1.xml',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>O09</t></is></c></row></sheetData></worksheet>',
      ],
    );
  if (ext === 'pptx')
    entries.push(
      [
        main[0],
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>',
      ],
      [
        'ppt/_rels/presentation.xml.rels',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
      ],
      [
        'ppt/slides/slide1.xml',
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/></p:spTree></p:cSld></p:sld>',
      ],
    );
  return entries;
}
