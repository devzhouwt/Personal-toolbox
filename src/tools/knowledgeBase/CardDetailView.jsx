import { useMemo, useState } from 'react';
import { Button, Popconfirm, Space, Tag, Typography } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { fmtAgo, fmtDateTime, highlightSegments } from './kbCore';
import CardEditModal from './CardEditModal';

const { Text, Title } = Typography;

/** 时间点展示：完整时间 + 相对时间（如 2026-09-08 21:30 ・ 3 小时前） */
function TimePoint({ label, iso }) {
  return (
    <Text type="secondary" style={{ fontSize: 13 }}>
      {label}：{fmtDateTime(iso)}
      {iso ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {' '}
          · {fmtAgo(iso)}
        </Text>
      ) : null}
    </Text>
  );
}

/**
 * 个人知识库 - 详情视图：查看知识完整内容（进入即视为一次「查看」，由入口组件更新
 * lastViewedAt 并计入最近查看/冷门知识统计），并提供编辑与删除入口。
 * 从搜索结果进入时（入口组件传入 highlightTokens），对内容中的命中关键词高亮显示，
 * 方便定位匹配位置。
 */
export default function CardDetailView({
  card,
  categories,
  defaultCategoryName,
  highlightTokens,
  onBack,
  onSave,
  onDelete,
}) {
  const [editOpen, setEditOpen] = useState(false);
  // 内容高亮片段：仅从搜索结果进入且内容命中关键词时非 null（否则按原文展示）
  const highlightParts = useMemo(
    () => highlightSegments(card.content, highlightTokens),
    [card.content, highlightTokens]
  );

  return (
    <div>
      {/* 头部：返回 / 标题 / 标签 / 操作 */}
      <div style={{ marginBottom: 16 }}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={onBack}
          style={{ paddingLeft: 0, marginBottom: 8 }}
        >
          返回列表
        </Button>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          {card.title ? (
            <Title level={4} style={{ margin: 0, flex: 1 }}>
              {card.title}
            </Title>
          ) : (
            // 无标题：不显示标题区域，占位元素仅用于保持右上角操作按钮位置
            <div style={{ flex: 1 }} />
          )}
          <Space>
            <Button icon={<EditOutlined />} onClick={() => setEditOpen(true)}>
              编辑
            </Button>
            <Popconfirm
              title={card.title ? `删除知识「${card.title}」？` : '删除这张知识卡片？'}
              description="删除后不可恢复，若已同步云端，删除会同时生效"
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={onDelete}
            >
              <Button danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        </div>
        <div style={{ marginTop: 8 }}>
          <Tag color="blue" style={{ marginBottom: 4 }}>
            {card.category}
          </Tag>
          {card.tags.map((t) => (
            <Tag key={t} style={{ marginBottom: 4 }}>
              {t}
            </Tag>
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 4 }}>
          <TimePoint label="创建于" iso={card.createdAt} />
          <TimePoint label="更新于" iso={card.updatedAt} />
          {card.lastViewedAt ? <TimePoint label="最近查看" iso={card.lastViewedAt} /> : null}
        </div>
      </div>

      {/* 内容正文（从搜索结果进入时，命中关键词高亮显示） */}
      <div
        style={{
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          padding: '16px 20px',
          minHeight: 240,
        }}
      >
        <Text style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
          {highlightParts
            ? highlightParts.map((p, i) =>
                p.mark ? (
                  <Text key={i} mark>
                    {p.text}
                  </Text>
                ) : (
                  p.text
                )
              )
            : card.content}
        </Text>
      </div>

      {/* 编辑弹窗（新建与编辑共用，保存回调由入口组件区分） */}
      <CardEditModal
        open={editOpen}
        initial={card}
        categories={categories}
        defaultCategoryName={defaultCategoryName}
        onFinish={async (values) => {
          await onSave(values);
          setEditOpen(false);
        }}
        onClose={() => setEditOpen(false)}
      />
    </div>
  );
}
