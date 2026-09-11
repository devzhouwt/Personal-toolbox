import { useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  AccountBookOutlined,
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
import { isGiteeConfigured } from '../../services/history';
import {
  fmtMoney,
  itemLabel,
  itemStats,
  sortItemsForDisplay,
  statusTagInfo,
  todayKey,
} from './loanCore';
import { parseImportedFile } from './loanStorage';
import LoanItemModal from './LoanItemModal';

const { Paragraph, Text } = Typography;

/**
 * 借贷事项列表视图（工具主页）：事项卡片网格，展示出借人/借款人、金额与还款进度、
 * 逾期天数与结清状态；支持新建/编辑/删除事项，以及账簿导出/导入。
 * 排序：未结清在前（有还款日期的按到期先后，越紧急越靠前），已结清在后（最近结清的在前）。
 */
export default function LoanListView({
  items,
  syncState,
  onCreate,
  onUpdate,
  onDelete,
  onOpen,
  onImport,
}) {
  const [messageApi, contextHolder] = message.useMessage();
  const [itemModal, setItemModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', item }
  const fileInputRef = useRef(null);

  const today = todayKey();
  const sorted = useMemo(() => sortItemsForDisplay(items, today), [items, today]);
  const summary = useMemo(() => {
    let unsettled = 0;
    let remainingCents = 0;
    for (const it of items) {
      const st = itemStats(it, today);
      if (!st.settled) {
        unsettled += 1;
        remainingCents += st.remainingCents;
      }
    }
    return { unsettled, remainingCents };
  }, [items, today]);

  /** 打开新建弹窗 */
  function openCreate() {
    setItemModal({ mode: 'create' });
  }

  /** 打开编辑弹窗 */
  function openEdit(item) {
    setItemModal({ mode: 'edit', item });
  }

  /** 提交新建/编辑（成功提示由入口组件展示） */
  async function submitItem(values) {
    if (itemModal.mode === 'create') {
      await onCreate(values);
    } else {
      await onUpdate(itemModal.item.id, values);
    }
    setItemModal(null);
  }

  /** 导出全部账簿为 JSON 文件 */
  function handleExport() {
    const blob = new Blob(
      [JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `借贷账簿备份-${today}.json`;
    link.click();
    URL.revokeObjectURL(url);
    messageApi.success('账簿已导出');
  }

  /** 读取导入文件内容（含结构校验与二次确认） */
  function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseImportedFile(String(reader.result));
        if (!parsed.length) {
          messageApi.warning('导入文件中没有任何借贷事项');
          return;
        }
        Modal.confirm({
          title: '导入账簿',
          content: (
            <span>
              将导入 <Text strong>{parsed.length}</Text> 条借贷事项，
              <Text type="danger">覆盖</Text>当前浏览器中的全部数据。建议先「导出账簿」备份。
            </span>
          ),
          okText: '确认导入',
          okButtonProps: { danger: true },
          onOk: async () => {
            await onImport(parsed);
            messageApi.success(`已导入 ${parsed.length} 条借贷事项`);
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
        记录每次借贷的出借人、借款人、总金额、出借日期、支付方式（可不填）与还款日期；借款人还款时可分多笔登记，
        系统自动计算剩余未还金额、逾期天数与结清状态。账簿存档保存在你配置的 Gitee 仓库中
        （history/loan-ledger/data.json，进入本工具时自动读取），浏览器本地同时保留缓存。
      </Paragraph>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />

      <Row justify="space-between" align="middle" gutter={[8, 12]} style={{ marginBottom: 8 }}>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建借贷事项
          </Button>
        </Col>
        <Col>
          <Space wrap>
            <SyncTag state={syncState} />
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出账簿
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => fileInputRef.current?.click()}>
              导入账簿
            </Button>
          </Space>
        </Col>
      </Row>

      {items.length > 0 && (
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
          共 {items.length} 笔借贷，未结清 {summary.unsettled} 笔，剩余未还合计{' '}
          <Text strong style={{ fontSize: 12 }}>¥{fmtMoney(summary.remainingCents / 100)}</Text>
        </Paragraph>
      )}

      {sorted.length === 0 ? (
        <Empty description="还没有借贷事项，点击「新建借贷事项」开始记录" style={{ padding: '48px 0' }} />
      ) : (
        <Row gutter={[16, 16]}>
          {sorted.map((item) => {
            const stats = itemStats(item, today);
            const tag = statusTagInfo(stats);
            return (
              <Col xs={24} sm={12} xl={8} key={item.id}>
                <Card
                  hoverable
                  onClick={() => onOpen(item.id)}
                  actions={[
                    <span key="edit" onClick={(e) => e.stopPropagation()}>
                      <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(item)}>
                        编辑
                      </Button>
                    </span>,
                    <span key="delete" onClick={(e) => e.stopPropagation()}>
                      <Popconfirm
                        title="删除借贷事项"
                        description={`确定删除「${itemLabel(item)}」？其 ${item.repayments.length} 笔还款记录将一并删除，且不可恢复。`}
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => onDelete(item.id)}
                      >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                          删除
                        </Button>
                      </Popconfirm>
                    </span>,
                  ]}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: '#e6f4ff',
                        color: '#1677ff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 18,
                        flexShrink: 0,
                      }}
                    >
                      <AccountBookOutlined />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Typography.Text strong style={{ fontSize: 15 }} ellipsis>
                        {itemLabel(item)}
                      </Typography.Text>
                    </div>
                    <Tag color={tag.color} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                      {tag.text}
                    </Tag>
                  </div>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    <Text type="secondary">总金额 </Text>
                    <Text strong>¥{fmtMoney(item.amount)}</Text>
                    <span style={{ margin: '0 6px', color: '#d9d9d9' }}>|</span>
                    <Text type="secondary">已还 </Text>
                    <Text style={{ color: stats.repaidCents > 0 ? '#52c41a' : undefined }}>
                      ¥{fmtMoney(stats.repaidCents / 100)}
                    </Text>
                    <span style={{ margin: '0 6px', color: '#d9d9d9' }}>|</span>
                    <Text type="secondary">剩余 </Text>
                    <Text style={{ color: stats.settled ? '#52c41a' : '#fa541c' }}>
                      ¥{fmtMoney(stats.remainingCents / 100)}
                    </Text>
                  </div>
                  <Progress
                    percent={stats.percent}
                    size="small"
                    showInfo={false}
                    strokeColor={stats.settled ? '#52c41a' : stats.overdueDays > 0 ? '#ff4d4f' : '#1677ff'}
                  />
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      出借日期：{item.loanDate ?? '未填写'}｜还款日期：{item.dueDate ?? '未设置'}
                      {item.paymentMethod ? `｜支付方式：${item.paymentMethod}` : ''}
                    </Text>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <LoanItemModal
        open={Boolean(itemModal)}
        item={itemModal?.mode === 'edit' ? itemModal.item : null}
        onCancel={() => setItemModal(null)}
        onSubmit={submitItem}
      />
    </div>
  );
}

/** 存档同步状态标签（仅本地 / 同步中 / 已同步 / 同步失败待重试 / 云端不可用降级） */
function SyncTag({ state }) {
  if (state === 'ok') {
    return (
      <Tag color="success" icon={<CloudServerOutlined />} style={{ marginInlineEnd: 0 }}>
        账簿已同步 Gitee
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
      <Tooltip title="最近一次同步到 Gitee 失败，修改已保留在本地；下次修改时会自动重试，成功后自动恢复「已同步」状态。">
        <Tag color="warning" icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>
          同步失败·待重试
        </Tag>
      </Tooltip>
    );
  }
  if (state === 'error') {
    return (
      <Tooltip title="Gitee 仓库不可用（读取或同步失败），本次进入已改用浏览器本地账簿，修改仅保存在本地。请检查右上角「Gitee 配置」后重新进入本工具恢复云端同步。">
        <Tag color="error" icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>
          云端不可用·仅本地存档
        </Tag>
      </Tooltip>
    );
  }
  return (
    <Tooltip title="尚未配置 Gitee 仓库，账簿仅保存在本地浏览器。配置后，每次进入本工具都会自动从 Gitee 读取存档并同步修改。">
      <Tag color="warning" icon={<CloudOutlined />} style={{ marginInlineEnd: 0 }}>
        仅本地存档
      </Tag>
    </Tooltip>
  );
}
