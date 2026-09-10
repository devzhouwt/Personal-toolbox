import { useEffect, useRef, useState } from 'react';
import { Card, Col, Row, Tooltip, Typography, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import tools from '../tools';

const { Paragraph } = Typography;

/** 卡片描述：超出两行省略；鼠标悬浮时显示完整功能概述 */
function CardDescription({ desc }) {
  const pRef = useRef(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const measure = () => {
      const el = pRef.current;
      if (!el) return;
      // 多行省略为 CSS line-clamp：scrollHeight 含被截断行，大于可视高度即溢出
      setOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const timer = setTimeout(measure, 300); // 字体加载完成后复测
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [desc]);

  return (
    <Tooltip title={overflow ? desc : null} placement="top">
      <div style={{ flex: 1, minWidth: 0 }}>
        <Paragraph
          ref={pRef}
          type="secondary"
          style={{ marginBottom: 0, fontSize: 13 }}
          ellipsis={{ rows: 2 }}
        >
          {desc}
        </Paragraph>
      </div>
    </Tooltip>
  );
}

export default function Home() {
  const navigate = useNavigate();

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        选择下方工具开始使用，工具均在本地浏览器中运行。如你配置了「Gitee 配置」中的仓库，部分工具会把使用记录与存档同步到你自己的 Gitee 仓库，数据不会上传到其他任何服务器。
      </Typography.Paragraph>
      {tools.length === 0 ? (
        <Empty description="暂无工具" />
      ) : (
        <Row gutter={[16, 16]}>
          {tools.map((tool) => (
            <Col xs={24} sm={12} lg={8} xl={6} key={tool.path}>
              <Card
                hoverable
                onClick={() => navigate(tool.path)}
                style={{ height: '100%' }}
                styles={{ body: { display: 'flex', flexDirection: 'column', height: '100%' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: '#e6f4ff',
                      color: '#1677ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    <tool.icon />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Typography.Text strong style={{ fontSize: 15 }}>
                      {tool.name}
                    </Typography.Text>
                  </div>
                </div>
                <CardDescription desc={tool.desc} />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
