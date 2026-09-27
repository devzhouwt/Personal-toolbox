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
  Grid,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  LeftOutlined,
  PlusOutlined,
  RightOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { genId } from './storage';
import {
  buildAnalyses,
  formatMD,
  formatYMD,
  isRuleEvent,
  todayKey,
  weekLabel,
} from './cycleAlgo';
import {
  buildWorkdayEngine,
  collectNeededYears,
  ensureHolidayYears,
  getHolidayDay,
} from './holidayData';

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

/** 「休」（法定放假）与「班」（调休上班）徽标底色 */
const HOLIDAY_BADGE_COLORS = { h: '#f5222d', w: '#8c8c8c' };

/** 「休/班」小徽标样式（日历单元格与图例共用） */
function holidayBadgeStyle(t) {
  return {
    flexShrink: 0,
    fontSize: 10,
    lineHeight: '14px',
    height: 14,
    padding: '0 3px',
    borderRadius: 2,
    color: '#fff',
    background: HOLIDAY_BADGE_COLORS[t] ?? HOLIDAY_BADGE_COLORS.w,
  };
}

/**
 * 自定义日历头部（替代 antd 默认头部）：年/月下拉 + 月/年切换 + 左右箭头。
 * 箭头在月视图下直接切换月份、年视图下切换年份，无需展开下拉；
 * 下拉与模式切换复用 antd headerRender 的标准事件流，行为与默认头部一致。
 */
function renderCalendarHeader({ value, type, onChange, onTypeChange }) {
  const year = value.year();
  const yearOptions = [];
  for (let y = year - 10; y < year + 10; y += 1) yearOptions.push({ label: `${y}年`, value: y });
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, value: i }));
  const step = (delta) => onChange(value.add(delta, type === 'year' ? 'year' : 'month'));
  return (
    <div className="ant-picker-calendar-header">
      <Button
        type="text"
        icon={<LeftOutlined />}
        aria-label={type === 'year' ? '上一年' : '上个月'}
        style={{ marginInlineEnd: 4 }}
        onClick={() => step(-1)}
      />
      <Select
        className="ant-picker-calendar-year-select"
        value={year}
        options={yearOptions}
        onChange={(y) => onChange(value.year(y))}
      />
      {type === 'month' && (
        <Select
          className="ant-picker-calendar-month-select"
          value={value.month()}
          options={monthOptions}
          onChange={(m) => onChange(value.month(m))}
        />
      )}
      <Radio.Group
        className="ant-picker-calendar-mode-switch"
        value={type}
        onChange={(e) => onTypeChange(e.target.value)}
      >
        <Radio.Button value="month">月</Radio.Button>
        <Radio.Button value="year">年</Radio.Button>
      </Radio.Group>
      <Button
        type="text"
        icon={<RightOutlined />}
        aria-label={type === 'year' ? '下一年' : '下个月'}
        style={{ marginInlineStart: 4 }}
        onClick={() => step(1)}
      />
    </div>
  );
}

/**
 * 日历详情视图：左侧为事件图例与事件管理，右侧为记录/预测月历。
 * 节假日日历（calendar.type === 'holiday'）自动拉取按年的法定节假日数据：
 * 间隔统计与预测按工作日推算（跳过周末与法定节假日、调休日计为工作日），
 * 并在日历中标注「休/班」与节日名；普通日历保持自然日逻辑。
 */
