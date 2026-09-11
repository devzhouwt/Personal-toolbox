import { useEffect, useRef, useState } from 'react';
import { Modal, Spin, Typography, message } from 'antd';
import { isGiteeConfigured, recordToolUsage } from '../../services/history';
import { fmtMoney, genId, itemLabel, itemStats, round2 } from './loanCore';
import { loadData, readGiteeArchive, saveData, writeGiteeArchive } from './loanStorage';
import LoanListView from './LoanListView';
import LoanDetailView from './LoanDetailView';

const { Text } = Typography;

/** 工具存档目录名（对应 Gitee 仓库 history/ 下的子目录，也用于使用历史） */
const TOOL_ID = 'loan-ledger';

/** 数据快照（JSON 字符串），用于判断数据是否变化、是否已同步 */
const snapshot = (items) => JSON.stringify({ items });

/**
 * 借贷账簿：数据状态管理与视图切换的入口。
 * 存档以 Gitee 仓库为主（history/loan-ledger/data.json，写入时自动创建目录与文件），
 * 每次进入本工具时从 Gitee 读取；浏览器 localStorage（loanLedger:v1）为离线缓存：
 * - 未配置 Gitee → 本地模式，变更仅写 localStorage；
 * - 已配置 Gitee → 进入时读取远程存档：仓库尚无存档（首次使用）时自动创建空存档；
 *   若浏览器本地缓存有旧数据，则弹窗询问「上传本地账簿 / 忽略本地新建空档」；
 *   之后每次数据变更自动推送（串行队列避免并发写冲突）。
 *   云端不可用（读取/写入失败，如令牌失效、断网）时回退浏览器本地存档并明确提示。
 * 关键操作（新建/编辑/删除借贷事项与还款记录、导入）按项目惯例追加 Gitee 使用历史，
 * 历史写入在后台独立串行队列中异步进行，不阻塞界面操作。
 */
