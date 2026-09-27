import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Space,
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
  PlusOutlined,
  SyncOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { parseImported } from './storage';
import { formatYMD } from './cycleAlgo';

const { Paragraph, Text } = Typography;

/**
 * 日历列表视图：新建/进入/重命名/删除日历，以及存档导出/导入。
 */
export default function CalendarList({
  calendars,
  syncState,
  onCreate,
  onRename,
  onDelete,
  onOpen,
  onImport,
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

  /** 提交新建/重命名（重命名模式不含类型字段） */
  async function submitName() {
    const { name, type } = await form.validateFields();
    const trimmed = name.trim();
    if (nameModal.mode === 'create') {
      // 创建后立即跳转详情页、本组件随之卸载，成功提示改由父级常驻 context 展示
      await onCreate(trimmed, type);
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
        新建日历并持续记录周期性事件：添加事件时可选「预测类事件」（按历史数据用
        <Text strong>加权滑动平均</Text>推算周期并预测下次日期）或「规则类事件」
        （固定间隔自动标记后续日期，适合值班等固定排班，换班后记录实际日期即自动重算）。
        新建日历可选「普通日历」（按自然日推算）或「节假日日历」（按工作日推算，自动跳过周末与法定节假日、
        识别调休日并标注节假日信息）。日历存档保存在你配置的 Gitee 仓库中（history/cycle-tracker/data.json，
        进入本工具时自动读取），浏览器本地同时保留缓存。
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
                    {calendar.type === 'holiday' && <Tag color="red">节假日日历</Tag>}
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
          {nameModal?.mode === 'create' && (
            <Form.Item
              name="type"
              label="日历类型"
              initialValue="normal"
              rules={[{ required: true, message: '请选择日历类型' }]}
              extra="普通日历按自然日推算；节假日日历按工作日推算（自动跳过周末与法定节假日、识别调休日），并标注节假日信息。"
            >
              <Radio.Group>
                <Radio value="normal">普通日历</Radio>
                <Radio value="holiday">节假日日历</Radio>
              </Radio.Group>
            </Form.Item>
          )}
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