export default function CalendarDetail({ calendar, onBack, onPatch, onDelete }) {
  const [messageApi, contextHolder] = message.useMessage();
  const [viewDate, setViewDate] = useState(dayjs()); // 当前显示月/选中日期
  const [eventModal, setEventModal] = useState(null); // null | { event? }（编辑时传入事件）
  const [dayModalKey, setDayModalKey] = useState(null); // 正在编辑记录的日期 key
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameForm] = Form.useForm();
  // 节假日数据版本号：新数据缓存成功后自增，触发标注与推算重算
  const [holidayTick, setHolidayTick] = useState(0);
  // 拉取后仍不可用的年份（如次年安排未公布），用于提示「按仅跳过周末估算」
  const [holidayMissing, setHolidayMissing] = useState([]);
  // 日历面板模式：month=月视图 / year=年视图（受控，配合自定义头部）
  const [panelMode, setPanelMode] = useState('month');

  /** 重命名弹窗打开后回填当前名称（Modal 首次渲染前调用 form 会触发 useForm 未连接警告） */
  useEffect(() => {
    if (!renameOpen) return;
    renameForm.setFieldsValue({ name: calendar.name });
  }, [renameOpen, renameForm, calendar.name]);

  const { events, records } = calendar;
  const isHoliday = calendar.type === 'holiday';
  const screens = Grid.useBreakpoint();
  // 小屏日期格放不下节日名，仅保留「休/班」徽标
  const showHolidayName = Boolean(screens.lg);
  const viewYear = viewDate.year();

  /** 节假日日历：按需拉取覆盖「最早记录年 ~ 预测跨度年 + 浏览年份」的节假日数据（每年仅一次） */
  useEffect(() => {
    if (!isHoliday) return undefined;
    let cancelled = false;
    const needed = collectNeededYears({
      records,
      extraYears: [viewYear, dayjs().year()],
    });
    ensureHolidayYears(needed).then(({ fetched, missing }) => {
      if (cancelled) return;
      setHolidayMissing((prev) => (prev.join() === missing.join() ? prev : missing));
      if (fetched.length > 0) setHolidayTick((tick) => tick + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [isHoliday, records, viewYear]);

  // 节假日日历使用工作日引擎（间隔与预测按工作日）；普通日历为 null（自然日逻辑）
  const workdayEngine = useMemo(
    () => (isHoliday ? buildWorkdayEngine() : null),
    [isHoliday, holidayTick]
  );

  // 事件推算结果（周期、预测日期等）与预测日期索引
  const { analyses, predictedByDate } = useMemo(
    () => buildAnalyses(events, records, { engine: workdayEngine }),
    [events, records, workdayEngine]
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

  /** 日历内是否存在规则类事件（推算说明据此补充固定间隔说明） */
  const hasRuleEvent = events.some((e) => isRuleEvent(e));

  /** 删除事件（其全部历史记录一并移除） */
  function deleteEvent(id) {
    const ev = eventMap[id];
    onPatch(calendar.id, {
      events: events.filter((e) => e.id !== id),
      records: records.filter((r) => r.eventId !== id),
    });
    messageApi.success(`已删除事件「${ev?.name ?? ''}」`);
  }

  /** 创建事件（kind：predict=预测类按历史推算；rule=规则类固定间隔自动标记） */
  function createEvent({ name, color, kind, intervalDays }) {
    const ev = {
      id: genId(),
      name,
      color,
      kind: kind === 'rule' ? 'rule' : 'predict',
      ...(kind === 'rule' ? { intervalDays } : {}),
      createdAt: new Date().toISOString(),
    };
    onPatch(calendar.id, { events: [...events, ev] });
    messageApi.success(`已添加事件「${name}」`);
  }

  /** 更新事件（名称/颜色/类型与间隔；改为预测类时清除间隔字段） */
  function updateEvent(id, { name, color, kind, intervalDays }) {
    onPatch(calendar.id, {
      events: events.map((e) =>
        e.id === id
          ? {
              ...e,
              name,
              color,
              kind: kind === 'rule' ? 'rule' : 'predict',
              intervalDays: kind === 'rule' ? intervalDays : undefined,
            }
          : e
      ),
    });
    messageApi.success(`已更新事件「${name}」`);
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
    setRenameOpen(false);
  }

  /** 切换日历类型（普通 ↔ 节假日）：历史记录保留，推算按新口径立即重算 */
  function switchCalendarType() {
    const next = isHoliday ? 'normal' : 'holiday';
    onPatch(calendar.id, { type: next });
    messageApi.success(
      next === 'holiday'
        ? '已切换为节假日日历，周期与预测将按工作日推算'
        : '已切换为普通日历，周期与预测将按自然日推算'
    );
  }

  /** 渲染日期格子（含事件色块、预测标记与节假日标注） */
  function renderDateCell(date, info) {
    if (info.type !== 'date') return info.originNode;
    const key = date.format('YYYY-MM-DD');
    const inView = date.year() === viewDate.year() && date.month() === viewDate.month();
    const isToday = key === todayKey();
    const isSelected = key === viewDate.format('YYYY-MM-DD');
    // 节假日信息（仅节假日日历、当前月展示）：{ t: 'h' 放假 | 'w' 调休上班, n: 节日名 }
    const holidayDay = isHoliday && inView ? getHolidayDay(key) : null;

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
    if (holidayDay) {
      tips.push(holidayDay.t === 'h' ? `${holidayDay.n}放假` : `${holidayDay.n}调休上班`);
    }

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
        <div style={{ height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '0 2px', overflow: 'hidden' }}>
          <div
            style={{
              width: 22,
              height: 22,
              lineHeight: '20px',
              textAlign: 'center',
              fontSize: 12,
              borderRadius: '50%',
              boxSizing: 'border-box',
              flexShrink: 0,
              color: isToday ? '#fff' : holidayDay?.t === 'h' ? '#cf1322' : inView ? 'rgba(0,0,0,0.88)' : 'rgba(0,0,0,0.25)',
              background: isToday ? '#1677ff' : 'transparent',
              border: isSelected && !isToday ? '1px solid #1677ff' : '1px solid transparent',
              userSelect: 'none',
            }}
          >
            {date.date()}
          </div>
          {holidayDay && (
            <span style={holidayBadgeStyle(holidayDay.t)}>{holidayDay.t === 'h' ? '休' : '班'}</span>
          )}
          {holidayDay?.t === 'h' && showHolidayName && (
            <span style={{ fontSize: 10, color: '#cf1322', whiteSpace: 'nowrap' }}>{holidayDay.n}</span>
          )}
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
          <Tag color={isHoliday ? 'red' : 'default'} style={{ marginInlineEnd: 0 }}>
            {isHoliday ? '节假日日历' : '普通日历'}
          </Tag>
          <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setRenameOpen(true)}>
            重命名
          </Button>
          <Popconfirm
            title="切换日历类型"
            description={`切换后周期与预测将按${isHoliday ? '自然日' : '工作日'}重新推算，历史记录与事件均不变。`}
            okText="切换"
            onConfirm={switchCalendarType}
          >
            <Button type="text" size="small" icon={<SwapOutlined />}>
              {isHoliday ? '转普通日历' : '转节假日日历'}
            </Button>
          </Popconfirm>
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
                        title={
                          <Space size={6}>
                            <span>{ev.name}</span>
                            {isRuleEvent(ev) && (
                              <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                                规则
                              </Tag>
                            )}
                          </Space>
                        }
                        description={<EventSummary a={a} isHoliday={isHoliday} />}
                      />
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>

          <Card size="small" style={{ marginTop: 16 }} title="推算说明">
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              {isHoliday ? (
                <>
                  本日历为<Text strong>节假日日历</Text>：相邻记录的间隔与预测均按<Text strong>工作日</Text>
                  统计，自动跳过周末与法定节假日，调休日按工作日计算。仍用
                  <Text strong>加权滑动平均</Text>推算周期，事件记录满 2 次后开始推算。
                </>
              ) : (
                <>
                  系统取该事件相邻两次发生的间隔，用
                  <Text strong>加权滑动平均</Text>
                  计算周期：越靠近现在的记录权重越高。事件记录满 2 次后开始推算。
                </>
              )}
            </Paragraph>
            {hasRuleEvent && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {`规则类事件按固定间隔标记：间隔为两次发生之间空隔的时长（本日历口径：${
                  isHoliday
                    ? '工作日，自动跳过周末与法定节假日、调休日计为工作日'
                    : '自然日，填 3 即 1号 → 5号 → 9号'
                }）；以最近一次实际记录为起点自动标记，不参考历史数据；换班/请假后记录实际日期，后续标记自动重算。`}
              </Text>
            )}
            {isHoliday && holidayMissing.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                暂无 {holidayMissing.join('、')} 年节假日数据（尚未公布或暂不支持），该时间段按「仅跳过周末」估算，数据更新后自动修正。
              </Text>
            )}
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
            {isHoliday && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={holidayBadgeStyle('h')}>休</span>
                <Text type="secondary" style={{ fontSize: 12 }}>法定节假日</Text>
                <span style={holidayBadgeStyle('w')}>班</span>
                <Text type="secondary" style={{ fontSize: 12 }}>调休上班</Text>
              </div>
            )}
          </Card>
        </Col>

        {/* 右侧：月历 */}
        <Col xs={24} md={14} xl={16} xxl={17}>
          <Calendar
            value={viewDate}
            mode={panelMode}
            onPanelChange={(_, mode) => setPanelMode(mode)}
            onChange={handleSelect}
            onSelect={handleSelect}
            fullCellRender={renderDateCell}
            headerRender={renderCalendarHeader}
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

/** 事件摘要：上次记录 / 周期（固定间隔或推算） / 下次预测 */
function EventSummary({ a, isHoliday }) {
  const { event, count, cycle, lastDate, nextDate, overdueDays } = a;
  const isRule = isRuleEvent(event);
  if (count === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {isRule ? '暂无记录，点击日期记录一次后自动标记后续日期' : '暂无记录，点击日历中的日期开始记录'}
      </Text>
    );
  }
  const parts = [`上次 ${formatMD(lastDate)}`];
  if (isRule) {
    parts.push(`固定间隔 ${cycle} ${isHoliday ? '个工作日' : '天'}`);
  } else if (count === 1) {
    parts.push('再记录 1 次即可推算周期');
  } else {
    parts.push(`周期约 ${Math.round(cycle)} ${isHoliday ? '个工作日' : '天'}`);
  }
  if (nextDate) {
    if (overdueDays) {
      parts.push(`预计 ${formatMD(nextDate)}（${weekLabel(nextDate)}），已逾期 ${overdueDays} 天`);
    } else {
      parts.push(`下次预计 ${formatMD(nextDate)}（${weekLabel(nextDate)}）`);
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
  // 当前选择的事件类型：predict=预测类（按历史推算）；rule=规则类（固定间隔自动标记）
  const kind = Form.useWatch('kind', form) ?? 'predict';

  useEffect(() => {
    if (!open) return;
    if (event) {
      form.setFieldsValue({
        name: event.name,
        kind: event.kind === 'rule' ? 'rule' : 'predict',
        intervalDays: event.intervalDays ?? 3,
      });
      setColor(event.color);
    } else {
      form.resetFields();
      setColor('#1677ff');
    }
  }, [open, event, form]);

  async function handleOk() {
    const { name, kind: eventKind, intervalDays } = await form.validateFields();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({
      name: trimmed,
      color,
      kind: eventKind,
      intervalDays: eventKind === 'rule' ? intervalDays : undefined,
    });
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
        <Form.Item name="kind" label="事件类型" initialValue="predict" rules={[{ required: true }]}>
          <Radio.Group>
            <Radio value="predict">预测类事件</Radio>
            <Radio value="rule">规则类事件</Radio>
          </Radio.Group>
        </Form.Item>
        {kind === 'rule' && (
          <Form.Item
            name="intervalDays"
            label="事件间隔（天）"
            initialValue={3}
            rules={[{ required: true, message: '请输入事件间隔' }]}
            extra="两次发生之间空隔的时长：普通日历按自然日（填 3 即 1号 → 5号 → 9号），节假日日历按工作日（自动跳过周末与法定节假日、调休日计为工作日）。以最近一次实际记录为起点自动标记后续日期；换班/请假后记录实际日期，后续标记自动重算，不参考历史数据。"
          >
            <InputNumber min={1} max={3650} precision={0} style={{ width: '100%' }} placeholder="如：3" />
          </Form.Item>
        )}
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
