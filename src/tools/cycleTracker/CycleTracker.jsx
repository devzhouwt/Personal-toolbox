import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Spin, Typography, message } from 'antd';
import { isGiteeConfigured, getToolHistory, recordToolUsage } from '../../services/history';
import {
  loadData,
  saveData,
  readGiteeArchive,
  writeGiteeArchive,
  genId,
} from './storage';
import CalendarList from './CalendarList';
import CalendarDetail from './CalendarDetail';

const { Text } = Typography;

/** 工具存档目录名（对应 Gitee 仓库 history/ 下的子目录） */
const TOOL_ID = 'cycle-tracker';

/** 数据快照（JSON 字符串），用于判断数据是否变化、是否已同步 */
const snapshot = (calendars) => JSON.stringify({ calendars });

/**
 * 周期记录与预测：数据状态管理与视图切换的入口。
 * 存档以 Gitee 仓库为主（history/cycle-tracker/data.json，写入时自动创建目录与文件），
 * 每次进入本工具时从 Gitee 读取；浏览器 localStorage 为离线缓存：
 * - 未配置 Gitee → 本地模式，变更仅写 localStorage；
 * - 已配置 Gitee → 进入时读取远程存档：仓库尚无存档（首次使用）时自动创建空存档；
 *   若浏览器本地缓存有旧数据，则弹窗询问「上传本地存档 / 忽略本地新建空档」；
 *   之后每次数据变更自动推送（串行队列避免并发写冲突）。
 *   云端不可用（读取/写入失败，如令牌失效、断网）时回退浏览器本地存档并明确提示。
 * 关键操作（建日历/加事件/记日期）同时按项目惯例追加为 Gitee 使用历史。
 */
