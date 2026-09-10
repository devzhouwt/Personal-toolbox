import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DownloadOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import JSZip from 'jszip';
import {
  getToolHistory,
  isGiteeConfigured,
  recordToolUsage,
  HISTORY_RECORD_LIMIT,
} from '../../services/history';
import {
  deleteRepoFile,
  getGiteeConfig,
  readRepoFileBinary,
  writeRepoFile,
} from '../../services/gitee';

const { Dragger } = Upload;
const { Paragraph, Text } = Typography;

/** 工具存档目录名（对应 Gitee 仓库 history/ 下的子目录） */
const TOOL_ID = 'png-alpha-normalize';

/** 云端单文件上限内（约 1MB，留余量）的结果图才会随记录存档 */
const MAX_RESULT_IMAGE_BYTES = 900 * 1024;

/** 处理结果图在仓库中的独立目录 */
const RESULTS_DIR = `history/${TOOL_ID}/results`;

/** 历史写入串行队列（模块级）：连续处理时避免 history.json 读-改-写互相覆盖 */
let historyWriteChain = Promise.resolve();

/** 批量处理支持的图片格式 */
const IMAGE_FILE_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;

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
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [downloadingPath, setDownloadingPath] = useState(null); // 正在下载结果图的云端路径
  const [batchRunning, setBatchRunning] = useState(false);

  /** 从 Gitee 仓库加载本工具的历史记录（未配置或首次使用时不报错） */
  async function loadHistory() {
    if (!isGiteeConfigured()) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await getToolHistory(TOOL_ID);
      setHistoryRecords(data?.records ?? []);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  /**
   * 保存一次使用记录（串行队列，防止连续处理互相覆盖 history.json）。
   * 单张处理的结果图（不超过云端单文件上限）同步上传到 Gitee 独立目录；
   * 云端记录达到 20 条上限时，被挤出的最旧记录若带结果图会一并清理仓库文件。
   */
  function saveHistory(entry, imageBlob) {
    const config = getGiteeConfig();
    if (!config) return Promise.resolve();
    historyWriteChain = historyWriteChain.then(async () => {
      // 先读当前云端记录：用于判断本次写入后是否有旧记录（及其结果图）被挤出
      let before = null;
      try {
        before = await getToolHistory(TOOL_ID);
      } catch {
        before = null;
      }

      let resultImage = null;
      let imageNote = null;
      if (imageBlob) {
        if (imageBlob.size > MAX_RESULT_IMAGE_BYTES) {
          imageNote = `结果图 ${(imageBlob.size / 1024).toFixed(0)} KB 超过云端单文件上限（${MAX_RESULT_IMAGE_BYTES / 1024} KB），仅保存了记录`;
        } else {
          try {
            const bytes = new Uint8Array(await imageBlob.arrayBuffer());
            const fileName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`;
            const path = `${RESULTS_DIR}/${fileName}`;
            await writeRepoFile(config.owner, config.repo, config.token, path, bytes, config.branch, '保存 PNG 归一化结果图');
            resultImage = { path, size: imageBlob.size };
          } catch (err) {
            imageNote = `结果图上传失败：${err.message}，仅保存了记录`;
          }
        }
      }

      const ret = await recordToolUsage(TOOL_ID, { ...entry, resultImage, imageNote });
      if (ret.recorded) {
        if (before?.records?.length >= HISTORY_RECORD_LIMIT) {
          const droppedPath = before.records[before.records.length - 1]?.resultImage?.path;
          if (droppedPath) {
            try {
              await deleteRepoFile(config.owner, config.repo, config.token, droppedPath, config.branch, '清理超出 20 条上限的旧处理结果图');
            } catch {
              // 清理失败仅残留仓库文件，不影响后续记录
            }
          }
        }
        loadHistory();
      }
    });
    // 链上补错：提示用户并恢复链条，不阻断后续写入
    historyWriteChain = historyWriteChain.then(
      () => undefined,
      (err) => {
        messageApi.warning(`历史记录保存失败：${err.message}`);
      }
    );
    return historyWriteChain;
  }

  /** 从 Gitee 仓库读取某条历史记录对应的处理结果图并触发下载 */
  async function handleDownloadResult(record) {
    const config = getGiteeConfig();
    const path = record?.resultImage?.path;
    if (!config || !path) return;
    setDownloadingPath(path);
    try {
      const file = await readRepoFileBinary(config.owner, config.repo, config.token, path, config.branch);
      if (!file) {
        messageApi.warning('云端结果图不存在（可能已被清理），仅剩文字记录');
        return;
      }
      const blob = new Blob([file.bytes], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = record.resultName ?? `${record.fileName ?? 'result'}_normalized.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      messageApi.error(`结果图下载失败：${err.message}`);
    } finally {
      setDownloadingPath(null);
    }
  }

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

      // 后台保存使用记录与结果图（串行队列），不阻塞结果展示
      saveHistory(
        {
          fileName: file.name,
          resultName: `${baseName}_normalized.png`,
          width: stats.width,
          height: stats.height,
          total: stats.total,
          modifiedCount: stats.modifiedCount,
          transparentCount: stats.transparentCount,
          opaqueCount: stats.opaqueCount,
        },
        blob
      );
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
        disabled={processing || batchRunning}
        style={{ padding: '8px 0' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">点击或拖拽 PNG 图片到此处上传</p>
        <p className="ant-upload-hint">
          支持单张图片。处理在本地浏览器中进行；配置了 Gitee 仓库后，结果图与使用记录会自动同步到你的仓库（保留最近 20 次，可随时重新下载）
        </p>
      </Dragger>
    ),
    [processing, batchRunning]
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

      <BatchProcessor
        disabled={processing}
        onRunningChange={setBatchRunning}
        onBatchDone={(summary) =>
          saveHistory({
            fileName: `批量处理（${summary.done} 张图片）`,
            batchCount: summary.done,
            modifiedCount: summary.modified,
          })
        }
      />

      <Divider />
      <HistoryPanel
        records={historyRecords}
        loading={historyLoading}
        error={historyError}
        downloadingPath={downloadingPath}
        onDownload={handleDownloadResult}
      />
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

      <Space style={{ marginTop: 16 }} wrap>
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

/** 历史记录面板：展示该工具在 Gitee 仓库中的使用记录，单张处理结果图可重新下载 */
function HistoryPanel({ records, loading, error, downloadingPath, onDownload }) {
  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        <HistoryOutlined /> 历史记录
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
          自动保存至 Gitee 仓库，保留最近 20 次；单张处理结果图可重新下载
        </Text>
      </Typography.Title>
      {!isGiteeConfigured() ? (
        <Alert
          type="info"
          showIcon
          message="尚未配置 Gitee 仓库"
          description="配置后，每次单张处理的结果图与使用记录会自动保存到你的 Gitee 仓库（history/png-alpha-normalize/ 下按文件存放，保留最近 20 次），在历史记录中可随时重新下载结果图。点击右上角「Gitee 配置」开启。"
        />
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message="历史记录加载失败" description={error} />
      ) : records.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无使用记录" />
      ) : (
        <List
          size="small"
          dataSource={records}
          renderItem={(item) => (
            <List.Item
              actions={
                item.resultImage
                  ? [
                      <Button
                        key="download"
                        type="link"
                        size="small"
                        icon={<DownloadOutlined />}
                        loading={downloadingPath === item.resultImage.path}
                        onClick={() => onDownload(item)}
                      >
                        下载结果图
                      </Button>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                title={item.fileName}
                description={
                  <>
                    <div>
                      {item.batchCount
                        ? `${formatTime(item.time)} ｜ 批量处理 ${item.batchCount} 张图片`
                        : `${formatTime(item.time)} ｜ ${item.width}×${item.height} ｜ 修改 ${(item.modifiedCount ?? 0).toLocaleString()} 像素`}
                    </div>
                    {item.imageNote && (
                      <Text type="warning" style={{ fontSize: 12 }}>
                        {item.imageNote}
                      </Text>
                    )}
                  </>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}

/** ISO 时间字符串 → 本地时间文本 */
function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

/**
 * 批量处理器：选择文件夹，一次性处理目录（含子目录）下所有图片，打包 ZIP 下载。
 * 每项状态：pending → processing → done / error，非图片文件标记 skipped。
 */
function BatchProcessor({ disabled, onRunningChange, onBatchDone }) {
  const folderInputRef = useRef(null);
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState([]); // { path, name, status, blob, zipPath, modifiedCount, error }
  const [running, setRunning] = useState(false);
  const [zipUrl, setZipUrl] = useState(null);

  const doneCount = items.filter((i) => i.status === 'done').length;
  const failedCount = items.filter((i) => i.status === 'error').length;
  const skippedCount = items.filter((i) => i.status === 'skipped').length;
  const total = items.length;
  const finished = doneCount + failedCount + skippedCount;
  const percent = total ? Math.round((finished / total) * 100) : 0;

  /** 选择文件夹后开始批量处理 */
  async function handleFolderChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // 允许重复选择同一文件夹
    if (!files.length) return;

    const initItems = files.map((f) => {
      const path = f.webkitRelativePath || f.name;
      return {
        path,
        name: f.name,
        zipPath: toZipPath(path),
        status: IMAGE_FILE_RE.test(f.name) ? 'pending' : 'skipped',
        blob: null,
        modifiedCount: 0,
        error: null,
      };
    });
    setItems(initItems);
    setZipUrl(null);
    setRunning(true);
    onRunningChange?.(true);

    const skipped = initItems.filter((i) => i.status === 'skipped').length;
    messageApi.info(`共选择 ${files.length} 个文件，其中图片 ${files.length - skipped} 个，开始处理…`);

    let success = 0;
    let modifiedTotal = 0;
    const pendingIndexes = initItems
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => item.status === 'pending');

    for (const { idx } of pendingIndexes) {
      const file = files[idx];
      setItems((prev) => prev.map((p, i) => (i === idx ? { ...p, status: 'processing' } : p)));
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('图片加载失败'));
          img.src = url;
        });
        const { blob, stats } = await normalizeAlpha(img);
        URL.revokeObjectURL(url);
        success += 1;
        modifiedTotal += stats.modifiedCount;
        setItems((prev) =>
          prev.map((p, i) =>
            i === idx ? { ...p, status: 'done', blob, modifiedCount: stats.modifiedCount } : p
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((p, i) => (i === idx ? { ...p, status: 'error', error: err.message } : p))
        );
      }
    }

    setRunning(false);
    onRunningChange?.(false);
    if (success > 0) {
      messageApi.success(`批量处理完成：成功 ${success} 个`);
      onBatchDone?.({ done: success, modified: modifiedTotal });
    } else {
      messageApi.warning('没有图片处理成功，请检查所选文件夹');
    }
  }

  /** 打包所有成功结果并触发下载 */
  async function handleDownloadZip() {
    const doneItems = items.filter((i) => i.status === 'done');
    if (!doneItems.length) return;
    if (!zipUrl) {
      const zip = new JSZip();
      doneItems.forEach((item) => zip.file(item.zipPath, item.blob));
      const blob = await zip.generateAsync({ type: 'blob' });
      setZipUrl(URL.createObjectURL(blob));
    }
    triggerDownload(zipUrl, 'processed_images.zip');
  }

  function triggerDownload(url, name) {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
  }

  return (
    <div style={{ marginTop: 16 }}>
      {contextHolder}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        directory=""
        webkitdirectory=""
        style={{ display: 'none' }}
        onChange={handleFolderChange}
      />
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button
          icon={<FolderOpenOutlined />}
          disabled={disabled || running}
          onClick={() => folderInputRef.current?.click()}
          block
        >
          选择文件夹批量处理
        </Button>
        <Text type="secondary" style={{ fontSize: 12, textAlign: 'center', display: 'block' }}>
          支持 png / jpg / jpeg / webp / bmp / gif，自动处理所选文件夹（含子目录）内的全部图片，结果打包为 ZIP 一键下载
        </Text>
        {items.length > 0 && (
          <Card size="small" styles={{ body: { padding: 12 } }}>
            <Progress percent={percent} status={running ? 'active' : finished === total ? 'success' : 'active'} />
            <List
              size="small"
              style={{ maxHeight: 300, overflowY: 'auto' }}
              dataSource={items}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    item.status === 'pending' ? (
                      <Tag key="s">等待中</Tag>
                    ) : item.status === 'processing' ? (
                      <Tag key="s" color="processing">
                        处理中
                      </Tag>
                    ) : item.status === 'done' ? (
                      <Tag key="s" color="success">
                        完成
                      </Tag>
                    ) : item.status === 'skipped' ? (
                      <Tag key="s">已跳过</Tag>
                    ) : (
                      <Tag key="s" color="error">
                        失败
                      </Tag>
                    ),
                  ]}
                >
                  <List.Item.Meta
                    title={item.path}
                    description={
                      item.status === 'error'
                        ? item.error
                        : item.status === 'done'
                          ? `修改 ${item.modifiedCount.toLocaleString()} 像素`
                          : item.status === 'skipped'
                            ? '非图片文件'
                            : undefined
                    }
                  />
                </List.Item>
              )}
            />
            {!running && doneCount > 0 && (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={handleDownloadZip}
                style={{ marginTop: 8 }}
              >
                下载全部（ZIP，{doneCount} 个文件）
              </Button>
            )}
          </Card>
        )}
      </Space>
    </div>
  );
}

/** 输出路径：保留相对目录，文件名追加 _normalized.png */
function toZipPath(path) {
  const parts = path.split('/');
  const fileName = parts.pop();
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return [...parts, `${base}_normalized.png`].join('/');
}
