import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodecError, editXmp, readMetadata, readXmpEdit } from './index';
import { parseXmp } from './xmp';

const dir = fileURLToPath(new URL('../test/metadata/', import.meta.url));
const xmp = (await readMetadata(new Uint8Array(readFileSync(dir + 'photo.jpg')))).xmp!;

const wrap = (body: string, ns = '') =>
  `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""${ns}>${body}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

describe('editXmp', () => {
  it('without edits returns the same text', () => {
    expect(editXmp(xmp, {})).toBe(xmp);
  });

  it('removing GPS takes every exif:GPS… property and nothing else', () => {
    expect(xmp).toContain('GPSLatitude');
    const out = editXmp(xmp, { remove: { gps: true } });
    expect(out).not.toMatch(/GPS/);
    for (const kept of ['Jane Photographer', 'River', 'Milano', '>4<', 'SN-123456']) expect(out).toContain(kept);
    expect(() => parseXmp(out)).not.toThrow();
  });

  it('removing personal fields takes the creator and serial numbers, element or attribute form', () => {
    const out = editXmp(xmp, { remove: { personal: true } });
    expect(out).not.toContain('Jane Photographer');
    expect(out).not.toContain('SN-123456');
    for (const kept of ['River', 'Milano', 'GPSLatitude']) expect(out).toContain(kept);
    const attrs = wrap('', ' xmlns:aux="http://ns.adobe.com/exif/1.0/aux/" aux:SerialNumber="123" aux:Lens="50mm"');
    const cut = editXmp(attrs, { remove: { personal: true } });
    expect(cut).not.toContain('123');
    expect(cut).toContain('aux:Lens="50mm"');
  });

  it('matches by namespace, not by prefix', () => {
    const odd = wrap('<ex:GPSLatitude>45,1N</ex:GPSLatitude><ex:FNumber>2.8</ex:FNumber><d:creator><rdf:Seq><rdf:li>Me</rdf:li></rdf:Seq></d:creator>', ' xmlns:ex="http://ns.adobe.com/exif/1.0/" xmlns:d="http://purl.org/dc/elements/1.1/"');
    const out = editXmp(odd, { remove: { gps: true, personal: true } });
    expect(out).not.toContain('45,1N');
    expect(out).not.toContain('>Me<');
    expect(out).toContain('<ex:FNumber>2.8</ex:FNumber>');
  });

  it('keeps GPS-named properties of other namespaces, and removes properties nested in removed ones once', () => {
    const other = wrap('<foo:GPSNote>kept</foo:GPSNote>', ' xmlns:foo="urn:example"');
    expect(editXmp(other, { remove: { gps: true } })).toContain('<foo:GPSNote>kept</foo:GPSNote>');
    const nested = wrap(
      '<dc:creator><rdf:Seq><rdf:li><exif:GPSLatitude>45N</exif:GPSLatitude>Me</rdf:li></rdf:Seq></dc:creator><dc:title>T</dc:title>',
      ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:exif="http://ns.adobe.com/exif/1.0/"',
    );
    const out = editXmp(nested, { remove: { gps: true, personal: true } });
    expect(() => parseXmp(out)).not.toThrow();
    expect(out).toContain('<dc:title>T</dc:title>');
    expect(out).not.toContain('45N');
    expect(out).not.toContain('Me<');
  });

  it('sets tiff:Orientation, attribute or element', () => {
    const attr = wrap('', ' xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Orientation="6"');
    expect(editXmp(attr, { orientation: 1 })).toContain('tiff:Orientation="1"');
    const elem = wrap('<tiff:Orientation>8</tiff:Orientation>', ' xmlns:tiff="http://ns.adobe.com/tiff/1.0/"');
    expect(editXmp(elem, { orientation: 1 })).toContain('<tiff:Orientation>1</tiff:Orientation>');
  });

  it('embeds the edit document as rullino:edit and reads it back exactly, replacing an older one', () => {
    const doc = JSON.stringify({ version: 3, note: '<&>"\' &lt; é 😀', nodes: [] });
    const once = editXmp(xmp, { edit: doc });
    expect(readXmpEdit(once)).toBe(doc);
    expect(once).toContain('&amp;lt;'); // escaped, so the text survives any XML reader
    const twice = editXmp(once, { edit: '{"version":3,"second":true}' });
    expect(readXmpEdit(twice)).toBe('{"version":3,"second":true}');
    expect(twice.match(/rullino:edit/g)!.length).toBe(2); // one element: its open and close tags
    expect(readXmpEdit(xmp)).toBeUndefined();
    expect(() => parseXmp(twice)).not.toThrow();
    for (const kept of ['Jane Photographer', 'River', 'GPSLatitude']) expect(twice).toContain(kept);
  });

  it('starts a packet when there is none, and reads the attribute form other tools may write', () => {
    const fresh = editXmp(undefined, { edit: '{"version":3}' });
    expect(fresh).toMatch(/^<\?xpacket begin=/);
    expect(readXmpEdit(fresh)).toBe('{"version":3}');
    const asAttribute = wrap('', ' xmlns:rullino="https://stefanomasneri.com/rullino/ns/1.0/" rullino:edit="{&quot;version&quot;:3}"');
    expect(readXmpEdit(asAttribute)).toBe('{"version":3}');
  });

  it('refuses malformed XML or a packet without rdf:RDF with a CodecError', () => {
    expect(() => editXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><a></b></x:xmpmeta>', { remove: { gps: true } })).toThrow(CodecError);
    expect(() => editXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>', { edit: '{}' })).toThrow(/rdf:RDF/);
    expect(() => editXmp('<!DOCTYPE x [<!ENTITY a "b">]><x/>', {})).not.toThrow(); // no edits: untouched, not parsed
    expect(() => editXmp('<!DOCTYPE x [<!ENTITY a "b">]><x/>', { orientation: 1 })).toThrow(CodecError);
    expect(readXmpEdit('<not xml')).toBeUndefined();
  });
});