export default function LoanLedger() {
  const [messageApi, contextHolder] = message.useMessage();
  const [items, setItems] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // 已配置 Gitee 时需要先拉取存档再展示；本地模式无需加载
  const [loading, setLoading] = useState(isGiteeConfigured());
  // 存档同步状态：local | ok | syncing | writeError | error（error = 云端不可用已降级）
  const [syncState, setSyncState] = useState('local');

  // 状态与存档基线对齐（初始化完成）后才启用自动持久化，由持久化副作用置位：
  // 初始化在部分路径下于本轮 commit 内同步完成并注入新状态，若此时立即持久化
  // 会读到本轮渲染的旧状态（空数组），覆盖本地缓存导致刷新后数据丢失
  const initializedRef = useRef(false);
  // 与当前云端一致的快照：快照相同则无需再推送
  const syncedSnapshotRef = useRef('');
  // Gitee 写入串行队列，防止连续快速变更导致并发写冲突
  const writeQueueRef = useRef(Promise.resolve());
  // 使用历史写入队列（与账簿存档队列相互独立）：后台按序写入 history.json，
  // 避免连续操作时同一文件的读-改-写竞争导致历史记录丢失
  const usageQueueRef = useRef(Promise.resolve());
  // 本次会话是否已提示过同步失败（避免连续操作时重复弹窗）
  const syncErrorNotifiedRef = useRef(false);
  // 云端本会话不可用（读取或写入失败）：不再尝试推送，仅保留本地
  const cloudUnavailableRef = useRef(false);

  /** 进入工具时的初始化：从 Gitee 拉取存档（未配置则直接使用本地缓存） */
  useEffect(() => {
    let cancelled = false;

    /**
     * 仓库尚无存档时的首次初始化：把结果写入 Gitee（自动建目录/文件）。
     * 本地缓存有旧数据时弹窗让用户选择数据源，避免未经确认就迁移或丢弃；
     * @returns {Promise<{ items: Array|null, uploaded?: boolean, error?: Error }>}
     *   items 为 null 表示云端写入失败，由调用方统一降级处理。
     */
    function askFirstInit(localData) {
      return new Promise((resolve) => {
        if (localData.items.length === 0) {
          // 仓库与本地均无数据：直接创建空存档（无需询问）
          writeGiteeArchive([])
            .then(() => resolve({ items: [], uploaded: false }))
            .catch((error) => resolve({ items: null, error }));
          return;
        }
        Modal.confirm({
          title: '初始化云端账簿',
          content: (
            <span>
              仓库中还没有本工具的存档，但浏览器本地缓存中有{' '}
              <Text strong>{localData.items.length}</Text> 条借贷事项。
              <br />
              要上传为首次存档，还是忽略本地数据、从空账簿开始？
            </span>
          ),
          okText: '上传本地账簿',
          cancelText: '忽略本地，新建空账簿',
          maskClosable: false,
          keyboard: false,
          onOk: () =>
            writeGiteeArchive(localData.items)
              .then(() => resolve({ items: localData.items, uploaded: true }))
              .catch((error) => resolve({ items: null, error })),
          onCancel: () =>
            writeGiteeArchive([])
              .then(() => resolve({ items: [], uploaded: false }))
              .catch((error) => resolve({ items: null, error })),
        });
      });
    }

    async function init() {
      const local = loadData();
      if (local.recovered) {
        messageApi.warning(
          '本地账簿数据已损坏，已自动重置为空数据（原内容备份在浏览器 localStorage 的 loanLedger:v1:corrupt-backup 中）'
        );
      }
      if (!isGiteeConfigured()) {
        // 本地模式
        syncedSnapshotRef.current = snapshot(local.items);
        setItems(local.items);
        setSyncState('local');
        setLoading(false);
        return;
      }

      try {
        const remote = await readGiteeArchive();
        if (cancelled) return;
        if (remote.status === 'empty') {
          // 仓库中尚无存档：首次使用。写成功后仓库中即出现 data.json（目录自动创建）
          const result = await askFirstInit(local);
          if (cancelled) return;
          if (result.items === null) throw result.error; // 写入失败：按云端不可用降级
          syncedSnapshotRef.current = snapshot(result.items);
          setItems(result.items);
          saveData(result.items); // 刷新本地缓存与云端一致
          messageApi.success(
            result.uploaded
              ? `已将本地 ${local.items.length} 条借贷事项上传为云端存档`
              : '已创建云端空账簿，可以开始记录了'
          );
        } else {
          // 以 Gitee 存档为准，并刷新本地缓存
          syncedSnapshotRef.current = snapshot(remote.items);
          setItems(remote.items);
          saveData(remote.items);
        }
        setSyncState('ok');
      } catch (err) {
        if (cancelled) return;
        // 云端不可用（读取或首次写入失败，如令牌失效/断网）：本次会话改用浏览器本地存档
        cloudUnavailableRef.current = true;
        syncedSnapshotRef.current = snapshot(local.items);
        setItems(local.items);
        setSyncState('error');
        messageApi.warning(
          `Gitee 仓库不可用：${err.message}。已改用浏览器本地账簿继续，修改仅保存在本地；` +
            '请检查右上角「Gitee 配置」后重新进入本工具，以恢复云端同步。'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [messageApi]);

  /** 数据变更后的持久化：先写本地缓存，再串行推送 Gitee */
  useEffect(() => {
    const snap = snapshot(items);
    if (snap === syncedSnapshotRef.current) {
      // 状态已与存档基线一致（初始化加载完成或已同步）：正式进入变更跟踪
      initializedRef.current = true;
      return;
    }
    // 初始化尚未完成时忽略本轮的旧状态（初始化注入新状态的同轮 commit 中，
    // 持久化副作用仍会读到旧值，直接写入会覆盖本地缓存）
    if (!initializedRef.current) return;

    saveData(items); // 本地缓存始终即时更新
    if (!isGiteeConfigured() || cloudUnavailableRef.current) {
      // 本地模式或云端本会话不可用：修改仅保留在本地缓存
      syncedSnapshotRef.current = snap;
      return;
    }
    enqueueWrite(items, snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  /** 将一次全量数据写入加入串行队列，保证推送顺序与成功状态反馈 */
  function enqueueWrite(data, snap) {
    writeQueueRef.current = writeQueueRef.current
      .then(() => writeGiteeArchive(data))
      .then(() => {
        syncedSnapshotRef.current = snap;
        setSyncState('ok');
        syncErrorNotifiedRef.current = false;
      })
      .catch((err) => {
        // 不标记会话不可用：下次变更会自动重试推送（成功即恢复已同步状态）
        setSyncState('writeError');
        if (!syncErrorNotifiedRef.current) {
          syncErrorNotifiedRef.current = true;
          messageApi.warning(
            `Gitee 账簿同步失败，修改仍保留在本地，下次变更时会自动重试：${err.message}`
          );
        }
      });
  }

  /** 追加使用历史到 Gitee 仓库：入队即返回（调用方无需等待；未配置或失败均静默，不阻断界面操作） */
  function saveUsage(action, title) {
    usageQueueRef.current = usageQueueRef.current.then(() =>
      recordToolUsage(TOOL_ID, { action, title }).catch((err) => {
        // 失败由 catch 消化保证队列链不断；历史写入失败不影响工具使用
        console.warn('借贷账簿使用历史写入失败', err);
      })
    );
  }

  /** 新建借贷事项：自动生成唯一 uid 与创建日期，创建后进入详情页 */
  function handleCreate(values) {
    const nowIso = new Date().toISOString();
    const item = {
      id: genId(),
      lender: values.lender,
      borrower: values.borrower,
      amount: round2(values.amount),
      loanDate: values.loanDate ?? null,
      paymentMethod: values.paymentMethod ?? '',
      dueDate: values.dueDate ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
      repayments: [],
    };
    setItems((prev) => [...prev, item]);
    setActiveId(item.id);
    messageApi.success(`已创建借贷事项「${itemLabel(item)}」`);
    saveUsage('新建借贷', itemLabel(item));
  }

  /** 编辑事项基本信息（出借人/借款人/总金额/出借日期/支付方式/还款日期） */
  function handleUpdateItem(id, values) {
    const nowIso = new Date().toISOString();
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...values, updatedAt: nowIso } : it)));
    messageApi.success('已更新借贷事项');
    saveUsage('编辑借贷', itemLabel(values));
  }

  /** 删除借贷事项（含其全部还款记录） */
  function handleDeleteItem(id) {
    const item = items.find((it) => it.id === id);
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (activeId === id) setActiveId(null);
    if (item) messageApi.success(`已删除借贷事项「${itemLabel(item)}」`);
    saveUsage('删除借贷', item ? itemLabel(item) : '');
  }

  /** 记录一笔还款（金额上限校验已由弹窗完成；结清状态自动重算） */
  function handleAddRepayment(itemId, values) {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    const before = itemStats(item);
    const nowIso = new Date().toISOString();
    const repayment = {
      id: genId(),
      date: values.date,
      amount: round2(values.amount),
      paymentMethod: values.paymentMethod ?? '',
      createdAt: nowIso,
    };
    const updated = { ...item, repayments: [...item.repayments, repayment], updatedAt: nowIso };
    const after = itemStats(updated);
    setItems((prev) => prev.map((it) => (it.id === itemId ? updated : it)));
    messageApi.success(
      !before.settled && after.settled
        ? `已记录还款 ¥${fmtMoney(repayment.amount)}，该借贷事项已结清`
        : `已记录还款 ¥${fmtMoney(repayment.amount)}`
    );
    saveUsage('记录还款', `${itemLabel(item)}｜¥${fmtMoney(repayment.amount)}`);
  }

  /** 编辑还款记录（金额上限校验已由弹窗完成） */
  function handleUpdateRepayment(itemId, repaymentId, values) {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              repayments: it.repayments.map((r) =>
                r.id === repaymentId
                  ? {
                      ...r,
                      date: values.date,
                      amount: round2(values.amount),
                      paymentMethod: values.paymentMethod ?? '',
                    }
                  : r
              ),
              updatedAt: nowIso,
            }
          : it
      )
    );
    messageApi.success('已更新还款记录');
    saveUsage('编辑还款', `${itemLabel(item)}｜${values.date} ¥${fmtMoney(values.amount)}`);
  }

  /** 删除还款记录（剩余金额与结清状态随之自动重算） */
  function handleDeleteRepayment(itemId, repaymentId) {
    const item = items.find((it) => it.id === itemId);
    const repayment = item?.repayments.find((r) => r.id === repaymentId);
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              repayments: it.repayments.filter((r) => r.id !== repaymentId),
              updatedAt: new Date().toISOString(),
            }
          : it
      )
    );
    if (repayment) messageApi.success(`已删除 ${repayment.date} 的还款记录`);
    saveUsage('删除还款', item ? `${itemLabel(item)}｜${repayment?.date ?? ''}` : '');
  }

  /** 导入账簿：整体替换当前数据（随后自动持久化推送） */
  function handleImport(imported) {
    setItems(imported);
    if (activeId) setActiveId(null);
    saveUsage('导入账簿', `共 ${imported.length} 条借贷事项`);
  }

  // 每次进入工具时校验 activeId 有效性（事项可能已被删除/导入覆盖）
  useEffect(() => {
    if (activeId && !items.some((it) => it.id === activeId)) {
      setActiveId(null);
    }
  }, [items, activeId]);

  const activeItem = items.find((it) => it.id === activeId) ?? null;

  return (
    <div>
      {contextHolder}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '72px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">正在从 Gitee 仓库读取借贷账簿…</Text>
          </div>
        </div>
      ) : activeItem ? (
        <LoanDetailView
          key={activeItem.id}
          item={activeItem}
          onBack={() => setActiveId(null)}
          onUpdate={(values) => handleUpdateItem(activeItem.id, values)}
          onDelete={() => handleDeleteItem(activeItem.id)}
          onAddRepayment={handleAddRepayment}
          onUpdateRepayment={handleUpdateRepayment}
          onDeleteRepayment={handleDeleteRepayment}
        />
      ) : (
        <LoanListView
          items={items}
          syncState={syncState}
          onCreate={handleCreate}
          onUpdate={handleUpdateItem}
          onDelete={handleDeleteItem}
          onOpen={setActiveId}
          onImport={handleImport}
        />
      )}
    </div>
  );
}
