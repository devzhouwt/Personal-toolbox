import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Grid,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CloudOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FolderAddOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SyncOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { coldCards, daysSince, fmtAgo, fmtDateTime, recentSections, searchCards } from './kbCore';
import CardEditModal from './CardEditModal';

const { Paragraph, Text } = Typography;

/** 搜索结果的四级优先级展示元信息（PRD 3.2 排序规则） */
const PRIORITY_META = {
  1: { color: 'green', label: '完全匹配', tip: '标签与关键词完全一致' },
  2: { color: 'blue', label: '标签全含', tip: '标签包含全部关键词，但比关键词更多' },
  3: { color: 'cyan', label: '标签+内容', tip: '部分关键词命中标签，其余命中内容' },
  4: { color: 'default', label: '仅内容', tip: '所有关键词仅在内容中命中' },
};

/** 同步状态标签（state: local | ok | syncing | writeError | error） */
const SYNC_META = {
  local: { color: 'default', icon: <CloudOutlined />, text: '仅本地', tip: '未配置 Gitee 仓库，知识仅保存在本地浏览器' },
  ok: { color: 'success', icon: <CloudServerOutlined />, text: '已同步', tip: '知识库已同步至 Gitee 仓库' },
  syncing: { color: 'processing', icon: <SyncOutlined spin />, text: '同步中', tip: '正在写入 Gitee 仓库' },
  writeError: { color: 'error', icon: <WarningOutlined />, text: '同步失败', tip: '上次同步失败：修改已保留在本地，下次修改时自动重试，也可点击「同步到 Gitee」' },
  error: { color: 'warning', icon: <WarningOutlined />, text: '云端不可用', tip: 'Gitee 连接失败，当前为本地模式；可点击「同步到 Gitee」重试' },
};

/** 从文件读取文本 */
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

