import {
  PictureOutlined,
} from '@ant-design/icons';
import PngAlphaNormalize from './pngAlphaNormalize/PngAlphaNormalize';

/**
 * 工具注册表：新增工具时只需在此添加一条记录，并实现对应的组件。
 * 字段说明：
 * - path      路由路径（唯一）
 * - name      工具名称
 * - desc      工具描述（首页卡片展示）
 * - icon      图标
 * - component 工具组件
 * - tag       可选标签，如 'NEW'，用于标记新增工具
 */
const tools = [
  {
    path: '/tools/png-alpha-normalize',
    name: 'PNG 透明度归一化',
    desc: '将 PNG 图片中所有非完全透明的像素 alpha 值设置为 255，消除半透明边缘。',
    icon: PictureOutlined,
    component: PngAlphaNormalize,
    tag: 'NEW',
  },
];

export default tools;
