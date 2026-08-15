import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Tag,
  message,
} from 'antd';
import {
  ApiOutlined,
  DeleteOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  clearGiteeConfig,
  getGiteeConfig,
  getRepoInfo,
  saveGiteeConfig,
} from '../services/gitee';

/**
 * Gitee 仓库配置弹窗：仓库所有者 / 仓库名 / 私人令牌。
 * 配置保存在浏览器 localStorage 中，用于将工具使用历史存入指定仓库。
 */
export default function GiteeSettings({ open, onClose, onChanged }) {
  const [form] = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { fullName, defaultBranch } | { error }
  const [messageApi, contextHolder] = message.useMessage();

  // 打开弹窗时回填已保存的配置
  useEffect(() => {
    if (!open) return;
    const config = getGiteeConfig();
    setTestResult(null);
    if (config) {
      form.setFieldsValue({
        owner: config.owner,
        repo: config.repo,
        token: config.token,
      });
    } else {
      form.resetFields();
    }
  }, [open, form]);

  /** 读取表单字段（不校验，供测试/保存使用） */
  function getFormValues() {
    return form.getFieldsValue(['owner', 'repo', 'token']);
  }

  /** 测试连接：验证仓库存在且令牌可用 */
  async function handleTest() {
    const { owner, repo, token } = getFormValues();
    if (!owner || !repo || !token) {
      messageApi.warning('请先填写完整的仓库信息');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const info = await getRepoInfo(owner.trim(), repo.trim(), token.trim());
      setTestResult({ fullName: info.fullName, defaultBranch: info.defaultBranch });
      messageApi.success('连接成功');
    } catch (err) {
      setTestResult({ error: err.message });
      messageApi.error(`连接失败：${err.message}`);
    } finally {
      setTesting(false);
    }
  }

  /** 保存配置到 localStorage */
  function handleSave() {
    const { owner, repo, token } = getFormValues();
    if (!owner || !repo || !token) {
      messageApi.warning('请先填写完整的仓库信息');
      return;
    }
    saveGiteeConfig({
      owner: owner.trim(),
      repo: repo.trim(),
      token: token.trim(),
      branch: testResult?.defaultBranch ?? getGiteeConfig()?.branch ?? 'master',
    });
    messageApi.success('配置已保存');
    onChanged?.();
    onClose();
  }

  /** 清除本地配置 */
  function handleClear() {
    clearGiteeConfig();
    form.resetFields();
    setTestResult(null);
    messageApi.success('配置已清除');
    onChanged?.();
    onClose();
  }

  return (
    <>
      {contextHolder}
      <Modal
        title="Gitee 仓库配置"
        open={open}
        onCancel={onClose}
        footer={
          <Space>
            <Button danger icon={<DeleteOutlined />} onClick={handleClear}>
              清除配置
            </Button>
            <Button icon={<ApiOutlined />} loading={testing} onClick={handleTest}>
              测试连接
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>
              保存配置
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="配置说明"
          description="工具使用历史将存储在你指定的 Gitee 仓库中（history/ 目录下按工具分文件夹）。令牌仅保存在本浏览器 localStorage 中，生成令牌时请勾选 projects 权限。"
        />
        <Form form={form} layout="vertical" style={{ marginTop: 4 }}>
          <Form.Item label="仓库所有者" name="owner" required tooltip="Gitee 用户名或组织名">
            <Input placeholder="例如：devzhouwt" />
          </Form.Item>
          <Form.Item label="仓库名" name="repo" required tooltip="仓库地址中的仓库名称">
            <Input placeholder="例如：personal-toolbox" />
          </Form.Item>
          <Form.Item
            label="私人令牌"
            name="token"
            required
            tooltip="Gitee 个人设置 → 私人令牌 → 生成新令牌，勾选 projects 权限"
          >
            <Input.Password placeholder="粘贴私人令牌（access_token）" />
          </Form.Item>
        </Form>
        {testResult && (
          <div style={{ marginBottom: 8 }}>
            {testResult.error ? (
              <Tag color="error">连接失败：{testResult.error}</Tag>
            ) : (
              <Tag color="success">
                连接成功：{testResult.fullName}（默认分支 {testResult.defaultBranch}）
              </Tag>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
