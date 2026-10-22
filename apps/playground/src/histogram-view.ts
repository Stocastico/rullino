import type { Histogram } from '@rullino/core';

// Draws R, G, B (added with 'lighter', so overlaps turn white) and the luminosity outline of the
// current output. The scale ignores the two extreme bins, which clipped images fill up.

const HEIGHT = 100;

export function drawHistogram(canvas: HTMLCanvasElement, h: Histogram): void {
  if (canvas.width !== 256 || canvas.height !== HEIGHT) [canvas.width, canvas.height] = [256, HEIGHT];
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 256, HEIGHT);
  let max = 1;
  for (const ch of [h.red, h.green, h.blue, h.luma]) for (let i = 1; i < 255; i++) max = Math.max(max, ch[i]!);
  const bar = (v: number) => Math.min(HEIGHT, (v / max) * HEIGHT);
  ctx.globalCompositeOperation = 'lighter';
  for (const [ch, colour] of [[h.red, 'rgb(220 60 60 / 0.8)'], [h.green, 'rgb(60 200 80 / 0.8)'], [h.blue, 'rgb(70 110 240 / 0.8)']] as const) {
    ctx.fillStyle = colour;
    for (let i = 0; i < 256; i++) ctx.fillRect(i, HEIGHT - bar(ch[i]!), 1, bar(ch[i]!));
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgb(240 240 240 / 0.9)';
  ctx.beginPath();
  for (let i = 0; i < 256; i++) ctx.lineTo(i + 0.5, HEIGHT - bar(h.luma[i]!));
  ctx.stroke();
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * h.luma[i]!;
  canvas.dataset.mean = h.count ? (sum / h.count).toFixed(1) : '0';
}
