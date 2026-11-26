// XMP (#180): a small namespace-aware XML reader for XMP packets (elements, attributes, text, where
// they lie in the source) and edits that cut or replace those ranges, so what is not edited stays
// byte for byte, whitespace and padding included. Properties are matched by namespace URI and local
// name, never by prefix. DOCTYPE declarations are refused (XMP has none; no entity is expanded).

import { CodecError } from './types';

const fail = (message: string): never => {
  throw new CodecError('xmp', message);
};

const NS = {
  xmlns: 'http://www.w3.org/2000/xmlns/',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  exif: 'http://ns.adobe.com/exif/1.0/',
  exifEX: 'http://cipa.jp/exif/1.0/',
  aux: 'http://ns.adobe.com/exif/1.0/aux/',
  dc: 'http://purl.org/dc/elements/1.1/',
  photoshop: 'http://ns.adobe.com/photoshop/1.0/',
  iptcCore: 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/',
  tiff: 'http://ns.adobe.com/tiff/1.0/',
  rullino: 'https://stefanomasneri.com/rullino/ns/1.0/',
} as const;

/** The namespace of the edit document property. */
export const RULLINO_NS = NS.rullino;

export interface XmlAttr {
  readonly name: string;
  readonly ns: string | undefined;
  readonly local: string;
  readonly value: string;
  /** Source range of the attribute, the whitespace before it included. */
  readonly start: number;
  readonly end: number;
  /** Source range of the value (inside the quotes). */
  readonly valueStart: number;
  readonly valueEnd: number;
}

export interface XmlElement {
  readonly name: string;
  readonly ns: string | undefined;
  readonly local: string;
  readonly attrs: XmlAttr[];
  readonly children: XmlElement[];
  /** Source ranges: the whole element, and its content (between the tags; empty when self-closing). */
  readonly start: number;
  end: number;
  readonly contentStart: number;
  contentEnd: number;
  readonly prefixes: ReadonlyMap<string, string>;
}

const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const NAME = /[A-Za-z_][\w.:-]*/y;

