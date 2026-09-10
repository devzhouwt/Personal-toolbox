import { Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button, Grid, Layout, Menu, Tag, Tooltip, Typography, theme } from 'antd';
import {
  CloudServerOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import tools from './tools';
import Home from './pages/Home';
import GiteeSettings from './components/GiteeSettings';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import { isGiteeConfigured } from './services/history';

const { Header, Sider, Content } = Layout;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [giteeReady, setGiteeReady] = useState(isGiteeConfigured());
  // 左侧导航默认隐藏：点击页头按钮展开，进入具体功能页后自动收起
  const [navOpen, setNavOpen] = useState(false);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  // 视口宽度按 md 断点判断：手机端使用紧凑布局与浮层导航，桌面端保持现状
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  // 侧边栏菜单项：首页 + 各工具
  const menuItems = [
    { key: '/', icon: <HomeOutlined />, label: '首页' },
    {
      key: 'tools-group',
      icon: <ToolOutlined />,
      label: '全部工具',
      children: tools.map((tool) => ({
        key: tool.path,
        icon: <tool.icon />,
        label: tool.name,
      })),
    },
  ];

  const selectedKey =
    location.pathname === '/'
      ? '/'
      : tools.find((tool) => location.pathname.startsWith(tool.path))?.path;

  // 路由切换（选择菜单或首页卡片进入新页面）后自动收起导航
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        theme="light"
        collapsible
        collapsed={!navOpen}
        collapsedWidth={0}
        trigger={null}
        style={{
          borderRight: navOpen ? '1px solid #f0f0f0' : 'none',
          // 手机端导航以浮层覆盖页面（不挤压内容），桌面端保持推挤式布局
          ...(isMobile
            ? { position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 1000 }
            : null),
          boxShadow: isMobile && navOpen ? '2px 0 8px rgba(0, 0, 0, 0.15)' : undefined,
        }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontSize: 17,
            fontWeight: 600,
            color: '#1677ff',
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          <ToolOutlined />
          个人工具箱
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          defaultOpenKeys={['tools-group']}
          items={menuItems}
          onClick={({ key }) => {
            navigate(key);
            setNavOpen(false); // 点选菜单进入页面后立即收起导航
          }}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      {/* 手机端导航浮层打开时的遮罩：点击任意空白处收起 */}
      {isMobile && navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            background: 'rgba(0, 0, 0, 0.45)',
            zIndex: 999,
          }}
        />
      )}
      <Layout>
        <Header
          style={{
            background: colorBgContainer,
            padding: isMobile ? '0 12px' : '0 24px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Button
              type="text"
              title={navOpen ? '收起导航' : '展开导航'}
              icon={navOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
              onClick={() => setNavOpen((v) => !v)}
            />
            <Typography.Title level={4} style={{ margin: 0 }}>
              {location.pathname === '/'
                ? '首页'
                : tools.find((tool) => location.pathname.startsWith(tool.path))?.name ?? '个人工具箱'}
            </Typography.Title>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {giteeReady ? (
              <Tooltip title="工具使用历史将同步到该 Gitee 仓库">
                <Tag icon={<CloudServerOutlined />} color="success">
                  {isMobile ? null : '历史同步已开启'}
                </Tag>
              </Tooltip>
            ) : (
              <Tooltip title="配置 Gitee 仓库后，工具使用历史将自动保存">
                <Tag icon={<CloudServerOutlined />}>{isMobile ? null : '未配置历史存储'}</Tag>
              </Tooltip>
            )}
            <Button
              icon={<SettingOutlined />}
              title="Gitee 配置"
              onClick={() => setSettingsOpen(true)}
            >
              {isMobile ? null : 'Gitee 配置'}
            </Button>
          </div>
        </Header>
        <Content
          style={{
            margin: isMobile ? 12 : 24,
            padding: isMobile ? 12 : 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
          }}
        >
          <Routes>
            <Route path="/" element={<Home />} />
            {tools.map((tool) => (
              <Route key={tool.path} path={tool.path} element={<tool.component />} />
            ))}
            <Route path="*" element={<Home />} />
          </Routes>
        </Content>
      </Layout>
      <GiteeSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => setGiteeReady(isGiteeConfigured())}
      />
      {/* PWA 安装提示：检测到可安装时自动弹窗引导 */}
      <PwaInstallPrompt />
    </Layout>
  );
}