export default function CycleTracker() {
  const [messageApi, contextHolder] = message.useMessage();
  const [calendars, setCalendars] = useState([]);
  const [activeId, setActiveId] = useState(null);
  // 已配置 Gitee 时需要先拉取存档再展示；本地模式无需加载
  const [loading, setLoading] = useState(isGiteeConfigured());
  // 存档同步状态：local | ok | syncing | error
  const [syncState, setSyncState] = useState('local');
  const [historyRecords, setHistoryRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  // 初始化（拉取存档）完成前不触发自动持久化
  const initializedRef = useRef(false);
  // 与当前云端一致的快照：快照相同则无需再推送
  const syncedSnapshotRef = useRef('');
  // Gitee 写入串行队列，防止连续快速变更导致并发写冲突
  const writeQueueRef = useRef(Promise.resolve());
  // 本次会话是否已提示过同步失败（避免连续操作时重复弹窗）
  const syncErrorNotifiedRef = useRef(false);
  // 云端本会话不可用（读取或写入失败）：不再尝试推送，仅保留本地，重进后自动恢复重试
  const cloudUnavailableRef = useRef(false);

  /** 进入工具时的初始化：从 Gitee 拉取存档（未配置则直接使用本地缓存） */
  useEffect(() => {
    let cancelled = false;

    /**
     * 仓库尚无存档时的首次初始化：把结果写入 Gitee（自动建目录/文件）。
     * 本地缓存有旧数据时弹窗让用户选择数据源，避免未经确认就迁移或丢弃；
     * @returns {Promise<{ calendars: Array|null, uploaded?: boolean, error?: Error }>}
     *   calendars 为 null 表示云端写入失败，由调用方统一降级处理。
     */
    function askFirstInit(localData) {
      return new Promise((resolve) => {
        if (localData.calendars.length === 0) {
          // 仓库与本地均无数据：直接创建空存档（无需询问）
          writeGiteeArchive([])
            .then(() => resolve({ calendars: [], uploaded: false }))
            .catch((error) => resolve({ calendars: null, error }));
          return;
        }
        Modal.confirm({
          title: '初始化云端存档',
          content: (
            <span>
              仓库中还没有本工具的存档，但浏览器本地缓存中有{' '}
              <Text strong>{localData.calendars.length}</Text> 个日历。
              <br />
              要上传为首次存档，还是忽略本地数据、从空存档开始？
            </span>
          ),
          okText: '上传本地存档',
          cancelText: '忽略本地，新建空档',
          maskClosable: false,
          keyboard: false,
          onOk: () =>
            writeGiteeArchive(localData.calendars)
              .then(() => resolve({ calendars: localData.calendars, uploaded: true }))
              .catch((error) => resolve({ calendars: null, error })),
          onCancel: () =>
            writeGiteeArchive([])
              .then(() => resolve({ calendars: [], uploaded: false }))
              .catch((error) => resolve({ calendars: null, error })),
        });
      });
    }

    async function init() {
      const local = loadData();
      if (local.recovered) {
        messageApi.warning('本地存档已损坏，已自动重置为空数据（原内容备份在浏览器 localStorage 的 cycleTracker:v1:corrupt-backup 中）');
      }
      if (!isGiteeConfigured()) {
        // 本地模式
        syncedSnapshotRef.current = snapshot(local.calendars);
        initializedRef.current = true;
        setCalendars(local.calendars);
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
          if (result.calendars === null) throw result.error; // 写入失败：按云端不可用降级
          syncedSnapshotRef.current = snapshot(result.calendars);
          setCalendars(result.calendars);
          saveData({ calendars: result.calendars }); // 刷新本地缓存与云端一致
          messageApi.success(
            result.uploaded
              ? `已将本地 ${local.calendars.length} 个日历上传为云端存档`
              : '已创建云端空存档，可以开始记录了'
          );
        } else {
          // 以 Gitee 存档为准，并刷新本地缓存
          syncedSnapshotRef.current = snapshot(remote.calendars);
          setCalendars(remote.calendars);
          saveData({ calendars: remote.calendars });
        }
        setSyncState('ok');
      } catch (err) {
        if (cancelled) return;
        // 云端不可用（读取或首次写入失败，如令牌失效/断网）：本次会话改用浏览器本地存档
        cloudUnavailableRef.current = true;
        syncedSnapshotRef.current = snapshot(local.calendars);
        setCalendars(local.calendars);
        setSyncState('error');
        messageApi.warning(
          `Gitee 仓库不可用：${err.message}。已改用浏览器本地存档继续，修改仅保存在本地；` +
            '请检查右上角「Gitee 配置」后重新进入本工具，以恢复云端同步。'
        );
      } finally {
        if (!cancelled) {
          initializedRef.current = true;
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
    if (!initializedRef.current) return;
    const snap = snapshot(calendars);
    if (snap === syncedSnapshotRef.current) return; // 初始化加载或已同步，无实质变化

    saveData({ calendars }); // 本地缓存始终即时更新
    if (!isGiteeConfigured() || cloudUnavailableRef.current) {
      // 本地模式或云端本会话不可用：修改仅保留在本地缓存
      syncedSnapshotRef.current = snap;
      return;
    }
    enqueueWrite(calendars, snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendars]);

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
          messageApi.warning(`Gitee 存档同步失败，修改仍保留在本地，下次变更时会自动重试：${err.message}`);
        }
      });
  }

  /** 从 Gitee 仓库加载本工具的使用历史（未配置时不报错） */
  async function loadHistory() {
    if (!isGiteeConfigured()) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const data = await getToolHistory(TOOL_ID);
      setHistoryRecords(data?.records ?? []);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  /** 追加使用历史到 Gitee 仓库（未配置或失败均静默，不阻断主流程） */
  async function saveUsage(action, title) {
    try {
      await recordToolUsage(TOOL_ID, { action, title });
    } catch {
      // 历史同步失败不影响工具使用
    }
  }

  /** 更新某日历（不可变 patch 合并） */
  const patchCalendar = useCallback((id, patch) => {
    setCalendars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  }, []);

  /** 新建日历并进入 */
  async function handleCreate(name) {
    const calendar = {
      id: genId(),
      name,
      createdAt: new Date().toISOString(),
      events: [],
      records: [],
    };
    setCalendars((prev) => [...prev, calendar]);
    setActiveId(calendar.id);
    // 创建后视图立即切到详情页，因此在本组件（常驻 context）内提示
    messageApi.success(`已创建日历「${name}」`);
    await saveUsage('新建日历', name);
  }

  /** 重命名日历 */
  async function handleRename(id, name) {
    patchCalendar(id, { name });
    await saveUsage('重命名日历', name);
  }

  /** 删除日历（含其全部事件与记录） */
  async function handleDelete(id) {
    const cal = calendars.find((c) => c.id === id);
    setCalendars((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
    if (cal) messageApi.success(`已删除日历「${cal.name}」`);
    await saveUsage('删除日历', cal?.name ?? '');
  }

  /** 导入存档：整体替换当前数据（随后自动持久化推送） */
  async function handleImport(imported) {
    setCalendars(imported);
    await saveUsage('导入存档', `共 ${imported.length} 个日历`);
  }

  // 每次进入工具时校验 activeId 有效性（日历可能已被删除）
  useEffect(() => {
    if (activeId && !calendars.some((c) => c.id === activeId)) {
      setActiveId(null);
    }
  }, [calendars, activeId]);

  const activeCalendar = calendars.find((c) => c.id === activeId) ?? null;

  return (
    <div>
      {contextHolder}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '72px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>
            <Text type="secondary">正在从 Gitee 仓库读取存档…</Text>
          </div>
        </div>
      ) : activeCalendar ? (
        <CalendarDetail
          key={activeCalendar.id}
          calendar={activeCalendar}
          onBack={() => setActiveId(null)}
          onPatch={patchCalendar}
          onDelete={handleDelete}
          onUsage={saveUsage}
        />
      ) : (
        <CalendarList
          calendars={calendars}
          syncState={syncState}
          onCreate={handleCreate}
          onRename={handleRename}
          onDelete={handleDelete}
          onOpen={setActiveId}
          onImport={handleImport}
          historyRecords={historyRecords}
          historyLoading={historyLoading}
          historyError={historyError}
        />
      )}
    </div>
  );
}
