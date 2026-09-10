import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Button,
  Calendar,
  Card,
  Checkbox,
  Col,
  ColorPicker,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { genId } from './storage';
import {
  buildAnalyses,
  formatMD,
  formatYMD,
  todayKey,
  weekLabel,
} from './cycleAlgo';

const { Paragraph, Text } = Typography;

/** 事件创建/编辑时可选的预设颜色（antd 色板常用色） */
const COLOR_PRESETS = [
  '#1677ff',
  '#2f54eb',
  '#722ed1',
  '#eb2f96',
  '#f759ab',
  '#f5222d',
  '#fa541c',
  '#fa8c16',
  '#faad14',
  '#52c41a',
  '#13c2c2',
  '#531dab',
];

/** 日历单元格内容高度（antd 全屏日历的日期格按内容高度撑开） */
const CELL_HEIGHT = 88;

/** 事件卡片底色与主题色一致，柔和展示 */
function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value);
}

/** 兼容历史存档中的 rgb()/rgba() 颜色：任意 CSS 颜色 → hex；无法解析返回 null */
function toHexColor(value) {
  if (isHexColor(value)) return value;
  if (typeof value !== 'string') return null;
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/.exec(value.trim());
  if (!m) return null;
  return `#${m
    .slice(1)
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** hex 颜色 → rgba 字符串（用于预测日期的半透明斜纹） */
function withAlpha(hex, alpha) {
  if (!isHexColor(hex)) return `rgba(128, 128, 128, ${alpha})`;
  const clean = hex.slice(1);
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 日历详情视图：左侧为事件图例与事件管理，右侧为记录/预测月历。
 */
export default function CalendarDetail({ calendar, onBack, onPatch, onDelete, onUsage }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [viewDate, setViewDate] = useState(dayjs()); // 当前显示月/选中日期
  const [eventModal, setEventModal] = useState(null); // null | { event? }（编辑时传入事件）
  const [dayModalKey, setDayModalKey] = useState(null); // 正在编辑记录的日期 key
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameForm] = Form.useForm();

  /** 重命名弹窗打开后回填当前名称（Modal 首次渲染前调用 form 会触发 useForm 未连接警告） */
  useEffect(() => {
    if (!renameOpen) return;
    renameForm.setFieldsValue({ name: calendar.name });
  }, [renameOpen, renameForm, calendar.name]);

  const { events, records } = calendar;

  // 事件推算结果（周期、预测日期等）与预测日期索引
  const { analyses, predictedByDate } = useMemo(
    () => buildAnalyses(events, records),
    [events, records]
  );
  const eventMap = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events]);

  // 已记录日期索引：dateKey → eventId[]
  const actualByDate = useMemo(() => {
    const map = {};
    records.forEach((r) => {
      (map[r.date] ||= []).push(r.eventId);
    });
    return map;
  }, [records]);

  /** 打开「记录事件」弹窗（点击日期格子触发） */
  function openDayRecord(key) {
    setDayModalKey(key);
  }

  /** 保存某天勾选的事件（对比当天原记录，计算新增/移除） */
  function saveDayRecords(key, selectedIds) {
    const prevIds = new Set(actualByDate[key] ?? []);
    const next = new Set(selectedIds);
    let nextRecords = records;
    // 移除被取消的事件
    if (prevIds.size > 0) {
      nextRecords = records.filter((r) => !(r.date === key && prevIds.has(r.eventId) && !next.has(r.eventId)));
    }
    // 追加新勾选的事件
    next.forEach((id) => {
      if (!prevIds.has(id)) {
        nextRecords = [...nextRecords, { date: key, eventId: id }];
      }
    });
    onPatch(calendar.id, { records: nextRecords });
    const names = [...next].map((id) => eventMap[id]?.name ?? '').filter(Boolean);
    messageApi.success(
      next.size === 0
        ? `已清除 ${formatYMD(key)} 的全部记录`
        : `已在 ${formatMD(key)} 记录：${names.join('、')}`
    );
    onUsage?.('记录日期', `${formatYMD(key)}｜${names.join('/')}`);
  }

  /** 事件面板所需信息：事件 + 推算摘要 */
  const eventRows = useMemo(
    () =>
      events.map((e) => {
        const a = analyses[e.id];
        return { ...a, event: e };
      }),
    [events, analyses]
  );

  /** 逾期未记录事件提示（最近一次预测已过去 3 天以上） */
  const overdueEvents = eventRows.filter((a) => a.overdueDays);

  /** 删除事件（其全部历史记录一并移除） */
  function deleteEvent(id) {
    const ev = eventMap[id];
    onPatch(calendar.id, {
      events: events.filter((e) => e.id !== id),
      records: records.filter((r) => r.eventId !== id),
    });
    messageApi.success(`已删除事件「${ev?.name ?? ''}」`);
    onUsage?.('删除事件', ev?.name ?? '');
  }

  /** 创建事件 */
  function createEvent({ name, color }) {
    const ev = { id: genId(), name, color, createdAt: new Date().toISOString() };
    onPatch(calendar.id, { events: [...events, ev] });
    messageApi.success(`已添加事件「${name}」`);
    onUsage?.('新建事件', name);
  }

  /** 更新事件（名称/颜色） */
  function updateEvent(id, { name, color }) {
    onPatch(calendar.id, {
      events: events.map((e) => (e.id === id ? { ...e, name, color } : e)),
    });
    messageApi.success(`已更新事件「${name}」`);
    onUsage?.('编辑事件', name);
  }

  /** 提交事件表单（新增或编辑） */
  function handleEventFormSubmit(values) {
    if (eventModal?.event) {
      updateEvent(eventModal.event.id, values);
    } else {
      createEvent(values);
    }
    setEventModal(null);
  }

  /** 提交重命名 */
  async function submitRename() {
    const { name } = await renameForm.validateFields();
    onPatch(calendar.id, { name: name.trim() });
    messageApi.success(`已重命名为「${name.trim()}」`);
    onUsage?.('重命名日历', name.trim());
    setRenameOpen(false);
  }

  /** 渲染日期格子（含事件色块与预测标记） */
  function renderDateCell(date, info) {
    if (info.type !== 'date') return info.originNode;
    const key = date.format('YYYY-MM-DD');
    const inView = date.year() === viewDate.year() && date.month() === viewDate.month();
    const isToday = key === todayKey();
    const isSelected = key === viewDate.format('YYYY-MM-DD');

    // 当天事件段：先已记录（实色），后预测（斜纹），事件间按数量等分
    const actualIds = inView ? (actualByDate[key] ?? []) : [];
    const predictedIds = inView ? (predictedByDate[key] ?? []) : [];
    const seen = new Set(actualIds);
    const segments = [
      ...actualIds.map((id) => ({ id, predicted: false })),
      ...predictedIds.filter((id) => !seen.has(id)).map((id) => ({ id, predicted: true })),
    ];

    const tips = segments.map(({ id, predicted }) => {
      const ev = eventMap[id];
      return ev ? `${ev.name}（${predicted ? '预测' : '已记录'}）` : null;
    }).filter(Boolean);

    return (
      <div
        style={{
          height: CELL_HEIGHT,
          padding: '4px 6px 0',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
        title={tips.length ? tips.join('、') : undefined}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 2, borderRadius: 4, overflow: 'hidden' }}>
          {segments.length === 0 ? (
            <div style={{ flex: 1 }} />
          ) : (
            segments.map(({ id, predicted }) => {
              const ev = eventMap[id];
              const color = toHexColor(ev?.color) ?? '#bfbfbf';
              return (
                <div
                  key={id}
                  style={{
                    flex: '1 1 0',
                    minWidth: 0,
                    background: predicted
                      ? `repeating-linear-gradient(135deg, ${withAlpha(color, 0.85)} 0 6px, ${withAlpha(color, 0.25)} 6px 12px)`
                      : color,
                    border: predicted ? `1px dashed ${color}` : 'none',
                    borderRadius: 3,
                  }}
                />
              );
            })
          )}
        </div>
        <div style={{ height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              width: 22,
              height: 22,
              lineHeight: '20px',
              textAlign: 'center',
              fontSize: 12,
              borderRadius: '50%',
              boxSizing: 'border-box',
              color: isToday ? '#fff' : inView ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.25)',
              background: isToday ? '#1677ff' : 'transparent',
              border: isSelected && !isToday ? '1px solid #1677ff' : '1px solid transparent',
              userSelect: 'none',
            }}
          >
            {date.date()}
          </div>
        </div>
      </div>
    );
  }

  /** 事件选择/月份切换统一处理；点击日期格子（source='date'）时打开记录弹窗 */
  function handleSelect(date, selectInfo) {
    setViewDate(date);
    if (selectInfo?.source === 'date') {
      openDayRecord(date.format('YYYY-MM-DD'));
    }
  }

  return (
    <div>
      {contextHolder}
      {/* 顶栏：返回 + 名称 + 日历操作 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Space size={12} wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {calendar.name}
          </Typography.Title>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setRenameOpen(true)}>
            重命名
          </Button>
        </Space>
        <Popconfirm
          title="删除日历"
          description={`确定删除「${calendar.name}」？其全部事件与记录将一并删除，且不可恢复。`}
          okText="删除"
          okButtonProps={{ danger: true }}
          onConfirm={async () => {
            // 删除成功提示由父级 CycleTracker 的常驻 context 展示（本组件随后卸载）
            await onDelete(calendar.id);
          }}
        >
          <Button danger icon={<DeleteOutlined />}>
            删除日历
          </Button>
        </Popconfirm>
      </div>

      {overdueEvents.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="部分事件可能漏记"
          description={
            <Space direction="vertical" size={4}>
              {overdueEvents.map((a) => (
                <Text key={a.event.id}>
                  「{a.event.name}」预计 {formatYMD(a.nextDate)}（{weekLabel(a.nextDate)}）发生，已逾期{' '}
                  {a.overdueDays} 天仍未记录，如已发生请点击日历中对应日期补记。
                </Text>
              ))}
            </Space>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        {/* 左侧：事件图例与事件管理 */}
        <Col xs={24} md={10} xl={8} xxl={7}>
          <Card
            size="small"
            title={
              <Space>
                <span>事件</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
                  {events.length} 个
                </Text>
              </Space>
            }
            extra={
              <Button
                type="primary"
                size="small"
                ghost
                icon={<PlusOutlined />}
                onClick={() => setEventModal({})}
              >
                添加事件
              </Button>
            }
          >
            {eventRows.length === 0 ? (
              <div style={{ padding: '8px 0' }}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="还没有事件，点击右上角添加（如：生理期）"
                />
              </div>
            ) : (
              <List
                size="small"
                dataSource={eventRows}
                renderItem={(a) => {
                  const { event: ev, count, cycle, lastDate, nextDate, overdueDays } = a;
                  return (
                    <List.Item
                      actions={[
                        <Tooltip title="编辑事件" key="edit">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => setEventModal({ event: ev })}
                          />
                        </Tooltip>,
                        <Popconfirm
                          key="delete"
                          title="删除事件"
                          description={`确定删除「${ev.name}」？其全部历史记录将一并删除。`}
                          okText="删除"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => deleteEvent(ev.id)}
                        >
                          <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={
                          <div
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: 4,
                              background: toHexColor(ev.color) ?? '#bfbfbf',
                              marginTop: 4,
                              flexShrink: 0,
                            }}
                          />
                        }
                        title={ev.name}
                        description={<EventSummary a={a} />}
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>

          <Card size="small" style={{ marginTop: 16 }} title="推算说明">
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              系统取该事件相邻两次发生的间隔，用
              <Text strong>加权滑动平均</Text>
              计算周期：越靠近现在的记录权重越高。事件记录满 2 次后开始推算。
            </Paragraph>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span
                style={{ display: 'inline-block', width: 16, height: 10, borderRadius: 2, background: '#722ed1' }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>已记录</Text>
              <span
                style={{
                  display: 'inline-block',
                  width: 16,
                  height: 10,
                  borderRadius: 2,
                  background: 'repeating-linear-gradient(135deg, rgba(114,46,209,.85) 0 3px, rgba(114,46,209,.25) 3px 6px)',
                }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>预测发生</Text>
            </div>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  display: 'inline-flex',
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: '#1677ff',
                  color: '#fff',
                  fontSize: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                今
              </span>
              <Text type="secondary" style={{ fontSize: 12 }}>今天；同一天多个事件按颜色等分显示</Text>
            </div>
          </Card>
        </Col>

        {/* 右侧：月历 */}
        <Col xs={24} md={14} xl={16} xxl={17}>
          <Calendar
            value={viewDate}
            onChange={handleSelect}
            onSelect={handleSelect}
            fullCellRender={renderDateCell}
          />
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              点击任意日期，为当天勾选发生的事件；取消勾选可移除当天记录
            </Text>
          </div>
        </Col>
      </Row>

      {/* 事件新建/编辑弹窗 */}
      <EventFormModal
        open={Boolean(eventModal)}
        event={eventModal?.event ?? null}
        onCancel={() => setEventModal(null)}
        onSubmit={handleEventFormSubmit}
      />

      {/* 某天记录弹窗 */}
      <DayRecordModal
        dateKey={dayModalKey}
        events={events}
        actualIds={dayModalKey ? actualByDate[dayModalKey] ?? [] : []}
        onCancel={() => setDayModalKey(null)}
        onSave={(selected) => {
          saveDayRecords(dayModalKey, selected);
          setDayModalKey(null);
        }}
      />

      {/* 重命名弹窗 */}
      <Modal
        title="重命名日历"
        open={renameOpen}
        onOk={submitRename}
        onCancel={() => setRenameOpen(false)}
        okText="确定"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={renameForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="name"
            label="日历名称"
            rules={[
              { required: true, message: '请输入日历名称' },
              { max: 20, message: '名称不能超过 20 个字' },
            ]}
          >
            <Input maxLength={20} autoFocus allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 事件摘要：上次记录 / 周期 / 下次预测 */
function EventSummary({ a }) {
  const { count, cycle, lastDate, nextDate, overdueDays } = a;
  if (count === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        暂无记录，点击日历中的日期开始记录
      </Text>
    );
  }
  const parts = [`上次 ${formatMD(lastDate)}`];
  if (count === 1) {
    parts.push('再记录 1 次即可推算周期');
  } else {
    parts.push(`周期约 ${Math.round(cycle)} 天`);
    if (nextDate) {
      if (overdueDays) {
        parts.push(`预计 ${formatMD(nextDate)}（${weekLabel(nextDate)}），已逾期 ${overdueDays} 天`);
      } else {
        parts.push(`下次预计 ${formatMD(nextDate)}（${weekLabel(nextDate)}）`);
      }
    }
  }
  return (
    <Text type="secondary" style={{ fontSize: 12 }}>
      {parts.join(' ｜ ')}
    </Text>
  );
}

/** 事件新建/编辑表单弹窗 */
function EventFormModal({ open, event, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const [color, setColor] = useState('#1677ff');

  useEffect(() => {
    if (!open) return;
    if (event) {
      form.setFieldsValue({ name: event.name });
      setColor(event.color);
    } else {
      form.resetFields();
      setColor('#1677ff');
    }
  }, [open, event, form]);

  async function handleOk() {
    const { name } = await form.validateFields();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({ name: trimmed, color });
  }

  return (
    <Modal
      title={event ? '编辑事件' : '添加事件'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          name="name"
          label="事件名称"
          rules={[
            { required: true, message: '请输入事件名称' },
            { max: 20, message: '名称不能超过 20 个字' },
          ]}
        >
          <Input placeholder="如：生理期、健身打卡" maxLength={20} autoFocus allowClear />
        </Form.Item>
        <Form.Item label="代表颜色" style={{ marginBottom: 0 }}>
          <Space align="center">
            <ColorPicker
              value={color}
              presets={[{ label: '推荐', colors: COLOR_PRESETS }]}
              onChange={(value) => setColor(value.toHexString())}
              showText
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              该颜色将填充在日历对应的日期上
            </Text>
          </Space>
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** 某天记录弹窗：勾选当天发生的事件，可同时记录多个 */
function DayRecordModal({ dateKey, events, actualIds, onCancel, onSave }) {
  const [checked, setChecked] = useState(null); // Set<eventId>，null 表示未初始化

  // 仅在打开（dateKey 变化）时按当天已有记录初始化，避免覆盖用户勾选
  useEffect(() => {
    if (dateKey) {
      setChecked(new Set(actualIds));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  if (!dateKey || !checked) return null;

  return (
    <Modal
      title={
        <Space>
          <span>{formatYMD(dateKey)}</span>
          <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>
            {weekLabel(dateKey)}
          </Text>
        </Space>
      }
      open
      onOk={() => onSave([...checked])}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      okButtonProps={{ disabled: events.length === 0 }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="勾选当天发生的事件"
        description="取消勾选已有记录将删除该事件当天的记录；同一事件同一天只能记录一次。"
      />
      {events.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="日历中还没有事件，请先在左侧「添加事件」"
        />
      ) : (
        <List
          size="small"
          dataSource={events}
          renderItem={(ev) => {
            const on = checked.has(ev.id);
            const color = toHexColor(ev.color) ?? '#bfbfbf';
            return (
              <List.Item
                style={{
                  borderRadius: 8,
                  padding: '8px 12px',
                  marginBottom: 8,
                  border: on ? `1px solid ${color}` : '1px solid #f0f0f0',
                  background: on ? withAlpha(color, 0.08) : '#fff',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  const next = new Set(checked);
                  if (next.has(ev.id)) next.delete(ev.id);
                  else next.add(ev.id);
                  setChecked(next);
                }}
              >
                <List.Item.Meta
                  avatar={<Checkbox checked={on} style={{ pointerEvents: 'none' }} />}
                  title={<Text strong style={{ fontSize: 14 }}>{ev.name}</Text>}
                />
              </List.Item>
            );
          }}
        />
      )}
    </Modal>
  );
}