/** 触发浏览器下载文本文件 */
function downloadText(fileName, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 个人知识库 - 列表视图：搜索（四级优先级排序）、分类筛选、最近添加/修改/查看、
 * 冷门知识、分类管理、备份导入导出与同步状态展示。详情查看与编辑在详情视图进行。
 */
export default function CardListView({
  entries,
  categories,
  defaultCategoryId,
  syncState,
  onOpenCard,
  onCreateCard,
  onAddCategory,
  onRenameCategory,
  onDeleteCategory,
  onImport,
  onParseImport,
  onManualSync,
}) {
  const [messageApi, contextHolder] = message.useMessage();
  // 手机端（<768px）搜索框占满整行，避免固定宽度溢出
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const [kw, setKw] = useState('');
  const [catFilterId, setCatFilterId] = useState('__ALL__');
  const [activeTab, setActiveTab] = useState('adds');
  // 新增知识弹窗
  const [createOpen, setCreateOpen] = useState(false);
  // 分类管理弹窗
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [renameTarget, setRenameTarget] = useState(null); // { id, name }
  const [renameName, setRenameName] = useState('');

  const total = entries.length;
  const searching = Boolean(kw.trim());
  const defaultCategoryName =
    categories.find((c) => c.id === defaultCategoryId)?.name ?? categories[0]?.name ?? '';
  const syncMeta = SYNC_META[syncState] ?? SYNC_META.local;

  // 搜索/浏览范围：仅搜索模式应用分类筛选
  const scopeEntries = useMemo(
    () =>
      catFilterId === '__ALL__'
        ? entries
        : entries.filter((e) => e.categoryId === catFilterId),
    [entries, catFilterId]
  );
  // 筛选的分类被删除后自动回到全部分类
  useEffect(() => {
    if (catFilterId !== '__ALL__' && !categories.some((c) => c.id === catFilterId)) {
      setCatFilterId('__ALL__');
    }
  }, [categories, catFilterId]);

  const searchResult = useMemo(
    () => (searching ? searchCards(scopeEntries, kw) : null),
    [scopeEntries, searching, kw]
  );
  const sections = useMemo(() => recentSections(scopeEntries), [scopeEntries]);
  const coldList = useMemo(() => coldCards(scopeEntries), [scopeEntries]);

  /** 知识卡片磁贴（点击进入详情） */
  function CardTile({ card, footerLeft, footerRight }) {
    return (
      <Card
        size="small"
        hoverable
        style={{ height: '100%' }}
        styles={{ body: { padding: 12 } }}
        onClick={() => onOpenCard(card.id)}
      >
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <Text strong>{card.title}</Text>
        </div>
        <div style={{ marginTop: 6 }}>
          {card.tags.map((t) => (
            <Tag key={t} style={{ marginBottom: 4 }}>
              {t}
            </Tag>
          ))}
        </div>
        {card.content ? (
          <Paragraph
            type="secondary"
            ellipsis={{ rows: 2, tooltip: card.content }}
            style={{ margin: '4px 0 8px' }}
          >
            {card.content}
          </Paragraph>
        ) : null}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {footerLeft ?? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {card.category} · {fmtAgo(card.updatedAt)} 更新
            </Text>
          )}
          {footerRight}
        </div>
      </Card>
    );
  }

  /** 统一卡片网格：空列表展示 emptyText */
  function CardGrid({ cards, emptyText, footerFor }) {
    if (cards.length === 0) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} style={{ padding: '40px 0' }} />;
    }
    return (
      <List
        grid={{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 4 }}
        dataSource={cards}
        rowKey="id"
        pagination={{ pageSize: 12, size: 'small', hideOnSinglePage: true }}
        renderItem={(card) => (
          <List.Item style={{ height: '100%' }}>
            <CardTile card={card} footerLeft={footerFor?.left?.(card)} footerRight={footerFor?.right?.(card)} />
          </List.Item>
        )}
      />
    );
  }

  /** 冷门知识磁贴右侧：距上次操作天数 */
  function coldRight(card) {
    const days = daysSince(card.activeAt);
    if (days < 2) {
      return (
        <Tooltip title={`上次活动：${fmtDateTime(card.activeAt)}`}>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            最近活跃
          </Tag>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={`上次活动：${fmtDateTime(card.activeAt)}`}>
        <Tag color="orange" style={{ marginInlineEnd: 0 }}>
          {days} 天未操作
        </Tag>
      </Tooltip>
    );
  }

  /** 搜索命中磁贴右侧：命中优先级标签 */
  function searchRight(card) {
    const hit = searchResult?.matched.find((m) => m.entry.id === card.id);
    if (!hit) return null;
    const meta = PRIORITY_META[hit.priority];
    return (
      <Tooltip title={meta.tip}>
        <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
          {meta.label}
        </Tag>
      </Tooltip>
    );
  }

  /** 搜索模式结果区 */
  function renderSearchResult() {
    if (!searchResult) return null;
    const { matched, tokens } = searchResult;
    if (matched.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span>
              没有找到与「{kw.trim()}」匹配的知识
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                标签需完全一致、内容为包含匹配；多个关键词用空格分隔，需全部命中
              </Text>
            </span>
          }
          style={{ padding: '40px 0' }}
        />
      );
    }
    return (
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          命中 {matched.length} 张（关键词：{tokens.join(' / ')}），按标签完全匹配、标签全含、标签+内容、仅内容四级排序
        </Text>
        <CardGrid
          cards={matched.map((m) => m.entry)}
          emptyText=""
          footerFor={{ right: searchRight }}
        />
      </div>
    );
  }

  /** 非搜索模式：最近添加/修改/查看 + 冷门知识 Tabs */
  function renderDefault() {
    if (total === 0) {
      return (
        <Empty
          description="暂无知识卡片。点击右上角「新增知识」开始记录你的第一条知识"
          style={{ padding: '64px 0' }}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新增知识
          </Button>
        </Empty>
      );
    }
    const tabList = [
      {
        key: 'adds',
        label: '最近添加',
        children: (
          <CardGrid
            cards={sections.adds}
            emptyText="还没有添加过知识"
            footerFor={{ left: (c) => <Text type="secondary" style={{ fontSize: 12 }}>{c.category} · {fmtAgo(c.createdAt)} 添加</Text> }}
          />
        ),
      },
      {
        key: 'updates',
        label: '最近修改',
        children: (
          <CardGrid
            cards={sections.updates}
            emptyText="还没有修改过知识"
            footerFor={{ left: (c) => <Text type="secondary" style={{ fontSize: 12 }}>{c.category} · {fmtAgo(c.updatedAt)} 修改</Text> }}
          />
        ),
      },
      {
        key: 'views',
        label: '最近查看',
        children: (
          <CardGrid
            cards={sections.views}
            emptyText="还没有查看过知识（进入详情页查看才会记录）"
            footerFor={{ left: (c) => <Text type="secondary" style={{ fontSize: 12 }}>{c.category} · {fmtAgo(c.lastViewedAt)} 查看</Text> }}
          />
        ),
      },
      {
        key: 'cold',
        label: '冷门知识',
        children: (
          <CardGrid
            cards={coldList}
            emptyText="暂无知识卡片"
            footerFor={{
              left: (c) => (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {c.category} · {fmtAgo(c.activeAt)} 活动
                </Text>
              ),
              right: coldRight,
            }}
          />
        ),
      },
    ];
    return <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabList} />;
  }

  /** 导出整库备份（JSON 下载） */
  function handleExport() {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate()
    ).padStart(2, '0')}`;
    const payload = {
      tool: 'knowledge-base',
      exportedAt: now.toISOString(),
      state: { version: 1, defaultCategoryId, categories },
    };
    downloadText(
      `knowledge-base-backup-${ymd}.json`,
      JSON.stringify(payload, null, 2)
    );
    messageApi.success('已导出知识库备份');
  }

  /** 读取并校验导入文件，确认后整体覆盖当前知识库 */
  async function handleImportFile(file) {
    try {
      const imported = onParseImport(await readFileText(file));
      const count = imported.categories.reduce((n, c) => n + c.cards.length, 0);
      Modal.confirm({
        title: '导入知识库备份',
        content: (
          <span>
            将用备份中的 {imported.categories.length} 个分类、{count} 张知识卡片
            <Text type="danger">整体替换</Text>当前知识库（现有 {total} 张卡片将被覆盖）。
            建议先「导出备份」。是否继续？
          </span>
        ),
        okText: '导入并覆盖',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => {
          onImport(imported);
        },
      });
    } catch (err) {
      messageApi.error(`导入失败：${err.message}`);
    }
  }

  /** 分类管理：新建分类 */
  async function submitAddCategory() {
    if (!newCatName.trim()) {
      messageApi.warning('请输入分类名称');
      return;
    }
    setAddingCat(true);
    const ok = await onAddCategory(newCatName);
    setAddingCat(false);
    if (ok) setNewCatName('');
  }

  /** 分类管理：重命名（打开弹窗时初始化） */
  function openRename(cat) {
    setRenameTarget(cat);
    setRenameName(cat.name);
  }

  async function submitRename() {
    if (!renameTarget) return;
    const ok = await onRenameCategory(renameTarget.id, renameName);
    if (ok) setRenameTarget(null);
  }

  return (
    <div>
      {contextHolder}
      {/* 顶部工具栏 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 12,
          marginBottom: 8,
        }}
      >
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: '#999' }} />}
          placeholder="搜索标签或内容，空格分隔多个关键词"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          style={{ width: isMobile ? '100%' : 300 }}
        />
        {searching && (
          <Select
            value={catFilterId}
            onChange={setCatFilterId}
            style={{ width: 160 }}
            options={[
              { value: '__ALL__', label: '全部分类' },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        )}
        <div style={{ flex: 1 }} />
        <Text type="secondary">共 {total} 张知识</Text>
        <Tooltip title={syncMeta.tip}>
          <Tag color={syncMeta.color} icon={syncMeta.icon} style={{ marginInlineEnd: 0 }}>
            {syncMeta.text}
          </Tag>
        </Tooltip>
        {syncState !== 'local' && (
          <Button
            size="small"
            icon={syncState === 'error' ? <WarningOutlined /> : <SyncOutlined />}
            loading={syncState === 'syncing'}
            onClick={onManualSync}
          >
            {syncState === 'error' ? '重试同步' : '同步到 Gitee'}
          </Button>
        )}
        <Button size="small" icon={<SettingOutlined />} onClick={() => setCatModalOpen(true)}>
          分类管理
        </Button>
        <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>
          导出
        </Button>
        <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => { handleImportFile(file); return false; }}>
          <Button size="small" icon={<UploadOutlined />}>
            导入
          </Button>
        </Upload>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新增知识
        </Button>
      </div>

      {/* 主体：搜索模式结果 / 默认最近与冷门区块 */}
      {searching ? renderSearchResult() : renderDefault()}

      {/* 新增知识弹窗 */}
      <CardEditModal
        open={createOpen}
        categories={categories}
        defaultCategoryName={defaultCategoryName}
        onFinish={async (values) => {
          await onCreateCard(values);
          setCreateOpen(false);
        }}
        onClose={() => setCreateOpen(false)}
      />

      {/* 分类管理弹窗 */}
      <Modal
        title="分类管理"
        open={catModalOpen}
        onCancel={() => setCatModalOpen(false)}
        footer={null}
        width={520}
      >
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            placeholder="输入新分类名称（≤20 字，回车创建）"
            value={newCatName}
            maxLength={20}
            onChange={(e) => setNewCatName(e.target.value)}
            onPressEnter={submitAddCategory}
          />
          <Button
            type="primary"
            icon={<FolderAddOutlined />}
            loading={addingCat}
            onClick={submitAddCategory}
          >
            新建分类
          </Button>
        </Space.Compact>
        <List
          dataSource={categories}
          rowKey="id"
          renderItem={(cat) => {
            const isDefault = cat.id === defaultCategoryId;
            return (
              <List.Item
                actions={[
                  <Tooltip title="重命名" key="rename">
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openRename(cat)} />
                  </Tooltip>,
                  <Tooltip
                    key="delete"
                    title={isDefault ? '默认分类不可删除' : '删除分类，其中卡片将移入默认分类'}
                  >
                    <Popconfirm
                      title={`删除分类「${cat.name}」？`}
                      description={cat.cards.length > 0 ? `其中 ${cat.cards.length} 张知识将移入「${defaultCategoryName}」` : undefined}
                      okText="删除"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      disabled={isDefault}
                      onConfirm={() => onDeleteCategory(cat.id)}
                    >
                      <Button type="text" danger size="small" icon={<DeleteOutlined />} disabled={isDefault} />
                    </Popconfirm>
                  </Tooltip>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={8}>
                      <span>{cat.name}</span>
                      {isDefault && <Tag color="gold" style={{ marginInlineEnd: 0 }}>默认</Tag>}
                    </Space>
                  }
                  description={`${cat.cards.length} 张知识`}
                />
              </List.Item>
            );
          }}
        />
      </Modal>

      {/* 重命名分类弹窗 */}
      <Modal
        title={renameTarget ? `重命名分类「${renameTarget.name}」` : ''}
        open={Boolean(renameTarget)}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        onOk={submitRename}
        onCancel={() => setRenameTarget(null)}
      >
        <Input
          placeholder="新分类名称（≤20 字）"
          value={renameName}
          maxLength={20}
          onChange={(e) => setRenameName(e.target.value)}
          onPressEnter={submitRename}
        />
      </Modal>
    </div>
  );
}
