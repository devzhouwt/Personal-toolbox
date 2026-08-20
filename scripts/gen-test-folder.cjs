// 生成批量处理测试文件：a.png（含半透明）、b.bmp（非PNG格式）、sub/c.png（子目录）、readme.txt（非图片）
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, 'test-folder');

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

/** 生成 RGBA 像素 PNG */
function makePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = y * (1 + width * 4) + 1 + x * 4;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 生成 24 位未压缩 BMP */
function makeBmp(width, height, rgb) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const fileSize = 54 + pixelSize;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); // planes
  buf.writeUInt16LE(24, 28); // bit count
  buf.writeUInt32LE(0, 30); // no compression
  buf.writeUInt32LE(pixelSize, 34);
  for (let y = 0; y < height; y++) {
    const dstRow = (height - 1 - y) * rowSize + 54; // 底部行先存
    for (let x = 0; x < width; x++) {
      const dst = dstRow + x * 3;
      buf[dst] = rgb[1]; // B
      buf[dst + 1] = rgb[0]; // G
      buf[dst + 2] = rgb[2]; // R
    }
  }
  return buf;
}

fs.mkdirSync(path.join(OUT_DIR, 'sub'), { recursive: true });

// a.png：2x2，2 个半透明像素
fs.writeFileSync(
  path.join(OUT_DIR, 'a.png'),
  makePng(2, 2, [255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 64, 255, 255, 0, 255])
);

// b.bmp：2x2 蓝色（无 alpha）
fs.writeFileSync(
  path.join(OUT_DIR, 'b.bmp'),
  makeBmp(2, 2, [0, 0, 255])
);

// sub/c.png：1x1 半透明
fs.writeFileSync(
  path.join(OUT_DIR, 'sub', 'c.png'),
  makePng(1, 1, [0, 128, 0, 100])
);

// readme.txt：非图片，应被跳过
fs.writeFileSync(path.join(OUT_DIR, 'readme.txt'), 'not an image');

console.log('test-folder created:', fs.readdirSync(OUT_DIR, { recursive: true }).join(', '));
