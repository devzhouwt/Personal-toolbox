import { useMemo } from 'react';
import { Form, Input, Modal, Select } from 'antd';

const { TextArea } = Input;

/**
 * 新建/编辑知识卡片共用弹窗。
 *
 * 表单值：title（可选，0~100 字符，留空由入口层兜底为「未命名知识」）、tags（Select mode="tags"，1~20 个、每个 1~30 字符，
 * 由 knowledgeBase 入口层 normalizeTags 负责去重/裁剪兜底）、categoryName（Select，默认选中
 * 默认分类）、content（富文本/纯文本，必填）。校验通过后调用 onFinish，由父级闭包决定
 * 是新增（handleCreate）还是编辑（handleUpdate）。
 */
export default function CardEditModal({ open, initial, categories, defaultCategoryName, onFinish, onClose }) {
  const [form] = Form.useForm();

  const defaultCategoryId = useMemo(
    () => categories.find((c) => c.name === defaultCategoryName)?.id ?? categories[0]?.id,
    [categories, defaultCategoryName]
  );

  // 每次打开（open 或 initial 变化）时重置表单为当前编辑对象
  const formInitial = useMemo(() => {
    if (!open) return undefined;
    return {
      title: initial?.title ?? '',
      tags: initial?.tags ?? [],
      categoryId: initial?.categoryId ?? defaultCategoryId,
      content: initial?.content ?? '',
    };
  }, [open, initial, defaultCategoryId]);

  const isEditing = Boolean(initial);

  return (
    <Modal
      key={isEditing ? `edit-${initial.id}` : 'create'}
      open={open}
      title={isEditing ? '编辑知识' : '新增知识'}
      okText="保存"
      cancelText="取消"
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      width={640}
      onOk={() => form.submit()}
      onCancel={onClose}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={formInitial}
        onFinish={(values) => {
          const { categoryId, ...rest } = values;
          onFinish({ ...rest, categoryName: categories.find((c) => c.id === categoryId)?.name ?? '' });
          form.resetFields();
        }}
      >
        <Form.Item
          name="title"
          label="标题"
          extra="可不填，留空将保存为「未命名知识」"
          rules={[{ max: 100, message: '标题不能超过 100 个字符' }]}
        >
          <Input placeholder="知识的标题，例如：Vite 别名配置" maxLength={100} showCount />
        </Form.Item>
        <Form.Item
          name="tags"
          label="标签"
          extra="支持多个标签（回车创建），1~20 个，每个 1~30 个字符，用于搜索与冷门知识查询"
          rules={[
            { required: true, message: '请至少添加一个标签' },
            {
              validator: (_, tags) => {
                const list = Array.isArray(tags) ? tags : [];
                if (list.length > 20) return Promise.reject(new Error('标签不能超过 20 个'));
                if (list.some((t) => String(t).trim().length > 30)) {
                  return Promise.reject(new Error('每个标签不能超过 30 个字符'));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Select
            mode="tags"
            tokenSeparators={[',', '，']}
            placeholder="输入标签后按回车添加，例如：前端 / 配置"
            open={false}
            suffixIcon={null}
            maxCount={20}
            maxTagCount="responsive"
          />
        </Form.Item>
        <Form.Item
          name="categoryId"
          label="分类"
          rules={[{ required: true, message: '请选择分类' }]}
        >
          <Select
            placeholder="选择知识所属分类"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
        </Form.Item>
        <Form.Item
          name="content"
          label="内容"
          rules={[{ required: true, whitespace: true, message: '请输入知识内容' }]}
        >
          <TextArea
            rows={10}
            placeholder="记录详细内容：步骤、命令、注意事项…"
            maxLength={20000}
            showCount
            style={{ fontFamily: 'monospace' }}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
