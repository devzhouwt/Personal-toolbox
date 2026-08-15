import { Card, Col, Row, Typography, Empty } from 'antd';
import { useNavigate } from 'react-router-dom';
import tools from '../tools';

const { Paragraph } = Typography;

export default function Home() {
  const navigate = useNavigate();

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        选择下方工具开始使用，所有工具均在你本地浏览器中运行，图片等数据不会上传到任何服务器。
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
                <Paragraph
                  type="secondary"
                  style={{ marginBottom: 0, fontSize: 13, flex: 1 }}
                  ellipsis={{ rows: 2 }}
                >
                  {tool.desc}
                </Paragraph>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
