import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CalendarOutlined,
  CloudOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HistoryOutlined,
  PlusOutlined,
  SyncOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { parseImported } from './storage';
import { isGiteeConfigured } from '../../services/history';
import { formatYMD } from './cycleAlgo';

const { Paragraph, Text } = Typography;

/**
 * 日历列表视图：新建/进入/重命名/删除日历，以及存档导出/导入与使用历史。
 */
export default function CalendarList({
  calendars,
  syncState,
  onCreate,
  onRename,
  onDelete,
  onOpen,
  onImport,
  historyRecords,
  historyLoading,
  historyError,
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [nameModal, setNameModal] = useState(null); // { mode: 'create' } | { mode: 'rename', id, name }
  const [form] = Form.useForm();
  const fileInputRef = useRef(null);

  /** 打开新建日历弹窗 */
  function openCreate() {
    setNameModal({ mode: 'create' });
  }

  /** 打开重命名弹窗 */
  function openRename(calendar) {
    setNameModal({ mode: 'rename', id: calendar.id, name: calendar.name });
  }

  /** 弹窗挂载后按模式初始化表单（Modal 渲染前调用 form 方法会触发 useForm 未连接警告） */
  useEffect(() => {
    if (!nameModal) return;
    if (nameModal.mode === 'rename') {
      form.setFieldsValue({ name: nameModal.name });
    } else {
      form.resetFields();
    }
  }, [nameModal, form]);

  /** 提交新建/重命名 */
  async function submitName() {
    const { name } = await form.validateFields();
    const trimmed = name.trim();
    if (nameModal.mode === 'create') {
      // 创建后立即跳转详情页、本组件随之卸载，成功提示改由父级常驻 context 展示
      await onCreate(trimmed);
    } else {
      await onRename(nameModal.id, trimmed);
      messageApi.success(`已重命名为「${trimmed}」`);
    }
    setNameModal(null);
  }

  /** 删除日历（成功提示由父级 CycleTracker 的常驻 context 展示） */
  async function remove(calendar) {
    await onDelete(calendar.id);
  }

  /** 导出全部存档为 JSON 文件 */
  function handleExport() {
    const calendarsExport = calendars.map((c) => ({
      ...c,
      events: c.events,
      records: c.records,
    }));
    const blob = new Blob(
      [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), calendars: calendarsExport }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `周期记录备份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    messageApi.success('存档已导出');
  }

  /** 读取导入文件内容（含结构校验） */
  function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseImported(String(reader.result));
        if (!parsed.length) {
          messageApi.warning('导入文件中没有任何日历数据');
          return;
        }
        Modal.confirm({
          title: '导入存档',
          content: (
            <span>
              将导入 <Text strong>{parsed.length}</Text> 个日历，
              <Text type="danger">覆盖</Text>当前浏览器中的全部数据。建议先「导出存档」备份。
            </span>
          ),
          okText: '确认导入',
          okButtonProps: { danger: true },
          onOk: async () => {
            await onImport(parsed);
            messageApi.success(`已导入 ${parsed.length} 个日历`);
          },
        });
      } catch (err) {
        messageApi.error(`导入失败：${err.message}`);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  return (
    <div>
      {contextHolder}
      <Paragraph type="secondary" style={{ marginBottom: 16 }}>
        新建日历并持续记录周期性事件（如生理期、运动打卡），系统会根据你的历史数据用
        <Text strong>加权滑动平均</Text>自动推算真实周期，并在日历中预测下一次发生的日期。
        日历存档保存在你配置的 Gitee 仓库中（history/cycle-tracker/data.json，进入本工具时自动读取），浏览器本地同时保留缓存。
      </Paragraph>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <Row justify="space-between" align="middle" gutter={[8, 12]} style={{ marginBottom: 16 }}>
        <Col>
          <Space wrap>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={openCreate}
              disabled={calendars.length >= 20}
            >
              新建日历
            </Button>
            {calendars.length >= 20 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                最多 20 个日历，可删除不再使用的日历
              </Text>
            )}
          </Space>
        </Col>
        <Col>
          <Space wrap>
            <SyncTag state={syncState} />
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出存档
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
              导入存档
            </Button>
          </Space>
        </Col>
      </Row>

      {calendars.length === 0 ? (
        <Empty description="还没有日历，点击「新建日历」开始记录" style={{ padding: '48px 0' }} />
      ) : (
        <Row gutter={[16, 16]}>
          {calendars.map((calendar) => {
            const eventCount = calendar.events.length;
            const recordCount = calendar.records.length;
            return (
              <Col xs={24} sm={12} xl={8} key={calendar.id}>
                <Card
                  hoverable
                  onClick={() => onOpen(calendar.id)}
                  actions={[
                    <span key="rename" onClick={(e) => e.stopPropagation()}>
                      <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openRename(calendar)}>
                        重命名
                      </Button>
                    </span>,
                    <span key="delete" onClick={(e) => e.stopPropagation()}>
                      <Popconfirm
                        title="删除日历"
                        description={`确定删除「${calendar.name}」？其全部事件与记录将一并删除，且不可恢复。`}
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove(calendar)}
                      >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </span>,
                  ]}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: '#fff1f0',
                        color: '#fa541c',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      <CalendarOutlined />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text strong style={{ fontSize: 15 }} ellipsis>
                        {calendar.name}
                      </Typography.Text>
                    </div>
                  </div>
                  <Space size={[0, 8]} wrap>
                    <Tag>{eventCount} 个事件</Tag>
                    <Tag>{recordCount} 条记录</Tag>
                  </Space>
                  <div style={{ marginTop: 6 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      创建于 {formatYMD(calendar.createdAt.slice(0, 10))}
                    </Text>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <Divider />
      <HistoryPanel records={historyRecords} loading={historyLoading} error={historyError} />

      <Modal
        title={nameModal?.mode === 'create' ? '新建日历' : '重命名日历'}
        open={Boolean(nameModal)}
        onOk={submitName}
        onCancel={() => setNameModal(null)}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="name"
            label="日历名称"
            rules={[
              { required: true, message: '请输入日历名称' },
              { max: 20, message: '名称不能超过 20 个字' },
            ]}
          >
            <Input placeholder="如：生理期记录" maxLength={20} autoFocus allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 存档同步状态标签（仅本地 / 同步中 / 已同步 / 同步失败待重试 / 云端不可用降级） */
function SyncTag({ state }) {
  if (state === 'ok') {
    return (
      <Tag color="success" icon={<CloudServerOutlined />} style={{ marginInlineEnd: 0 }}>
        存档已同步 Gitee
      </Tag>
    );
  }
  if (state === 'syncing') {
    return (
      <Tag color="processing" icon={<SyncOutlined spin />} style={{ marginInlineEnd: 0 }}>
        同步中…
      </Tag>
    );
  }
  if (state === 'writeError') {
    return (
      <Tooltip title="最近一次同步到 Gitee 失败，修改已保留在本地；下次修改存档时会自动重试，成功后自动恢复「已同步」状态。">
        <Tag color="warning" icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>
          同步失败·待重试
        </Tag>
      </Tooltip>
    );
  }
  if (state === 'error') {
    return (
      <Tooltip title="Gitee 仓库不可用（读取或同步失败），本次进入已改用浏览器本地存档，修改仅保存在本地。请检查右上角「Gitee 配置」后重新进入本工具恢复云端同步。">
        <Tag color="error" icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>
          云端不可用·仅本地存档
        </Tag>
      </Tooltip>
    );
  }
  return (
    <Tooltip title="尚未配置 Gitee 仓库，日历存档仅保存在本地浏览器。配置后，每次进入本工具都会自动从 Gitee 读取存档并同步修改。">
      <Tag color="warning" icon={<CloudOutlined />} style={{ marginInlineEnd: 0 }}>
        仅本地存档
      </Tag>
    </Tooltip>
  );
}

/** 历史记录面板：展示该工具在 Gitee 仓库中的操作记录 */
function HistoryPanel({ records, loading, error }) {
  return (
    <div>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        <HistoryOutlined /> 使用记录
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
          自动保存至 Gitee 仓库，保留最近 20 次
        </Text>
      </Typography.Title>
      {!isGiteeConfigured() ? (
        <Alert
          type="info"
          showIcon
          message="尚未配置 Gitee 仓库"
          description="配置后，新建日历、添加事件、记录日期等关键操作将自动保存到指定仓库（history/ 目录下按工具分文件夹，保留最近 20 次）。点击右上角「Gitee 配置」开启。"
        />
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <Spin />
        </div>
      ) : error ? (
        <Alert type="error" showIcon message="使用记录加载失败" description={error} />
      ) : records.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无使用记录" />
      ) : (
        <List
          size="small"
          dataSource={records}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={`${formatTime(item.time)}｜${item.action}「${item.title ?? ''}」`}
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
