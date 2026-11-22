// Generuje ikony PWA (PNG) bez zależności: node scripts/gen-icons.mjs
// Motyw: ciemny kafel Liquid Glass z łukiem prędkościomierza i wskazówką.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const png = (size, rgba) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** maskable: pełne tło do krawędzi, motyw w bezpiecznej strefie 80%. */
function render(size, { maskable }) {
  const SS = 3;
  const buf = Buffer.alloc(size * size * 4);
  const R = size / 2;
  const scale = maskable ? 0.62 : 0.74; // promień motywu względem połowy rozmiaru
  const corner = maskable ? 0 : size * 0.22;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // kafel z zaokrąglonymi rogami
          const dx = Math.max(Math.abs(px - R) - (R - corner), 0);
          const dy = Math.max(Math.abs(py - R) - (R - corner), 0);
          if (Math.hypot(dx, dy) > corner && corner > 0) continue;
          // tło: gradient radialny
          const g = Math.min(1, Math.hypot(px - size * 0.3, py - size * 0.2) / (size * 0.95));
          let c = mix([44, 78, 140], [11, 13, 18], g);
          // łuk prędkościomierza (270°), przerwa u dołu
          const rx = px - R;
          const ry = py - R;
          const r = Math.hypot(rx, ry) / (R * scale);
          let ang = (Math.atan2(ry, rx) * 180) / Math.PI; // 0 = prawo, 90 = dół
          ang = (ang + 360) % 360;
          const inArc = ang >= 135 + 0 && ang <= 405 ? true : ang <= 45;
          const arcAng = ang >= 135 ? ang - 135 : ang + 225; // 0..270 od lewego-dolnego
          if (inArc && r > 0.82 && r < 1) {
            const t = arcAng / 270;
            c = mix([120, 190, 255], [150, 235, 170], t);
            if (t > 0.78) c = mix(c, [255, 120, 100], (t - 0.78) / 0.22);
          }
          // wskazówka (~65% zakresu)
          const na = ((135 + 270 * 0.62) * Math.PI) / 180;
          const along = rx * Math.cos(na) + ry * Math.sin(na);
          const across = Math.abs(-rx * Math.sin(na) + ry * Math.cos(na));
          if (
            along > 0 &&
            along < R * scale * 0.72 &&
            across < R * scale * (0.055 - 0.04 * (along / (R * scale * 0.72)))
          )
            c = [255, 255, 255];
          if (Math.hypot(rx, ry) < R * scale * 0.09) c = [255, 255, 255];
          acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + 255];
        }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      const a = acc[3] / n;
      buf[o] = a ? acc[0] / (a / 255) / n : 0;
      buf[o + 1] = a ? acc[1] / (a / 255) / n : 0;
      buf[o + 2] = a ? acc[2] / (a / 255) / n : 0;
      buf[o + 3] = Math.round(a);
    }
  return png(size, buf);
}

for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
]) {
  writeFileSync(join(out, name), render(size, { maskable }));
  console.log("icon", name);
}