/** The top-level elements of an XML text, with source positions and resolved namespaces. */
export function parseXmp(xml: string): XmlElement[] {
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let i = 0;
  const resolve = (qname: string, prefixes: ReadonlyMap<string, string>, attribute: boolean) => {
    const colon = qname.indexOf(':');
    const prefix = colon < 0 ? '' : qname.slice(0, colon);
    const local = colon < 0 ? qname : qname.slice(colon + 1);
    if (prefix === 'xmlns' || (!prefix && qname === 'xmlns')) return { ns: NS.xmlns, local };
    if (prefix === 'xml') return { ns: 'http://www.w3.org/XML/1998/namespace', local };
    if (!prefix) return { ns: attribute ? undefined : prefixes.get(''), local };
    const ns = prefixes.get(prefix);
    if (ns === undefined) fail(`unbound prefix ${prefix}`);
    return { ns, local };
  };
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i);
      if (end < 0) fail('unterminated processing instruction');
      i = end + 2;
    } else if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i);
      if (end < 0) fail('unterminated comment');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i);
      if (end < 0) fail('unterminated CDATA section');
      i = end + 3;
    } else if (xml.startsWith('<!', i)) fail('DOCTYPE and other declarations are not allowed in XMP');
    else if (xml.startsWith('</', i)) {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(xml);
      const top = stack.pop();
      if (!m || !top || m[0] !== top.name) fail(`unexpected closing tag at ${i}`);
      const close = xml.indexOf('>', NAME.lastIndex);
      if (close < 0 || xml.slice(NAME.lastIndex, close).trim()) fail('bad closing tag');
      top!.contentEnd = i;
      top!.end = close + 1;
      i = close + 1;
    } else {
      NAME.lastIndex = i + 1;
      const m = NAME.exec(xml);
      if (!m) fail(`bad tag at ${i}`);
      let j = NAME.lastIndex;
      const raw: { name: string; value: string; start: number; end: number; valueStart: number; valueEnd: number }[] = [];
      for (;;) {
        const ws = j;
        while (/\s/.test(xml[j] ?? '')) j++;
        if (xml[j] === '>' || xml.startsWith('/>', j)) break;
        if (j === ws) fail(`bad attribute at ${j}`);
        NAME.lastIndex = j;
        const a = NAME.exec(xml);
        if (!a) fail(`bad attribute at ${j}`);
        j = NAME.lastIndex;
        while (/\s/.test(xml[j] ?? '')) j++;
        if (xml[j] !== '=') fail('attribute without a value');
        j++;
        while (/\s/.test(xml[j] ?? '')) j++;
        const q = xml[j];
        if (q !== '"' && q !== "'") fail('unquoted attribute value');
        const close = xml.indexOf(q!, j + 1);
        if (close < 0) fail('unterminated attribute value');
        raw.push({ name: a![0], value: unescape(xml.slice(j + 1, close)), start: ws, end: close + 1, valueStart: j + 1, valueEnd: close });
        j = close + 1;
      }
      const selfClosing = xml.startsWith('/>', j);
      const openEnd = j + (selfClosing ? 2 : 1);
      const parent = stack[stack.length - 1];
      const prefixes = new Map(parent?.prefixes ?? []);
      for (const a of raw) {
        if (a.name === 'xmlns') prefixes.set('', a.value);
        else if (a.name.startsWith('xmlns:')) prefixes.set(a.name.slice(6), a.value);
      }
      const { ns, local } = resolve(m![0], prefixes, false);
      const el: XmlElement = {
        name: m![0],
        ns,
        local,
        attrs: raw.map((a) => ({ ...a, ...resolve(a.name, prefixes, true) })),
        children: [],
        start: i,
        end: openEnd,
        contentStart: openEnd,
        contentEnd: openEnd,
        prefixes,
      };
      (parent ? parent.children : roots).push(el);
      if (!selfClosing) stack.push(el);
      i = openEnd;
    }
  }
  if (stack.length) fail(`unclosed element ${stack[stack.length - 1]!.name}`);
  return roots;
}

function* walk(elements: readonly XmlElement[]): Generator<XmlElement> {
  for (const e of elements) {
    yield e;
    yield* walk(e.children);
  }
}

/** Properties that `remove` takes, by namespace and local name. */
const isGps = (ns: string | undefined, local: string) => ns === NS.exif && local.startsWith('GPS');
const PERSONAL: Record<string, readonly string[]> = {
  [NS.dc]: ['creator'],
  [NS.photoshop]: ['AuthorsPosition', 'CaptionWriter'],
  [NS.iptcCore]: ['CreatorContactInfo'],
  [NS.aux]: ['SerialNumber', 'LensSerialNumber', 'OwnerName'],
  [NS.exifEX]: ['BodySerialNumber', 'CameraOwnerName', 'LensSerialNumber'],
  [NS.exif]: ['UserComment', 'ImageUniqueID'],
};
const isPersonal = (ns: string | undefined, local: string) => !!ns && (PERSONAL[ns]?.includes(local) ?? false);

export interface XmpEdits {
  readonly remove?: { readonly gps?: boolean; readonly personal?: boolean };
  /** Sets tiff:Orientation where it is. */
  readonly orientation?: number;
  /** The edit document (JSON text) to embed as rullino:edit; an older one is replaced. */
  readonly edit?: string;
}

