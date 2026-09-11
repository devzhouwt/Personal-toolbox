import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Popconfirm,
  Progress,
  Row,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  fmtDateTime,
  fmtMoney,
  itemLabel,
  itemStats,
  maxRepaymentCents,
  repaymentRows,
  statusTagInfo,
  todayKey,
} from './loanCore';
import LoanItemModal from './LoanItemModal';
import RepaymentModal from './RepaymentModal';

const { Text } = Typography;

/**
 * 事项进展提示：未结清时提示剩余/逾期情况；已结清时展示结清日期与结清时的最终逾期天数
 * （正 = 逾期 N 天结清，负 = 提前 N 天结清）。
 */
function StatusAlert({ stats, dueDate }) {
  if (stats.settled) {
    const parts = [];
    if (stats.settleDate) parts.push(`结清日期：${stats.settleDate}`);
    if (stats.settleOverdueDays !== null) {
      if (stats.settleOverdueDays > 0) parts.push(`最终逾期 ${stats.settleOverdueDays} 天结清`);
      else if (stats.settleOverdueDays < 0) parts.push(`按期结清（提前 ${-stats.settleOverdueDays} 天）`);
      else parts.push('按期结清（未逾期）');
    }
    return (
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 16 }}
        message="该借贷事项已结清"
        description={parts.length > 0 ? parts.join('；') : undefined}
      />
    );
  }
  const remaining = `尚余 ¥${fmtMoney(stats.remainingCents / 100)} 未还`;
  if (stats.overdueDays > 0) {
    return (
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message={`已逾期 ${stats.overdueDays} 天`}
        description={`还款日期为 ${dueDate}，${remaining}。`}
      />
    );
  }
  if (stats.dueInDays === 0) {
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="今天到期"
        description={`今天为约定还款日期，${remaining}。`}
      />
    );
  }
  if (stats.dueInDays !== null) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={`距离还款日期还有 ${stats.dueInDays} 天`}
        description={`约定还款日期为 ${dueDate}，${remaining}。`}
      />
    );
  }
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="未设置还款日期"
      description={`该事项没有约定还款日期，不做逾期提示；${remaining}。`}
    />
  );
}

/**
 * 借贷事项详情视图：基本信息与进展（金额/进度/逾期/结清信息）、
 * 还款记录表（还款日期、还款金额、支付方式、该笔还款后的剩余金额）与还款的增改删操作。
 */
