import JSZip from 'jszip';

export type WorkbookCell = string | number | boolean | undefined;
export interface WorkbookSheet {
  name: string;
  rows: WorkbookCell[][];
  links?: Array<{ row: number; target: string }>;
}

const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const packageNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
const officeNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const contentNs = 'http://schemas.openxmlformats.org/package/2006/content-types';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function xml(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '') // eslint-disable-line no-control-regex
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnName(index: number) {
  let name = '';
  for (let position = index + 1; position > 0; position = Math.floor((position - 1) / 26)) {
    name = String.fromCharCode(65 + ((position - 1) % 26)) + name;
  }
  return name;
}

function rowXml(row: WorkbookCell[], rowNumber: number, linked: boolean) {
  const cells = row.map((value, index) => {
    if (value === undefined) return '';
    const id = `${columnName(index)}${rowNumber}`;
    const style = rowNumber === 1 ? ' s="1"' : linked && index === 0 ? ' s="2"' : '';
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${id}"${style}><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${id}"${style} t="b"><v>${Number(value)}</v></c>`;
    const text = String(value);
    const bounded = text.length > 32_767 ? `${text.slice(0, 32_763)}…` : text;
    // Inline strings keep action names, error messages, and payloads inert in Excel.
    return `<c r="${id}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(bounded)}</t></is></c>`;
  }).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

const styles = `${declaration}<styleSheet xmlns="${sheetNs}">
  <fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF1260A7"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243C54"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export async function buildRunWorkbook(sheets: WorkbookSheet[]) {
  const zip = new JSZip();
  const parts = sheets.map((_, index) => `worksheets/sheet${index + 1}.xml`);
  zip.file('[Content_Types].xml', `${declaration}<Types xmlns="${contentNs}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${parts.map(path => `<Override PartName="/xl/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `${declaration}<Relationships xmlns="${packageNs}"><Relationship Id="rId1" Type="${officeNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `${declaration}<workbook xmlns="${sheetNs}" xmlns:r="${officeNs}"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `${declaration}<Relationships xmlns="${packageNs}"><Relationship Id="rIdStyles" Type="${officeNs}/styles" Target="styles.xml"/>${parts.map((path, index) => `<Relationship Id="rId${index + 1}" Type="${officeNs}/worksheet" Target="${path}"/>`).join('')}</Relationships>`);
  zip.file('xl/styles.xml', styles);

  for (const [index, sheet] of Array.from(sheets.entries())) {
    if (sheet.rows.length > 1_048_576) throw new Error('A run exceeds the Excel row limit. Choose ZIP to export all its steps.');
    const links = sheet.links?.length ? `<hyperlinks>${sheet.links.map(link => `<hyperlink ref="A${link.row}" location="${xml(`'${link.target}'!A1`)}"/>`).join('')}</hyperlinks>` : '';
    const linked = new Set(sheet.links?.map(link => link.row));
    const width = Math.max(1, sheet.rows[0]?.length ?? 0);
    const range = `A1:${columnName(width - 1)}${sheet.rows.length}`;
    zip.file(`xl/${parts[index]}`, `${declaration}<worksheet xmlns="${sheetNs}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="36" customWidth="1"/>${width > 1 ? `<col min="2" max="${width}" width="23" customWidth="1"/>` : ''}</cols><sheetData>${sheet.rows.map((row, rowIndex) => rowXml(row, rowIndex + 1, linked.has(rowIndex + 1))).join('')}</sheetData><autoFilter ref="${range}"/>${links}</worksheet>`);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Blob([bytes], { type: mimeType });
}
