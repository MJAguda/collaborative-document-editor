import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { ImportError, importFile, sanitize } from '../server/content.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

function bombZip(): Buffer {
    const data = deflateRawSync(Buffer.alloc(6 * 1024 * 1024)); // 6 MB of zeros -> a few KB
    const name = Buffer.from('word/document.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(6 * 1024 * 1024, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(6 * 1024 * 1024, 24);
    central.writeUInt16LE(name.length, 28);
    const cdOffset = local.length + name.length + data.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    return Buffer.concat([local, name, data, central, name, eocd]);
}

describe('sanitize', () => {
  it('keeps every format the editor produces unchanged', () => {
    const html =
      '<h1>A</h1><h2>B</h2><h3>C</h3><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p>' +
      '<ul><li><p>x</p></li></ul><ol start="3"><li><p>y</p></li></ol><blockquote><p>q</p></blockquote>' +
      '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">link</a></p>';
    expect(sanitize(html)).toBe(html);
  });

  it('removes scripts, styles, event handlers, images, iframes and unsafe links', () => {
    const dirty =
      '<p style="color:red" onclick="x()">a</p><style>p{}</style><script>alert(1)</script>' +
      '<img src="x" onerror="alert(1)"><iframe src="https://e.x"></iframe>' +
      '<a href="javascript:alert(1)">j</a><a href="data:text/html,1">d</a>';
    expect(sanitize(dirty)).toBe('<p>a</p><a>j</a><a>d</a>');
  });

  it('maps h4-h6 to h3 and b/i to strong/em', () => {
    expect(sanitize('<h5>five</h5><b>b</b><i>i</i>')).toBe('<h3>five</h3><strong>b</strong><em>i</em>');
  });
});

describe('importFile', () => {
  it('turns .txt lines into escaped paragraphs and uses the file name as title', async () => {
    const out = await importFile('notes.txt', Buffer.from('Line one\r\nLine <two> & more\n\nLast\n'));
    expect(out).toEqual({ title: 'notes', html: '<p>Line one</p><p>Line &lt;two&gt; &amp; more</p><p></p><p>Last</p>' });
  });

  it('converts .md headings, emphasis and lists, and drops raw HTML', async () => {
    const { title, html } = await importFile('sample.md', fixture('sample.md'));
    expect(title).toBe('sample');
    expect(html).toContain('<h1>Imported heading</h1>');
    expect(html).toContain('<p>Some <strong>bold</strong> and <em>italic</em> text.</p>');
    expect(html).toMatch(/<ul>\s*<li>First<\/li>\s*<li>Second<\/li>\s*<\/ul>/);
    expect(html).toMatch(/<ol>\s*<li>One<\/li>\s*<li>Two<\/li>\s*<\/ol>/);
    expect(html).not.toContain('script');
  });

  it('converts .docx headings, bold and lists (extension is case-insensitive)', async () => {
    const { title, html } = await importFile('Sample.DOCX', fixture('sample.docx'));
    expect(title).toBe('Sample');
    expect(html).toBe('<h2>Docx heading</h2><p>Plain and <strong>bold</strong> and <u>under</u></p><ul><li>First item</li><li>Second item</li></ul>');
  });

  it('rejects a .docx that expands past the cap before converting it (zip bomb)', async () => {
    const zip = bombZip();
    expect(zip.length).toBeLessThan(100 * 1024);
    const err = await importFile('bomb.docx', zip).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err).toMatchObject({ status: 413, message: 'The .docx file expands to more than 3 MB' });
  });

  it('rejects a zip bomb even when bytes are prepended to the file', async () => {
    const err = await importFile('bomb.docx', Buffer.concat([Buffer.alloc(16, 65), bombZip()])).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 413, message: 'The .docx file expands to more than 3 MB' });
  });

  it('fails closed on a corrupt central directory', async () => {
    const docx = Buffer.from(fixture('sample.docx'));
    const eocd = docx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    docx.writeUInt32LE(0, eocd - docx.readUInt32LE(eocd + 12)); // wipe the first directory entry's signature
    const err = await importFile('corrupt.docx', docx).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 413, message: 'The .docx file expands to more than 3 MB' });
  });

  it('rejects converted content over the 512 KB import limit with a 413 ImportError', async () => {
    const err = await importFile('big.txt', Buffer.from('x'.repeat(600 * 1024))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err).toMatchObject({ status: 413, message: 'The imported document is larger than 512 KB' });
  });

  it.each([
    ['report.pdf', Buffer.from('%PDF-1.4'), 'Unsupported file type. Supported: .txt, .md, .docx'],
    ['noext', Buffer.from('x'), 'Unsupported file type. Supported: .txt, .md, .docx'],
    ['empty.md', Buffer.alloc(0), 'The file is empty'],
    ['broken.docx', Buffer.from('not a zip'), 'Could not read the .docx file'],
  ])('rejects %s with a 400 ImportError', async (name, buffer, message) => {
    const err = await importFile(name, buffer).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect(err).toMatchObject({ status: 400, message });
  });
});