export default function LoanDetailView({
  item,
  onBack,
  onUpdate,
  onDelete,
  onAddRepayment,
  onUpdateRepayment,
  onDeleteRepayment,
}) {
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [repayModal, setRepayModal] = useState(null); // null | { repayment: null | 还款记录 }

  const today = todayKey();
  const stats = useMemo(() => itemStats(item, today), [item, today]);
  const rows = useMemo(() => repaymentRows(item), [item]);
  const tag = statusTagInfo(stats);

  // 当前弹窗的金额上限：新增 = 剩余未还；编辑 = 剩余未还 + 该笔原金额
  const repayMaxCents = repayModal ? maxRepaymentCents(item, repayModal.repayment?.id) : 0;

  const columns = [
    { title: '还款日期', dataIndex: 'date' },
    {
      title: '还款金额',
      dataIndex: 'amount',
      align: 'right',
      render: (value) => `¥${fmtMoney(value)}`,
    },
    {
      title: '支付方式',
      dataIndex: 'paymentMethod',
      render: (value) => value || '未填写',
    },
    {
      title: '剩余金额',
      dataIndex: 'remainingCents',
      align: 'right',
      render: (value) => `¥${fmtMoney(value / 100)}`,
    },
    {
      title: '操作',
      key: 'action',
      align: 'right',
      width: 130,
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => setRepayModal({ repayment: row })}>
            编辑
          </Button>
          <Popconfirm
            title="删除还款记录"
            description={`删除 ${row.date} 的还款 ¥${fmtMoney(row.amount)}？删除后各项金额将重新计算。`}
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => onDeleteRepayment(item.id, row.id)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const addRepaymentButton = (
    <Button
      type="primary"
      icon={<PlusOutlined />}
      disabled={stats.settled}
      onClick={() => setRepayModal({ repayment: null })}
    >
      记录还款
    </Button>
  );

  return (
    <div>
      <Row justify="space-between" align="middle" gutter={[8, 12]} style={{ marginBottom: 16 }}>
        <Col>
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
              返回列表
            </Button>
            <Text strong style={{ fontSize: 16 }}>
              {itemLabel(item)}
            </Text>
            <Tag color={tag.color} style={{ marginInlineEnd: 0 }}>
              {tag.text}
            </Tag>
          </Space>
        </Col>
        <Col>
          <Space wrap>
            <Button icon={<EditOutlined />} onClick={() => setItemModalOpen(true)}>
              编辑事项
            </Button>
            <Popconfirm
              title="删除借贷事项"
              description={`确定删除「${itemLabel(item)}」？其 ${item.repayments.length} 笔还款记录将一并删除，且不可恢复。`}
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={onDelete}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除事项
              </Button>
            </Popconfirm>
          </Space>
        </Col>
      </Row>

      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              总金额
            </Text>
            <div style={{ fontSize: 22, fontWeight: 600 }}>¥{fmtMoney(item.amount)}</div>
          </Col>
          <Col xs={12} sm={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              已还金额
            </Text>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: stats.repaidCents > 0 ? '#52c41a' : undefined,
              }}
            >
              ¥{fmtMoney(stats.repaidCents / 100)}
            </div>
          </Col>
          <Col xs={24} sm={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              剩余未还
            </Text>
            <div
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: stats.settled ? '#52c41a' : '#fa541c',
              }}
            >
              ¥{fmtMoney(stats.remainingCents / 100)}
            </div>
          </Col>
        </Row>
        <Progress
          percent={stats.percent}
          strokeColor={stats.settled ? '#52c41a' : stats.overdueDays > 0 ? '#ff4d4f' : '#1677ff'}
          style={{ marginTop: 12 }}
        />
        <Descriptions
          column={{ xs: 1, sm: 2 }}
          size="small"
          style={{ marginTop: 8 }}
          items={[
            { key: 'lender', label: '出借人', children: item.lender || '—' },
            { key: 'borrower', label: '借款人', children: item.borrower || '—' },
            { key: 'loanDate', label: '出借日期', children: item.loanDate ?? '未填写' },
            { key: 'paymentMethod', label: '支付方式', children: item.paymentMethod || '未填写' },
            { key: 'dueDate', label: '还款日期', children: item.dueDate ?? '未设置' },
            { key: 'createdAt', label: '创建时间', children: fmtDateTime(item.createdAt) },
            { key: 'updatedAt', label: '最近更新', children: fmtDateTime(item.updatedAt) },
            {
              key: 'id',
              label: '事项编号',
              children: (
                <Text type="secondary" copyable style={{ fontSize: 12 }}>
                  {item.id}
                </Text>
              ),
            },
          ]}
        />
      </Card>

      <StatusAlert stats={stats} dueDate={item.dueDate} />

      <Card
        title={`还款记录（${item.repayments.length} 笔）`}
        extra={
          stats.settled ? (
            <Tooltip title="已结清，无需再记录还款">
              <span>{addRepaymentButton}</span>
            </Tooltip>
          ) : (
            addRepaymentButton
          )
        }
      >
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '还没有还款记录' }}
        />
      </Card>

      <LoanItemModal
        open={itemModalOpen}
        item={item}
        onCancel={() => setItemModalOpen(false)}
        onSubmit={(values) => {
          onUpdate(values);
          setItemModalOpen(false);
        }}
      />
      <RepaymentModal
        open={Boolean(repayModal)}
        repayment={repayModal?.repayment ?? null}
        maxCents={repayMaxCents}
        onCancel={() => setRepayModal(null)}
        onSubmit={(values) => {
          if (repayModal.repayment) onUpdateRepayment(item.id, repayModal.repayment.id, values);
          else onAddRepayment(item.id, values);
          setRepayModal(null);
        }}
      />
    </div>
  );
}
