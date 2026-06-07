// Generate solid-accent placeholder PNG icons so `tauri dev`/`generate_context!`
// has icons out of the box. Replace later with: npm run tauri icon <your.png>
const zlib = require("zlib");
const { writeFileSync, mkdirSync } = require("fs");
const { join } = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size, [r, g, b, a]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.alloc(1 + size * 4); // filter byte 0 + pixels
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = r; row[1 + x * 4 + 1] = g; row[1 + x * 4 + 2] = b; row[1 + x * 4 + 3] = a;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// Wrap a 256x256 PNG as a single-image .ico (PNG-compressed, valid on Win Vista+).
function ico(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(1, 4); // image count
  const entry = Buffer.alloc(16);
  entry[0] = 0; // width 256 -> 0
  entry[1] = 0; // height 256 -> 0
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8); // bytes of image data
  entry.writeUInt32LE(6 + 16, 12); // offset to image data
  return Buffer.concat([header, entry, pngBuf]);
}

const dir = join(__dirname, "icons");
mkdirSync(dir, { recursive: true });
const accent = [59, 130, 246, 255]; // #3b82f6
for (const [name, size] of [["32x32.png", 32], ["128x128.png", 128], ["128x128@2x.png", 256], ["icon.png", 512]]) {
  writeFileSync(join(dir, name), png(size, accent));
}
writeFileSync(join(dir, "icon.ico"), ico(png(256, accent)));
console.log("Generated placeholder icons (+ icon.ico) in", dir);
