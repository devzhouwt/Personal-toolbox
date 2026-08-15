import { Route, Routes } from 'react-router-dom';
import { Layout, Menu, Typography, theme } from 'antd';
import {
  HomeOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import tools from './tools';
import Home from './pages/Home';

const { Header, Sider, Content } = Layout;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
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
          }}
        >
          <Typography.Title level={4} style={{ margin: 0 }}>
            {location.pathname === '/'
              ? '首页'
              : tools.find((tool) => location.pathname.startsWith(tool.path))?.name ?? '个人工具箱'}
          </Typography.Title>
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
    </Layout>
  );
}
