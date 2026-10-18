import sanitizeHtml from 'sanitize-html';
import { marked } from 'marked';
import mammoth from 'mammoth';
import { basename, extname } from 'node:path';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// Limit on the sanitised HTML of an imported document. Kept small for memory: sanitising a save can store
// up to 5x the body (each & becomes &amp;), and the sanitiser alone needs ~45x the body in RAM (more for a whole request), which must fit the 256 MB VM.
export const MAX_CONTENT_BYTES = 512 * 1024;
// JSON body limit for saves: 4x the import cap, because the editor re-serialises lists (<li><p>) and links
// (target/rel) and JSON escapes every quote, so an import under the cap can grow ~3.5x when saved.
export const MAX_REQUEST_BYTES = 4 * MAX_CONTENT_BYTES; // 2 MB
// Total uncompressed size allowed inside a .docx (zip-bomb guard; 22 MB of XML took ~1.2 GB in mammoth; mammoth needs ~40-50x
// the XML in RAM, and 4.9 MB of plain XML OOM-killed the 256 MB VM).
const MAX_DOCX_UNCOMPRESSED_BYTES = 3 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx'];

export class ImportError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Must cover everything the editor (Tiptap StarterKit, headings 1-3) can emit.
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'code', 'pre', 'blockquote', 'hr', 'ul', 'ol', 'li', 'a', 'span'],
  allowedAttributes: { a: ['href', 'target', 'rel'], ol: ['start'], span: ['data-comment-id'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: { h4: 'h3', h5: 'h3', h6: 'h3', b: 'strong', i: 'em',
    // The one allowed span attribute (comment anchor) must be digits only; any other value is dropped.
    span: (tagName, attribs) => ({
      tagName,
      attribs: (/^\d{1,10}$/.test(attribs['data-comment-id'] ?? '') ? { 'data-comment-id': attribs['data-comment-id']! } : {}) as Record<string, string>,
    }),
  },
};

export function sanitize(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

function textToHtml(text: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => `<p>${escape(line)}</p>`)
    .join('');
}

// Sums the uncompressed sizes declared in the zip central directory, without inflating anything.
// Returns 0 when this is not a zip (mammoth then reports the unreadable file) and Infinity when the directory is unreadable.
function docxUncompressedSize(buf: Buffer): number {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return 0;
  let total = 0;
  let pos = eocd - buf.readUInt32LE(eocd + 12); // the directory ends at the EOCD, even if bytes were prepended
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) return Infinity; // fails closed
    total += buf.readUInt32LE(pos + 24); // 0xFFFFFFFF (zip64) alone exceeds the cap
    pos += 46 + buf.readUInt16LE(pos + 28) + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return total;
}

export async function importFile(filename: string, buffer: Buffer): Promise<{ title: string; html: string }> {
  const ext = extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ImportError(400, 'Unsupported file type. Supported: .txt, .md, .docx');
  }
  if (buffer.length === 0) throw new ImportError(400, 'The file is empty');
  const title = (basename(filename, extname(filename)).trim() || 'Imported document').slice(0, 200);
  let html: string;
  if (ext === '.txt') {
    html = textToHtml(buffer.toString('utf8'));
  } else if (ext === '.md') {
    html = await marked.parse(buffer.toString('utf8'));
  } else {
    try {
      if (docxUncompressedSize(buffer) > MAX_DOCX_UNCOMPRESSED_BYTES) {
        throw new ImportError(413, 'The .docx file expands to more than 3 MB');
      }
      html = (await mammoth.convertToHtml({ buffer }, { styleMap: ['u => u'] })).value;
    } catch (e) {
      if (e instanceof ImportError) throw e;
      throw new ImportError(400, 'Could not read the .docx file');
    }
  }
  html = sanitize(html);
  if (Buffer.byteLength(html) > MAX_CONTENT_BYTES) throw new ImportError(413, 'The imported document is larger than 512 KB');
  return { title, html };
}
