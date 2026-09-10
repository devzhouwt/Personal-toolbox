import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { AppstoreAddOutlined, CheckCircleOutlined } from '@ant-design/icons';

const DISMISS_KEY = 'pwa-install-dismissed-at';
// 用户拒绝安装后的冷却期：7 天内不再自动弹窗，避免反复打扰
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** 是否已作为独立应用运行（安装完成后浏览器以 standalone 模式打开） */
function isStandaloneDisplay() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/** 是否处于"暂不安装"冷却期内 */
function isWithinCooldown() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

/** 记录本次拒绝时间（隐私模式下 localStorage 可能不可用，失败则忽略） */
function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // 忽略：无法记录时下次打开仍可能提示
  }
}

/** iOS 且为 Safari：不支持 beforeinstallprompt，需引导手动"添加到主屏幕" */
function isIOSSafari() {
  const ua = window.navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Macintosh') && window.navigator.maxTouchPoints > 1);
  return isIOS && !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(ua);
}

/**
 * PWA 安装提示组件：打开网页后自动识别可安装性并弹窗引导安装
 * - Chromium（桌面/安卓）：监听 beforeinstallprompt，点击"立即安装"调起浏览器原生安装对话框
 * - iOS Safari：延迟弹窗展示"添加到主屏幕"操作指引
 */
export default function PwaInstallPrompt() {
  const deferredPromptRef = useRef(null);
  // 提示类型：prompt=可调起原生安装对话框；ios=展示手动添加指引
  const [mode, setMode] = useState('prompt');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // 已安装或处于拒绝冷却期：不再监听与提示
    if (isStandaloneDisplay() || isWithinCooldown()) return undefined;

    const onBeforeInstallPrompt = (event) => {
      // 阻止浏览器默认的迷你提示条，统一改用应用内弹窗引导
      event.preventDefault();
      deferredPromptRef.current = event;
      setMode('prompt');
      setOpen(true);
    };
    const onAppInstalled = () => {
      // 安装成功：清理状态与拒绝记录，后续不再提示
      deferredPromptRef.current = null;
      setOpen(false);
      try {
        window.localStorage.removeItem(DISMISS_KEY);
      } catch {
        // 忽略
      }
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    // iOS Safari 不会触发 beforeinstallprompt：延迟弹窗展示安装指引
    let iosTimer;
    if (isIOSSafari()) {
      iosTimer = window.setTimeout(() => {
        setMode('ios');
        setOpen(true);
      }, 1500);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.clearTimeout(iosTimer);
    };
  }, []);

  /** 点击"立即安装"：先关闭本弹窗，再调起浏览器原生安装对话框 */
  const handleInstall = async () => {
    const promptEvent = deferredPromptRef.current;
    deferredPromptRef.current = null;
    setOpen(false);
    if (!promptEvent) return;
    try {
      promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      // 用户在原生安装对话框中取消：进入冷却期，避免下次打开又弹窗
      if (outcome === 'dismissed') markDismissed();
    } catch (err) {
      // 事件已失效（如被其他流程消费）等异常：静默忽略，不影响页面使用
      console.warn('PWA 安装提示调起失败', err);
    }
  };

  /** 点击"暂不安装"或关闭弹窗：记录拒绝时间，进入冷却期 */
  const handleLater = () => {
    markDismissed();
    setOpen(false);
  };

  return (
    <Modal
      open={open}
      onCancel={handleLater}
      width={380}
      centered
      title={mode === 'ios' ? '添加到主屏幕' : '安装「个人工具箱」到桌面'}
      footer={
        mode === 'ios'
          ? [
              <Button key="ok" type="primary" onClick={handleLater}>
                我知道了
              </Button>,
            ]
          : [
              <Button key="later" onClick={handleLater}>
                暂不安装
              </Button>,
              <Button
                key="install"
                type="primary"
                icon={<AppstoreAddOutlined />}
                onClick={handleInstall}
              >
                立即安装
              </Button>,
            ]
      }
    >
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', paddingTop: 8 }}>
        <img
          src={`${import.meta.env.BASE_URL}pwa-192x192.png`}
          alt="应用图标"
          style={{ width: 56, height: 56, flexShrink: 0 }}
        />
        {mode === 'ios' ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            点击浏览器底部「分享」按钮，选择「添加到主屏幕」，即可像 App 一样打开本工具。
          </Typography.Paragraph>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              '从桌面一键直达，像原生应用一样打开',
              '独立窗口运行，不受浏览器地址栏干扰',
              '支持离线访问已缓存的内容',
            ].map((text) => (
              <span key={text}>
                <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                {text}
              </span>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