const PACKET = (body: string) =>
  `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n <rdf:RDF xmlns:rdf="${NS.rdf}">${body}\n </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;

/**
 * An XMP packet with `edits` applied (a new packet when `xmp` is undefined and something is embedded).
 * Throws a `CodecError` for XML it cannot read or a packet without rdf:RDF.
 */
export function editXmp(xmp: string | undefined, edits: XmpEdits): string {
  if (xmp === undefined) {
    if (edits.edit === undefined) return '';
    xmp = PACKET('');
  }
  if (!edits.remove?.gps && !edits.remove?.personal && edits.orientation === undefined && edits.edit === undefined) return xmp;
  const roots = parseXmp(xmp);
  const cuts: { start: number; end: number; text: string }[] = [];
  const takes = (ns: string | undefined, local: string) => (edits.remove?.gps && isGps(ns, local)) || (edits.remove?.personal && isPersonal(ns, local)) || (edits.edit !== undefined && ns === NS.rullino);
  const removed = new Set<XmlElement>();
  for (const el of walk(roots)) {
    if ([...removed].some((r) => el.start >= r.start && el.end <= r.end)) continue;
    if (takes(el.ns, el.local)) {
      cuts.push({ start: el.start, end: el.end, text: '' });
      removed.add(el);
      continue;
    }
    for (const a of el.attrs) {
      if (takes(a.ns, a.local)) cuts.push({ start: a.start, end: a.end, text: '' });
      else if (edits.orientation !== undefined && a.ns === NS.tiff && a.local === 'Orientation') cuts.push({ start: a.valueStart, end: a.valueEnd, text: String(edits.orientation) });
    }
    if (edits.orientation !== undefined && el.ns === NS.tiff && el.local === 'Orientation' && el.children.length === 0) cuts.push({ start: el.contentStart, end: el.contentEnd, text: String(edits.orientation) });
  }
  if (edits.edit !== undefined) {
    const rdf = [...walk(roots)].find((e) => e.ns === NS.rdf && e.local === 'RDF');
    if (!rdf || rdf.contentEnd === rdf.contentStart && rdf.end === rdf.contentEnd) fail('the packet has no rdf:RDF element');
    const prefix = rdf!.name.includes(':') ? rdf!.name.slice(0, rdf!.name.indexOf(':') + 1) : '';
    cuts.push({
      start: rdf!.contentEnd,
      end: rdf!.contentEnd,
      text: `\n  <${prefix}Description ${prefix}about="" xmlns:rullino="${NS.rullino}">\n   <rullino:edit>${escape(edits.edit)}</rullino:edit>\n  </${prefix}Description>\n `,
    });
  }
  cuts.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = xmp;
  for (const c of cuts) out = out.slice(0, c.start) + c.text + out.slice(c.end);
  return out;
}

/**
 * `xmp` with an `rdf:Description` element (given as XML text, using the packet's `rdf` prefix or none
 * at all) added to its `rdf:RDF`: a packet with several descriptions is one XMP document. A new packet
 * when `xmp` is undefined. What was there stays byte for byte. Throws a `CodecError` for a packet
 * without `rdf:RDF`.
 */
export function addXmpDescription(xmp: string | undefined, description: string): string {
  const packet = xmp ?? PACKET('');
  const rdf = [...walk(parseXmp(packet))].find((e) => e.ns === NS.rdf && e.local === 'RDF');
  if (!rdf || (rdf.contentEnd === rdf.contentStart && rdf.end === rdf.contentEnd)) fail('the packet has no rdf:RDF element');
  return packet.slice(0, rdf!.contentEnd) + description + packet.slice(rdf!.contentEnd);
}

/** The edit document (JSON text) embedded as rullino:edit, or undefined (none, or XML it cannot read). */
export function readXmpEdit(xmp: string): string | undefined {
  let roots: XmlElement[];
  try {
    roots = parseXmp(xmp);
  } catch {
    return undefined;
  }
  for (const el of walk(roots)) {
    if (el.ns === NS.rullino && el.local === 'edit' && el.children.length === 0) return unescape(xmp.slice(el.contentStart, el.contentEnd));
    const a = el.attrs.find((x) => x.ns === NS.rullino && x.local === 'edit');
    if (a) return a.value;
  }
  return undefined;
}
