// 生成 2x2 测试 PNG：含完全透明、半透明、不透明像素，用于验证 alpha 归一化功能
const zlib = require('node:zlib');
const fs = require('node:fs');

const W = 2;
const H = 2;
// RGBA: [255,0,0,0] 完全透明 | [0,255,0,128] 半透明 | [0,0,255,64] 半透明 | [255,255,0,255] 不透明
const rgba = [255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 64, 255, 255, 0, 255];

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// 扫描线：每行前 1 字节过滤器类型(0=无过滤)，后跟 RGBA 像素
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 4)] = 0;
  for (let x = 0; x < W; x++) {
    const src = (y * W + x) * 4;
    const dst = y * (1 + W * 4) + 1 + x * 4;
    raw[dst] = rgba[src];
    raw[dst + 1] = rgba[src + 1];
    raw[dst + 2] = rgba[src + 2];
    raw[dst + 3] = rgba[src + 3];
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.writeFileSync('test-alpha.png', png);
console.log('test-alpha.png created, size:', png.length, 'bytes');
