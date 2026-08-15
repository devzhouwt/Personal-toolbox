import { Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import { Button, Layout, Menu, Tag, Tooltip, Typography, theme } from 'antd';
import {
  CloudServerOutlined,
  HomeOutlined,
  SettingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import tools from './tools';
import Home from './pages/Home';
import GiteeSettings from './components/GiteeSettings';
import { isGiteeConfigured } from './services/history';

const { Header, Sider, Content } = Layout;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [giteeReady, setGiteeReady] = useState(isGiteeConfigured());
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
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
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: colorBgContainer,
            padding: '0 24px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {location.pathname === '/'
              ? '首页'
              : tools.find((tool) => location.pathname.startsWith(tool.path))?.name ?? '个人工具箱'}
          </Typography.Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {giteeReady ? (
              <Tooltip title="工具使用历史将同步到该 Gitee 仓库">
                <Tag icon={<CloudServerOutlined />} color="success">
                  历史同步已开启
                </Tag>
              </Tooltip>
            ) : (
              <Tooltip title="配置 Gitee 仓库后，工具使用历史将自动保存">
                <Tag icon={<CloudServerOutlined />}>未配置历史存储</Tag>
              </Tooltip>
            )}
            <Button
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            >
              Gitee 配置
            </Button>
          </div>
        </Header>
        <Content
          style={{
            margin: 24,
            padding: 24,
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
    </Layout>
  );
}
