import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Spin, Typography, message } from 'antd';
import { isGiteeConfigured, recordToolUsage } from '../../services/history';
import {
  genCardId,
  genId,
  makeEmptyState,
  normalizeTags,
  validateCategoryName,
} from './kbCore';
import {
  buildFiles,
  contentKey,
  loadLocal,
  parseImported,
  readGiteeLibrary,
  saveLocal,
  writeKbFile,
  deleteKbFile,
} from './kbStorage';
import CardListView from './CardListView';
import CardDetailView from './CardDetailView';

const { Text } = Typography;

/** 工具存档目录名（对应 Gitee 仓库 history/ 下的子目录，也用于使用历史） */
const TOOL_ID = 'knowledge-base';

/** 在库状态中解析表单提交的分类：无效/未指定时归入兜底分类 */
function findCategory(prev, categoryName) {
  const trimmed = String(categoryName ?? '').trim();
  return (
    prev.categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase()) ??
    prev.categories.find((c) => c.id === prev.defaultCategoryId) ??
    prev.categories[0] ??
    null
  );
}

/**
 * 个人知识库：数据状态管理与视图切换的入口。
 *
 * 存储以 Gitee 仓库为主（history/knowledge-base/：index.json + 按分类拆分的文件，
 * 写入时自动创建目录与文件），每次进入本工具时拉取；浏览器 localStorage 为离线缓存：
 * - 未配置 Gitee → 本地模式，变更仅写 localStorage；
 * - 已配置 Gitee → 进入时读取远程：仓库尚无索引（首次使用）时自动创建，
 *   若浏览器本地缓存有旧数据，则弹窗询问「上传本地 / 忽略本地新建空档」；
 *   之后每次内容变更自动做文件级 diff 并串行推送（队列避免并发写冲突），
 *   推送失败不中断会话：状态标签提示待重试，下次变更或点击「同步到 Gitee」自动重试；
 *   进入时云端不可读（断网/令牌失效等）则降级本地缓存，列表页可手动重试拉取，
 *   若降级期间产生过本地修改，重试成功后会先询问以哪边为准（冲突处理）。
 * 关键操作（新增/编辑/删除知识、分类管理、导入）按项目惯例追加 Gitee 使用历史：
 * 历史写入在后台独立串行队列中异步进行，不阻塞界面操作（连续操作也不会造成
 * history.json 的读-改-写竞争导致历史记录丢失）。
 */
