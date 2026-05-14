// Generates minimal placeholder PNGs for every icon path the manifest references.
// Real icons can replace these later; this just makes the plugin load without warnings.
// Uses only Node built-ins (zlib + crc32 via a tiny implementation).
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "com.siming.claude-code.sdPlugin");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(size, [r, g, b, a]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 4);
  row[0] = 0;
  for (let x = 0; x < size; x++) {
    const o = 1 + x * 4;
    row[o] = r; row[o + 1] = g; row[o + 2] = b; row[o + 3] = a;
  }
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) row.copy(raw, y * (1 + size * 4));
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const ACTIONS = [
  ["approve", [60, 200, 120, 255]],
  ["deny", [220, 80, 80, 255]],
  ["compact", [100, 140, 220, 255]],
  ["clear", [120, 120, 140, 255]],
  ["slash-command", [180, 140, 220, 255]],
  ["usage-5h", [255, 170, 60, 255]],
  ["cost-window", [60, 200, 200, 255]],
  ["session-tokens", [220, 180, 100, 255]],
];

function write(path, buf) {
  const full = resolve(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, buf);
}

write("imgs/plugin/icon.png", makePng(28, [40, 40, 50, 255]));
write("imgs/plugin/icon@2x.png", makePng(56, [40, 40, 50, 255]));
write("imgs/plugin/category-icon.png", makePng(28, [40, 40, 50, 255]));
write("imgs/plugin/category-icon@2x.png", makePng(56, [40, 40, 50, 255]));

for (const [name, color] of ACTIONS) {
  write(`imgs/actions/${name}/icon.png`, makePng(20, color));
  write(`imgs/actions/${name}/icon@2x.png`, makePng(40, color));
  write(`imgs/actions/${name}/key.png`, makePng(72, [30, 30, 35, 255]));
  write(`imgs/actions/${name}/key@2x.png`, makePng(144, [30, 30, 35, 255]));
}

console.log("Generated placeholder icons under", ROOT);
