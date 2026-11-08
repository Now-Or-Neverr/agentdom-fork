// Markdown -> real Word (.docx) file, entirely in the browser. Loaded only on demand
// (dynamic import from the decree page), so `docx` and the Markdown parser stay out of the main bundle.
// Covers headings, paragraphs, bold/italic/strike, inline code, links, bullet/numbered/task lists,
// block quotes, code blocks, simple tables and horizontal rules. Images become a text link.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import type { BlockContent, DefinitionContent, List, PhrasingContent, RootContent, Table as MdTable } from 'mdast';

type Marks = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };
const MONO = 'Consolas';
const LINK = '8A5A2B';

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];

function run(text: string, m: Marks, extra: Record<string, unknown> = {}) {
  return new TextRun({ text, bold: m.bold, italics: m.italics, strike: m.strike, ...(m.code ? { font: MONO, shading: { type: ShadingType.CLEAR, fill: 'EFEAE2', color: 'auto' } } : {}), ...extra });
}

function inline(nodes: PhrasingContent[], m: Marks = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
        out.push(run(n.value.replace(/\n/g, ' '), m));
        break;
      case 'strong':
        out.push(...inline(n.children, { ...m, bold: true }));
        break;
      case 'emphasis':
        out.push(...inline(n.children, { ...m, italics: true }));
        break;
      case 'delete':
        out.push(...inline(n.children, { ...m, strike: true }));
        break;
      case 'inlineCode':
        out.push(run(n.value, { ...m, code: true }));
        break;
      case 'break':
        out.push(new TextRun({ text: '', break: 1 }));
        break;
      case 'link': {
        const text = flatText(n.children) || n.url;
        if (/^(https?:|mailto:)/i.test(n.url)) out.push(new ExternalHyperlink({ link: n.url, children: [run(text, m, { color: LINK, underline: {} })] }));
        else out.push(run(text, m));
        break;
      }
      case 'image':
        if (/^https?:/i.test(n.url)) out.push(new ExternalHyperlink({ link: n.url, children: [run(`[Image: ${n.alt || 'image'}]`, m, { color: LINK, underline: {} })] }));
        else out.push(run(`[Image: ${n.alt || 'image'}]`, m));
        break;
      case 'html':
        out.push(run(n.value.replace(/<[^>]+>/g, ''), m));
        break;
      default:
        if ('children' in n && Array.isArray((n as { children?: unknown }).children)) out.push(...inline((n as { children: PhrasingContent[] }).children, m));
        else if ('value' in n && typeof (n as { value?: unknown }).value === 'string') out.push(run((n as { value: string }).value, m));
    }
  }
  return out;
}

/** Plain text of phrasing content (for hyperlink labels, which hold text runs only). */
function flatText(nodes: PhrasingContent[]): string {
  return nodes
    .map((n) => (n.type === 'image' ? n.alt ?? '' : 'value' in n && typeof n.value === 'string' ? n.value : 'children' in n ? flatText(n.children as PhrasingContent[]) : ''))
    .join('');
}

type Ctx = { lists: number };

function table(t: MdTable): Table {
  const cols = Math.max(1, ...t.children.map((r) => r.children.length));
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFB6A8' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: t.children.map(
      (row, ri) =>
        new TableRow({
          tableHeader: ri === 0,
          children: Array.from({ length: cols }, (_, ci) => {
            const cell = row.children[ci];
            const align = t.align?.[ci];
            return new TableCell({
              ...(ri === 0 ? { shading: { type: ShadingType.CLEAR, fill: 'EFEAE2', color: 'auto' } } : {}),
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
                  children: cell ? inline(cell.children, ri === 0 ? { bold: true } : {}) : [],
                }),
              ],
            });
          }),
        }),
    ),
  });
}

function list(l: List, level: number, ctx: Ctx, out: (Paragraph | Table)[]) {
  const instance = ++ctx.lists;
  for (const item of l.children) {
    let first = true;
    for (const child of item.children) {
      if (child.type === 'paragraph') {
        const prefix = first && item.checked != null ? [new TextRun({ text: item.checked ? '[x] ' : '[ ] ' })] : [];
        out.push(
          new Paragraph({
            ...(first
              ? l.ordered
                ? { numbering: { reference: 'md-num', level: Math.min(level, 8), instance } }
                : { bullet: { level: Math.min(level, 8) } }
              : { indent: { left: 720 * (level + 1) } }),
            children: [...prefix, ...inline(child.children)],
          }),
        );
        first = false;
      } else if (child.type === 'list') list(child, level + 1, ctx, out);
      else block(child, ctx, out, level + 1);
    }
  }
}

function block(n: RootContent | BlockContent | DefinitionContent, ctx: Ctx, out: (Paragraph | Table)[], indent = 0) {
  const ind = indent ? { indent: { left: 720 * indent } } : {};
  switch (n.type) {
    case 'heading':
      out.push(new Paragraph({ heading: HEADINGS[Math.min(n.depth, 6) - 1], children: inline(n.children) }));
      break;
    case 'paragraph':
      out.push(new Paragraph({ ...ind, spacing: { after: 140 }, children: inline(n.children) }));
      break;
    case 'list':
      list(n, indent, ctx, out);
      break;
    case 'blockquote':
      for (const c of n.children) {
        if (c.type === 'paragraph')
          out.push(
            new Paragraph({
              indent: { left: 720 * (indent + 1) },
              border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BFB6A8', space: 8 } },
              spacing: { after: 120 },
              children: inline(c.children, { italics: true }),
            }),
          );
        else block(c, ctx, out, indent + 1);
      }
      break;
    case 'code': {
      const lines = n.value.split('\n');
      lines.forEach((line, i) =>
        out.push(
          new Paragraph({
            ...ind,
            shading: { type: ShadingType.CLEAR, fill: 'F3EFE8', color: 'auto' },
            spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 160 : 0 },
            children: [new TextRun({ text: line || ' ', font: MONO, size: 19 })],
          }),
        ),
      );
      break;
    }
    case 'table':
      out.push(table(n));
      out.push(new Paragraph({ children: [] }));
      break;
    case 'thematicBreak':
      out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFB6A8', space: 1 } }, children: [] }));
      break;
    case 'html': {
      const t = n.value.replace(/<[^>]+>/g, '').trim();
      if (t) out.push(new Paragraph({ ...ind, children: [new TextRun(t)] }));
      break;
    }
    default:
      if ('children' in n && Array.isArray(n.children)) for (const c of n.children as RootContent[]) block(c, ctx, out, indent);
  }
}

export async function markdownToDocx(md: string, meta: { title: string; byline: string; footer: string }): Promise<Blob> {
  const tree = fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const body: (Paragraph | Table)[] = [];
  const ctx: Ctx = { lists: 0 };
  for (const n of tree.children) block(n, ctx, body);

  const doc = new Document({
    title: meta.title,
    creator: 'Agentdom',
    description: meta.byline,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'md-num',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(meta.title)] }),
          new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: meta.byline, italics: true, color: '6B6257' })] }),
          ...body,
          new Paragraph({ spacing: { before: 360 }, border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'BFB6A8', space: 6 } }, children: [new TextRun({ text: meta.footer, size: 18, color: '6B6257' })] }),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}