export default function KnowledgeBase() {
  const [messageApi, contextHolder] = message.useMessage();
  // 知识库状态：{ version, defaultCategoryId, categories: [{ id, name, cards }] }
  const [state, setState] = useState(() => makeEmptyState());
  const [loading, setLoading] = useState(isGiteeConfigured());
  // 存档同步状态：local | ok | syncing | writeError | error（error = 云端不可用已降级）
  const [syncState, setSyncState] = useState('local');
  const [activeCardId, setActiveCardId] = useState(null);
  // 进入详情时携带的搜索关键词（从搜索结果点击进入时设置），详情页用于高亮命中位置
  const [detailHighlight, setDetailHighlight] = useState(null);
  // 云端文件损坏/缺失提示（进入工具时探测到）
  const [warnings, setWarnings] = useState([]);

  // 初始化（拉取存档）完成前不触发自动持久化
  const initializedRef = useRef(false);
  // 初始化将要注入的状态引用：持久化副作用在该引用生效后才开始跟踪变更，
  // 避免初始化同轮 commit 中用初始空库覆盖本地缓存
  const syncedStateRef = useRef(null);
  // 最近一次与云端一致的各文件内容（fileName → 原文），作为文件级 diff 基线
  const refFilesRef = useRef({});
  // 最近一次推送成功时的内容键；键相同则仅本地增强（如最近查看）变化，无需推送
  const contentKeyRef = useRef('');
  // Gitee 写入串行队列，防止连续快速变更导致并发写冲突
  const writeQueueRef = useRef(Promise.resolve());
  // 使用历史写入队列（与知识库文件队列相互独立）：后台按序写入 history.json，
  // 避免连续操作时同一文件的读-改-写竞争导致历史记录丢失
  const usageQueueRef = useRef(Promise.resolve());
  // 本次会话是否已提示过同步失败（避免连续操作时重复弹窗）
  const syncErrorNotifiedRef = useRef(false);
  // 进入时云端读取失败：本次会话仅保留本地，需手动重试或重新进入以恢复
  const cloudUnavailableRef = useRef(false);

  /** 展平全库卡片，附带所属分类信息（列表/搜索/详情的统一数据源） */
  const entries = useMemo(
    () =>
      state.categories.flatMap((cat) =>
        cat.cards.map((card) => ({ ...card, category: cat.name, categoryId: cat.id }))
      ),
    [state]
  );

  /** 追加使用历史到 Gitee 仓库：仅入队即返回（调用方无需等待；未配置或失败均静默，不阻断界面操作） */
  function saveUsage(action, title) {
    usageQueueRef.current = usageQueueRef.current.then(() =>
      recordToolUsage(TOOL_ID, { action, title }).catch((err) => {
        // 失败由 catch 消化保证队列链不断；历史写入失败不影响工具使用
        console.warn('知识库使用历史写入失败', err);
      })
    );
  }

  /** 将远程状态应用到本地（以远程为准，仅合并本地更新的 lastViewedAt） */
  function applyRemoteState(readResult, localState) {
    const localViewed = new Map();
    for (const cat of localState.categories) {
      for (const c of cat.cards) {
        if (c.lastViewedAt) localViewed.set(c.id, c.lastViewedAt);
      }
    }
    const merged = {
      ...readResult.state,
      categories: readResult.state.categories.map((cat) => ({
        ...cat,
        cards: cat.cards.map((c) => {
          const local = localViewed.get(c.id);
          if (local && (!c.lastViewedAt || Date.parse(local) > Date.parse(c.lastViewedAt))) {
            return { ...c, lastViewedAt: local };
          }
          return c;
        }),
      })),
    };
    refFilesRef.current = readResult.rawFiles;
    contentKeyRef.current = contentKey(merged);
    syncedStateRef.current = merged;
    setState(merged);
    saveLocal(merged);
  }

  /**
   * 将一批文件写入与删除加入串行队列（内容在入队时已固定为文本快照）。
   * @returns {Promise<boolean>} 是否全部成功
   */
  function enqueuePush(files, removed, key) {
    const task = writeQueueRef.current.then(async () => {
      for (const name of Object.keys(files)) {
        await writeKbFile(name, files[name]);
      }
      for (const name of removed) {
        await deleteKbFile(name);
      }
      refFilesRef.current = files;
      contentKeyRef.current = key;
      setSyncState('ok');
      syncErrorNotifiedRef.current = false;
      return true;
    });
    // 失败由 catch 消化保证队列链不断，状态与一次性提示在这里统一处理
    writeQueueRef.current = task.catch((err) => {
      setSyncState('writeError');
      if (!syncErrorNotifiedRef.current) {
        syncErrorNotifiedRef.current = true;
        messageApi.warning(
          `同步失败，请检查网络或仓库配置。修改已保留在本地，下次修改时会自动重试，也可点击「同步到 Gitee」手动重试：${err.message}`
        );
      }
      return false;
    });
    return writeQueueRef.current;
  }

  /** 首次使用（云端无存档）时确认数据源：本地无数据直接建空档，有数据弹窗询问 */
  function askFirstInit(localState) {
    const hasCards = localState.categories.some((c) => c.cards.length > 0);
    if (!hasCards) return Promise.resolve({ state: localState, uploaded: false });
    return new Promise((resolve) => {
      Modal.confirm({
        title: '初始化云端知识库',
        content: (
          <span>
            仓库中还没有知识库存档，但浏览器本地缓存中有{' '}
            <Text strong>{localState.categories.reduce((n, c) => n + c.cards.length, 0)}</Text>{' '}
            张知识卡片。
            <br />
            要上传为首次存档，还是忽略本地数据、从空知识库开始？
          </span>
        ),
        okText: '上传本地知识',
        cancelText: '忽略本地，新建空库',
        maskClosable: false,
        keyboard: false,
        onOk: () => resolve({ state: localState, uploaded: true }),
        onCancel: () => resolve({ state: makeEmptyState(), uploaded: false }),
      });
    });
  }

  /** 将某个本地状态全量上传为云端存档并更新同步基线 */
  async function uploadLocalState(target) {
    const files = buildFiles(target);
    setSyncState('syncing');
    await enqueuePush(files, [], contentKey(target));
    syncedStateRef.current = target;
    setState(target);
    saveLocal(target);
    cloudUnavailableRef.current = false;
    setWarnings([]);
    setSyncState('ok');
  }

  /** 拉取远程并应用（进入工具与「云端不可用后手动重试」共用） */
  async function runInit() {
    setLoading(true);
    const local = loadLocal();
    if (local.recovered) {
      messageApi.warning('本地知识库数据已损坏，已自动重置为空库（原内容备份在浏览器 localStorage 的 knowledgeBase:v1:corrupt-backup 中）');
    }
    if (!isGiteeConfigured()) {
      // 本地模式
      contentKeyRef.current = contentKey(local.state);
      refFilesRef.current = {};
      syncedStateRef.current = local.state;
      setState(local.state);
      setSyncState('local');
      setLoading(false);
      return;
    }

    try {
      const read = await readGiteeLibrary();
      // 云端恢复重试时：若降级期间产生过本地修改，先询问以哪边为准（冲突处理）
      const askConflict =
        cloudUnavailableRef.current && contentKey(local.state) !== contentKeyRef.current;
      const keepLocal = await new Promise((resolve) => {
        if (!askConflict) {
          resolve(true);
          return;
        }
        Modal.confirm({
          title: '云端已恢复，检测到本地有未同步的修改',
          content: (
            <span>
              云端不可用期间你在本地修改过知识库。以本地为准会
              <Text type="danger">覆盖云端较新版本</Text>；以云端为准会放弃本地修改。
            </span>
          ),
          okText: '保留本地修改（覆盖云端）',
          cancelText: '以云端为准',
          maskClosable: false,
          keyboard: false,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });

      if (read.status === 'empty') {
        // 仓库尚无存档：冲突时保留本地 → 直接上传；首次进入 → 本地有卡片时弹窗询问
        const choice = askConflict
          ? { state: keepLocal ? local.state : makeEmptyState(), uploaded: keepLocal }
          : await askFirstInit(local.state);
        await uploadLocalState(choice.state);
        messageApi.success(
          choice.uploaded
            ? '已将本地知识上传为云端存档'
            : '已创建云端空存档，可以开始记录了'
        );
      } else {
        // 云端正常：以远程为准（合并本地最近查看时间），提示损坏/缺失文件
        applyRemoteState(read, local.state);
        cloudUnavailableRef.current = false;
        setSyncState('ok');
        if (read.warnings.length) {
          setWarnings(read.warnings);
          messageApi.warning(
            `知识库云端部分文件异常（${read.warnings.map((w) => w.fileName).join('、')}），详情见页面顶部提示`
          );
        } else {
          setWarnings([]);
        }
      }
    } catch (err) {
      // 云端不可用（读取失败，如断网/令牌失效）：本次会话改用浏览器本地存档
      cloudUnavailableRef.current = true;
      contentKeyRef.current = contentKey(local.state);
      refFilesRef.current = {};
      syncedStateRef.current = local.state;
      setState(local.state);
      setWarnings([]);
      setSyncState('error');
      messageApi.warning(
        `网络异常，已使用本地缓存数据：${err.message}。修改仅保存在本地；` +
          '可点击列表页「同步到 Gitee」重试，或检查右上角「Gitee 配置」后重新进入本工具恢复云端同步。'
      );
    } finally {
      setLoading(false);
    }
  }

  /** 进入工具时初始化（拉取远程或启用本地模式） */
  useEffect(() => {
    runInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 内容变更后的持久化：先写本地缓存；云端可用且内容键变化时做文件 diff 推送 */
  useEffect(() => {
    if (state === syncedStateRef.current) {
      // 初始化注入的状态已生效：正式开始变更跟踪
      initializedRef.current = true;
    }
    if (!initializedRef.current) return; // 初始化未完成：忽略初始空库状态，避免覆盖本地缓存
    saveLocal(state); // 本地缓存始终即时更新（含仅查看等本地增强变化）
    if (!isGiteeConfigured() || cloudUnavailableRef.current) return;
    const key = contentKey(state);
    if (key === contentKeyRef.current) return; // 仅 lastViewedAt 等变化：不推送云端
    const files = buildFiles(state);
    const removed = Object.keys(refFilesRef.current).filter((name) => !(name in files));
    setSyncState('syncing');
    enqueuePush(files, removed, key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** 校验 activeCardId（卡片可能已被删除/导入覆盖） */
  useEffect(() => {
    if (activeCardId && !entries.some((e) => e.id === activeCardId)) {
      setActiveCardId(null);
    }
  }, [entries, activeCardId]);

  /** 手动同步：云端不可用时重新拉取（先询问本地修改去留），否则全量推送本地 */
  function handleManualSync() {
    if (!isGiteeConfigured()) {
      messageApi.info('尚未配置 Gitee 仓库：知识仅保存在本地浏览器。可点击右上角「Gitee 配置」开启云端存档。');
      return;
    }
    if (cloudUnavailableRef.current) {
      runInit();
      return;
    }
    const files = buildFiles(state);
    const removed = Object.keys(refFilesRef.current).filter((name) => !(name in files));
    setSyncState('syncing');
    enqueuePush(files, removed, contentKey(state));
  }

  /**
   * 处理查看卡片：进入详情时更新 lastViewedAt（仅本地，随下次编辑推送云端）。
   * highlightTokens 为当前搜索关键词（从搜索结果点击进入），详情页用于内容高亮定位；非搜索进入为 null。
   */
  function handleOpenCard(cardId, highlightTokens) {
    const nowIso = new Date().toISOString();
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((cat) => ({
        ...cat,
        cards: cat.cards.map((c) => (c.id === cardId ? { ...c, lastViewedAt: nowIso } : c)),
      })),
    }));
    setActiveCardId(cardId);
    setDetailHighlight(
      Array.isArray(highlightTokens) && highlightTokens.length > 0 ? highlightTokens : null
    );
  }

  /** 新增知识卡片（values: { title, tags, categoryName, content }）；标题可为空，留空时保存为空字符串（不显示标题） */
  function handleCreate(values) {
    const nowIso = new Date().toISOString();
    const title = String(values.title ?? '').trim();
    const tags = normalizeTags(values.tags);
    const content = String(values.content ?? '');
    setState((prev) => {
      const target = findCategory(prev, values.categoryName);
      if (!target) return prev;
      const allCards = prev.categories.flatMap((c) => c.cards);
      const card = {
        id: genCardId(allCards),
        title,
        tags,
        content,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      return {
        ...prev,
        categories: prev.categories.map((c) =>
          c.id === target.id ? { ...c, cards: [...c.cards, card] } : c
        ),
      };
    });
    saveUsage('新增知识', title);
  }

  /** 保存知识卡片修改；切换分类时卡片从原分类文件移动到目标分类文件 */
  function handleUpdate(cardId, values) {
    const nowIso = new Date().toISOString();
    const patch = {
      title: String(values.title ?? '').trim(),
      tags: normalizeTags(values.tags),
      content: String(values.content ?? ''),
      updatedAt: nowIso,
    };
    setState((prev) => {
      const target = findCategory(prev, values.categoryName);
      if (!target) return prev;
      return {
        ...prev,
        categories: prev.categories.map((cat) => {
          if (cat.id === target.id) {
            // 目标分类：跨分类移动时先取原卡片再追加到末尾；否则同一分类内就地更新
            const fromOther = prev.categories
              .filter((c) => c.id !== target.id)
              .flatMap((c) => c.cards.filter((cd) => cd.id === cardId));
            if (fromOther.length > 0) {
              return {
                ...cat,
                cards: [...cat.cards.filter((cd) => cd.id !== cardId), { ...fromOther[0], ...patch }],
              };
            }
            return {
              ...cat,
              cards: cat.cards.map((cd) => (cd.id === cardId ? { ...cd, ...patch } : cd)),
            };
          }
          // 非目标分类：若卡片原本在此则移除（跨分类移动语义）
          return {
            ...cat,
            cards: cat.cards.filter((cd) => cd.id !== cardId),
          };
        }),
      };
    });
    saveUsage('编辑知识', patch.title);
  }

  /** 删除知识卡片 */
  function handleDelete(cardId) {
    const card = entries.find((e) => e.id === cardId);
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((cat) => ({
        ...cat,
        cards: cat.cards.filter((c) => c.id !== cardId),
      })),
    }));
    if (activeCardId === cardId) setActiveCardId(null);
    if (card) {
      messageApi.success(card.title ? `已删除知识「${card.title}」` : '已删除该知识卡片');
    }
    saveUsage('删除知识', card?.title ?? '');
  }

  /** 新建分类；校验失败时提示原因并返回 false */
  function handleAddCategory(name) {
    const trimmed = String(name ?? '').trim();
    const err = validateCategoryName(trimmed, state.categories);
    if (err) {
      messageApi.warning(err);
      return false;
    }
    setState((prev) => ({
      ...prev,
      categories: [...prev.categories, { id: genId(), name: trimmed, cards: [] }],
    }));
    messageApi.success(`已新建分类「${trimmed}」`);
    saveUsage('新建分类', trimmed);
    return true;
  }

  /** 重命名分类（含默认分类，重命名后仍作为兜底分类）；校验失败返回 false */
  function handleRenameCategory(categoryId, name) {
    const trimmed = String(name ?? '').trim();
    const err = validateCategoryName(trimmed, state.categories, categoryId);
    if (err) {
      messageApi.warning(err);
      return false;
    }
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((c) => (c.id === categoryId ? { ...c, name: trimmed } : c)),
    }));
    messageApi.success(`已重命名分类为「${trimmed}」`);
    saveUsage('重命名分类', trimmed);
    return true;
  }

  /** 删除分类（默认分类不可删）；其中卡片移入兜底分类 */
  function handleDeleteCategory(categoryId) {
    const cat = state.categories.find((c) => c.id === categoryId);
    if (!cat || cat.id === state.defaultCategoryId) return;
    const movedCount = cat.cards.length;
    setState((prev) => {
      const target = prev.categories.find((c) => c.id === prev.defaultCategoryId);
      const source = prev.categories.find((c) => c.id === categoryId);
      if (!target || !source || source.id === prev.defaultCategoryId) return prev;
      return {
        ...prev,
        categories: prev.categories
          .filter((c) => c.id !== categoryId)
          .map((c) => (c.id === target.id ? { ...c, cards: [...c.cards, ...source.cards] } : c)),
      };
    });
    if (movedCount > 0) {
      messageApi.info(`分类「${cat.name}」中的 ${movedCount} 张知识已移入默认分类`);
    }
    saveUsage('删除分类', cat.name);
  }

  /** 导入备份：整体替换当前知识库 */
  function handleImport(imported) {
    setState(imported);
    if (activeCardId) setActiveCardId(null);
    const count = imported.categories.reduce((n, c) => n + c.cards.length, 0);
    messageApi.success(`已导入 ${imported.categories.length} 个分类、${count} 张知识卡片`);
    saveUsage('导入备份', `${count} 张知识`);
  }

  const activeCard = entries.find((e) => e.id === activeCardId) ?? null;

  return (
    <div>
      {contextHolder}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '72px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">正在从 Gitee 仓库读取知识库…</Text>
          </div>
        </div>
      ) : (
        <>
          {warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              closable
              style={{ marginBottom: 16 }}
              message="知识库云端文件异常"
              description={
                <div>
                  {warnings.map((w) => (
                    <div key={w.fileName}>
                      「{w.fileName}」{w.kind === 'corrupt' ? '内容损坏' : '缺失'}
                      {w.kind === 'corrupt'
                        ? '，原始内容已备份到浏览器本地（knowledgeBase:v1:cloud-corrupt-backup），该分类暂时为空；修改该分类下任意知识后会自动重建云端文件。'
                        : '，该分类暂时为空；修改该分类下任意知识后会自动重建云端文件。'}
                    </div>
                  ))}
                </div>
              }
            />
          )}
          {activeCard ? (
            <CardDetailView
              key={activeCard.id}
              card={activeCard}
              categories={state.categories}
              defaultCategoryName={
                state.categories.find((c) => c.id === state.defaultCategoryId)?.name ?? ''
              }
              highlightTokens={detailHighlight}
              onBack={() => setActiveCardId(null)}
              onSave={(values) => handleUpdate(activeCard.id, values)}
              onDelete={() => handleDelete(activeCard.id)}
            />
          ) : (
            <CardListView
              entries={entries}
              categories={state.categories}
              defaultCategoryId={state.defaultCategoryId}
              syncState={syncState}
              onOpenCard={handleOpenCard}
              onCreateCard={handleCreate}
              onAddCategory={handleAddCategory}
              onRenameCategory={handleRenameCategory}
              onDeleteCategory={handleDeleteCategory}
              onImport={handleImport}
              onParseImport={parseImported}
              onManualSync={handleManualSync}
            />
          )}
        </>
      )}
    </div>
  );
}
