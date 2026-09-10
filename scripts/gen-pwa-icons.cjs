// 生成 PWA 全套图标：从 public/favicon.svg 光栅化为各尺寸 PNG
// 产物：public/pwa-192x192.png、public/pwa-512x512.png（透明底蓝扳手）
//       public/maskable-icon-512x512.png、public/apple-touch-icon-180x180.png（蓝底白扳手）
// 用法：node scripts/gen-pwa-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const SVG_BLUE = fs.readFileSync(path.join(PUBLIC_DIR, 'favicon.svg'), 'utf8');
// 品牌蓝底白扳手版本：将 favicon 的填充色替换为白色，用于 maskable / apple-touch 图标
const SVG_WHITE = SVG_BLUE.replace('fill="#1677ff"', 'fill="#ffffff"');
const BRAND_BLUE = { r: 22, g: 119, b: 255, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** 以指定尺寸栅格化 SVG（补上宽高属性，保证渲染清晰度） */
async function rasterize(svg, size = 1024) {
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  return sharp(Buffer.from(sized)).png().toBuffer();
}

/** 裁剪透明边缘，得到紧凑的扳手图形 */
async function getTrimmed(svg) {
  return sharp(await rasterize(svg)).trim().png().toBuffer();
}

/** 生成图标：图形按 ratio 缩放居中，叠放在指定背景色的方形画布上 */
async function makeIcon({ trimmed, size, ratio, background, out }) {
  // maskable 要求图形位于画布中央安全区内（约 80% 直径的圆内），故内容占比更小
  const content = Math.round(size * ratio);
  const resized = await sharp(trimmed)
    .resize(content, content, { fit: 'contain', background: TRANSPARENT })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: resized, gravity: 'center' }])
    .png()
    .toFile(path.join(PUBLIC_DIR, out));
  console.log('generated:', out);
}

async function main() {
  const blueWrench = await getTrimmed(SVG_BLUE);
  const whiteWrench = await getTrimmed(SVG_WHITE);

  // 透明底蓝扳手：用于通用图标与安装弹窗展示
  await makeIcon({
    trimmed: blueWrench, size: 192, ratio: 0.82, background: TRANSPARENT, out: 'pwa-192x192.png',
  });
  await makeIcon({
    trimmed: blueWrench, size: 512, ratio: 0.82, background: TRANSPARENT, out: 'pwa-512x512.png',
  });
  // 蓝底白扳手：maskable 自适应图标（安卓桌面任意形状裁剪均安全）
  await makeIcon({
    trimmed: whiteWrench, size: 512, ratio: 0.55, background: BRAND_BLUE, out: 'maskable-icon-512x512.png',
  });
  // iOS 主屏幕图标（系统自动加圆角，实底避免透明变黑边）
  await makeIcon({
    trimmed: whiteWrench, size: 180, ratio: 0.68, background: BRAND_BLUE, out: 'apple-touch-icon-180x180.png',
  });
}

main().catch((err) => {
  console.error('生成 PWA 图标失败:', err);
  process.exit(1);
});
