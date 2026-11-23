import { registerOffline } from '../offline';
import { decodeFile } from '../page';
import { diffImages } from './diff';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const images: { a?: ImageData; b?: ImageData } = {};
const CHANNELS = ['red', 'green', 'blue', 'alpha'];

function draw(id: string, img: ImageData) {
  const c = $<HTMLCanvasElement>(id);
  [c.width, c.height] = [img.width, img.height];
  c.getContext('2d')!.putImageData(img, 0, 0);
}

function update() {
  const levels = Number($<HTMLInputElement>('levels').value);
  $('levels-value').textContent = String(levels);
  const verdict = $('verdict');
  const { a, b } = images;
  if (!a || !b) return void (verdict.textContent = 'Choose two images.');
  let d;
  try {
    d = diffImages(a, b, { levels, allowed: Number($<HTMLInputElement>('allowed').value) / 100 });
  } catch (e) {
    verdict.textContent = (e as Error).message;
    verdict.className = 'bad';
    verdict.dataset.verdict = 'error';
    return;
  }
  draw('map', new ImageData(d.map as Uint8ClampedArray<ArrayBuffer>, a.width, a.height));
  const pct = (n: number) => `${((100 * n) / d.pixels).toFixed(n && n < d.pixels / 1000 ? 3 : 2)}%`;
  verdict.textContent = d.agree
    ? d.max === 0
      ? 'Identical: every pixel is the same.'
      : `They agree within ${levels} level${levels === 1 ? '' : 's'}.`
    : `They differ: ${d.over} pixel${d.over === 1 ? '' : 's'} (${pct(d.over)}) beyond ${levels} level${levels === 1 ? '' : 's'}.`;
  verdict.className = d.agree ? 'ok' : 'bad';
  verdict.dataset.verdict = d.agree ? 'agree' : 'differ';
  const stats = $<HTMLTableElement>('stats');
  stats.hidden = false;
  stats.innerHTML = '';
  const row = (k: string, v: string) => {
    const r = stats.insertRow();
    r.insertCell().textContent = k;
    r.insertCell().textContent = v;
  };
  row('Size', `${a.width}×${a.height}`);
  row('Largest difference', d.at ? `${d.max} levels (${CHANNELS[d.at.channel]} at ${d.at.x}, ${d.at.y})` : '0');
  row('Mean difference', `${d.mean.toFixed(4)} levels`);
  row('Pixels that differ at all', `${d.differing} (${pct(d.differing)})`);
  row(`Beyond ${levels} levels`, `${d.over} (${pct(d.over)})`);
}

for (const key of ['a', 'b'] as const)
  $<HTMLInputElement>(key).addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    images[key] = await decodeFile(file);
    draw(key === 'a' ? 'first' : 'second', images[key]);
    update();
  });
for (const id of ['levels', 'allowed']) $(id).addEventListener('input', update);
update();
registerOffline();
