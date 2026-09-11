import { useEffect } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, Typography } from 'antd';
import dayjs from 'dayjs';
import { fmtMoney, itemRepaidCents, toCents } from './loanCore';

const { Text } = Typography;

/**
 * 新建/编辑借贷事项共用弹窗。
 *
 * 表单值：lender（出借人，必填）、borrower（借款人，必填）、amount（总金额，必填且 > 0）、
 * loanDate（出借日期，必填，新建时默认今天）、paymentMethod（支付方式，可选填，自由文本）、
 * dueDate（还款日期，可空；日期字段均为 dayjs 对象，提交时转为 'YYYY-MM-DD' 日期 key）。
 * 编辑已发生还款的事项时，总金额不能小于已还金额，保证累计还款不超总额的约束成立。
 */
export default function LoanItemModal({ open, item, onCancel, onSubmit }) {
  const [form] = Form.useForm();

  // 每次打开时重置表单为当前编辑对象（新建时清空）
  useEffect(() => {
    if (!open) return;
    if (item) {
      form.setFieldsValue({
        lender: item.lender,
        borrower: item.borrower,
        amount: item.amount,
        loanDate: item.loanDate ? dayjs(item.loanDate) : null,
        paymentMethod: item.paymentMethod ?? '',
        dueDate: item.dueDate ? dayjs(item.dueDate) : null,
      });
    } else {
      form.resetFields();
      // 新建时出借日期默认今天（必填，可直接保存）
      form.setFieldsValue({ loanDate: dayjs() });
    }
  }, [open, item, form]);

  const isEditing = Boolean(item);
  const repaidCents = item ? itemRepaidCents(item) : 0;

  /** 提交：校验通过后传出规范化字段（日期转换为日期 key） */
  async function submit() {
    const values = await form.validateFields();
    onSubmit({
      lender: String(values.lender).trim(),
      borrower: String(values.borrower).trim(),
      amount: Math.round(Number(values.amount) * 100) / 100,
      loanDate: values.loanDate.format('YYYY-MM-DD'),
      paymentMethod: String(values.paymentMethod ?? '').trim(),
      dueDate: values.dueDate ? values.dueDate.format('YYYY-MM-DD') : null,
    });
  }

  return (
    <Modal
      key={isEditing ? `edit-${item.id}` : 'create-item'}
      open={open}
      title={isEditing ? '编辑借贷事项' : '新建借贷事项'}
      okText={isEditing ? '保存' : '创建'}
      cancelText="取消"
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onOk={submit}
      onCancel={onCancel}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item
          name="lender"
          label="出借人"
          rules={[
            { required: true, whitespace: true, message: '请输入出借人' },
            { max: 30, message: '不能超过 30 个字' },
          ]}
        >
          <Input placeholder="出借资金的一方，如：我" maxLength={30} autoFocus allowClear />
        </Form.Item>
        <Form.Item
          name="borrower"
          label="借款人"
          rules={[
            { required: true, whitespace: true, message: '请输入借款人' },
            { max: 30, message: '不能超过 30 个字' },
          ]}
        >
          <Input placeholder="借入资金的一方，如：张三" maxLength={30} allowClear />
        </Form.Item>
        <Form.Item
          name="amount"
          label="总金额"
          rules={[
            { required: true, message: '请输入借款总金额' },
            {
              validator: (_, value) => {
                if (value === undefined || value === null || value === '') return Promise.resolve();
                const cents = toCents(value);
                if (cents <= 0) return Promise.reject(new Error('总金额必须大于 0'));
                if (isEditing && cents < repaidCents) {
                  return Promise.reject(
                    new Error(`总金额不能小于已还金额（¥${fmtMoney(repaidCents / 100)}）`)
                  );
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <InputNumber
            min={0.01}
            precision={2}
            style={{ width: '100%' }}
            addonBefore="¥"
            placeholder="借款总金额（元）"
          />
        </Form.Item>
        <Form.Item
          name="loanDate"
          label="出借日期"
          rules={[{ required: true, message: '请选择出借日期' }]}
          extra="资金实际出借的日期（默认今天，可修改）"
        >
          <DatePicker style={{ width: '100%' }} placeholder="选择出借日期" />
        </Form.Item>
        <Form.Item
          name="paymentMethod"
          label="支付方式"
          extra="可不填；如：微信、支付宝、银行转账、现金"
        >
          <Input placeholder="可不填" maxLength={30} allowClear />
        </Form.Item>
        <Form.Item
          name="dueDate"
          label="还款日期"
          extra={isEditing ? '可清空；无还款日期时不做逾期提示' : '可不填；填写后主页卡片会提示逾期情况'}
        >
          <DatePicker style={{ width: '100%' }} placeholder="可不填" />
        </Form.Item>
        {isEditing && repaidCents > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            该事项已累计还款 ¥{fmtMoney(repaidCents / 100)}，总金额不能小于该值。
          </Text>
        )}
      </Form>
    </Modal>
  );
}
