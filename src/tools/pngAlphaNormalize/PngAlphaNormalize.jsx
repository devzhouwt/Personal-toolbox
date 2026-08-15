import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Row,
  Space,
  Spin,
  Statistic,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DownloadOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

const { Dragger } = Upload;
const { Paragraph, Text } = Typography;

/** 棋盘格背景，用于直观展示透明区域 */
const CHECKER_BOARD = {
  backgroundImage:
    'conic-gradient(#e5e5e5 0 25%, #ffffff 0 50%, #e5e5e5 0 75%, #ffffff 0)',
  backgroundSize: '16px 16px',
};

/**
 * 将图片中所有非完全透明的像素 alpha 值置为 255。
 * @param {HTMLImageElement} img 已加载完成的图片
 * @returns {{ blob: Blob, stats: object }} 处理后的 PNG blob 与像素统计
 */
async function normalizeAlpha(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let transparentCount = 0; // 完全透明（alpha === 0）
  let modifiedCount = 0; // 半透明（0 < alpha < 255），将被置为 255
  let opaqueCount = 0; // 完全不透明（alpha === 255）

  for (let i = 3; i < data.length; i += 4) {
    const alpha = data[i];
    if (alpha === 0) {
      transparentCount += 1;
    } else if (alpha < 255) {
      modifiedCount += 1;
      data[i] = 255;
      opaqueCount += 1;
    } else {
      opaqueCount += 1;
    }
  }

  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );

  return {
    blob,
    stats: {
      total: canvas.width * canvas.height,
      transparentCount,
      modifiedCount,
      opaqueCount,
      width: canvas.width,
      height: canvas.height,
    },
  };
}

export default function PngAlphaNormalize() {
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null); // { originalUrl, resultUrl, fileName, blob, stats }
  const originalUrlRef = useRef(null);
  const [messageApi, contextHolder] = message.useMessage();

  /** 处理上传的 PNG 文件 */
  async function handleFile(file) {
    if (!/\.png$/i.test(file.name)) {
      messageApi.warning('仅支持 PNG 格式的图片');
      return false;
    }

    setProcessing(true);
    try {
      // 释放上一次的结果，避免内存泄漏
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
      if (result?.resultUrl) URL.revokeObjectURL(result.resultUrl);

      const originalUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = originalUrl;
      });

      const { blob, stats } = await normalizeAlpha(img);
      const resultUrl = URL.createObjectURL(blob);
      originalUrlRef.current = originalUrl;

      const dotIndex = file.name.lastIndexOf('.');
      const baseName = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;

      setResult({
        originalUrl,
        resultUrl,
        fileName: `${baseName}_normalized.png`,
        blob,
        stats,
      });
    } catch (err) {
      messageApi.error(`处理失败：${err.message}`);
    } finally {
      setProcessing(false);
    }
    return false; // 阻止 antd 默认上传行为
  }

  /** 下载处理后的图片 */
  function handleDownload() {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.resultUrl;
    link.download = result.fileName;
    link.click();
  }

  const beforeUpload = (file) => {
    handleFile(file);
    return false;
  };

  /** 上传区（无结果时展示） */
  const uploadArea = useMemo(
    () => (
      <Dragger
        accept=".png,image/png"
        showUploadList={false}
        beforeUpload={beforeUpload}
        disabled={processing}
        style={{ padding: '8px 0' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽 PNG 图片到此处上传</p>
        <p className="ant-upload-hint">
          支持单张图片，处理过程完全在本地浏览器中进行，图片不会上传到服务器
        </p>
      </Dragger>
    ),
    [processing]
  );

  return (
    <div>
      {contextHolder}
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        将图片中所有<Text strong>非完全透明</Text>的像素 alpha 值设置为
        255，常用于去除 PNG 图片的半透明边缘与渐变阴影，处理后仅保留完全透明（alpha
        = 0）与完全不透明两种状态。
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="处理规则"
        description="像素 alpha 值为 0（完全透明）时保持不变；alpha 值大于 0（半透明或完全不透明）时统一置为 255（完全不透明）。"
      />

      {processing ? (
        <div style={{ textAlign: 'center', padding: '48px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">正在处理图片…</Text>
          </div>
        </div>
      ) : result ? (
        <ResultView
          result={result}
          onReset={() => {
            if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
            if (result.resultUrl) URL.revokeObjectURL(result.resultUrl);
            originalUrlRef.current = null;
            setResult(null);
          }}
          onDownload={handleDownload}
        />
      ) : (
        uploadArea
      )}
    </div>
  );
}

/** 处理结果展示：对比预览 + 统计信息 + 下载 */
function ResultView({ result, onReset, onDownload }) {
  const { originalUrl, resultUrl, fileName, blob, stats } = result;

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title="原图"
            styles={{ body: { display: 'flex', justifyContent: 'center' } }}
          >
            <img
              src={originalUrl}
              alt="原图"
              style={{
                maxWidth: '100%',
                maxHeight: 360,
                objectFit: 'contain',
                ...CHECKER_BOARD,
              }}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card
            size="small"
            title="处理后"
            extra={
              <Space>
                <Button size="small" icon={<DownloadOutlined />} onClick={onDownload}>
                  下载
                </Button>
              </Space>
            }
            styles={{ body: { display: 'flex', justifyContent: 'center' } }}
          >
            <img
              src={resultUrl}
              alt="处理后"
              style={{
                maxWidth: '100%',
                maxHeight: 360,
                objectFit: 'contain',
                ...CHECKER_BOARD,
              }}
            />
          </Card>
        </Col>
      </Row>

      <Descriptions
        title="处理统计"
        column={{ xs: 2, md: 4 }}
        style={{ marginTop: 16 }}
        items={[
          { key: 'total', label: '总像素数', children: stats.total.toLocaleString() },
          { key: 'transparent', label: '完全透明像素', children: stats.transparentCount.toLocaleString() },
          {
            key: 'modified',
            label: '被修改像素（半透明→不透明）',
            children: <Text type={stats.modifiedCount > 0 ? 'warning' : 'success'}>{stats.modifiedCount.toLocaleString()}</Text>,
          },
          { key: 'opaque', label: '完全不透明像素', children: stats.opaqueCount.toLocaleString() },
        ]}
      />

      <Space style={{ marginTop: 16 }}>
        <Button type="primary" icon={<DownloadOutlined />} onClick={onDownload}>
          下载处理结果
        </Button>
        <Button icon={<ReloadOutlined />} onClick={onReset}>
          重新上传
        </Button>
        <Text type="secondary">
          输出文件名：{fileName}（{blob.size > 1024 * 1024 ? `${(blob.size / 1024 / 1024).toFixed(2)} MB` : `${(blob.size / 1024).toFixed(1)} KB`}）
        </Text>
      </Space>
    </div>
  );
}
