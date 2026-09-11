import { useEffect } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, Typography } from 'antd';
import dayjs from 'dayjs';
import { fmtMoney, toCents, validateRepaymentCents } from './loanCore';

const { Text } = Typography;

/**
 * 记录/编辑还款共用弹窗。
 *
 * 表单值：date（还款日期，必填，新增时默认今天）、amount（还款金额，必填，元、两位小数）、
 * paymentMethod（支付方式，可选填，自由文本）。
 * 校验约束：还款金额 > 0 且不超过 maxCents，保证任何时刻累计已还都不超过借款总金额：
 * - 新增：maxCents = 当前剩余未还金额；
 * - 编辑：maxCents = 剩余未还 + 该笔原金额（除本笔外的剩余）。
 * 输入时实时预览「本次还款后剩余」。
 */
export default function RepaymentModal({ open, repayment, maxCents, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const amountValue = Form.useWatch('amount', form);

  // 每次打开时重置表单：编辑回填原值，新增默认今天
  useEffect(() => {
    if (!open) return;
    if (repayment) {
      form.setFieldsValue({
        date: dayjs(repayment.date),
        amount: repayment.amount,
        paymentMethod: repayment.paymentMethod ?? '',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ date: dayjs() });
    }
  }, [open, repayment, form]);

  const isEditing = Boolean(repayment);
  const hasAmount = amountValue !== undefined && amountValue !== null && amountValue !== '';
  const afterCents = Math.max(0, maxCents - toCents(hasAmount ? amountValue : 0));

  /** 提交：校验通过后传出规范化字段 */
  async function submit() {
    const values = await form.validateFields();
    onSubmit({
      date: values.date.format('YYYY-MM-DD'),
      amount: Math.round(Number(values.amount) * 100) / 100,
      paymentMethod: String(values.paymentMethod ?? '').trim(),
    });
  }

  return (
    <Modal
      key={isEditing ? `edit-${repayment.id}` : 'create-repayment'}
      open={open}
      title={isEditing ? '编辑还款记录' : '记录还款'}
      okText={isEditing ? '保存' : '记录'}
      cancelText="取消"
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onOk={submit}
      onCancel={onCancel}
    >
      <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
        <Form.Item name="date" label="还款日期" rules={[{ required: true, message: '请选择还款日期' }]}>
          <DatePicker style={{ width: '100%' }} allowClear={false} />
        </Form.Item>
        <Form.Item
          name="amount"
          label="还款金额"
          rules={[
            { required: true, message: '请输入还款金额' },
            {
              validator: (_, value) => {
                if (value === undefined || value === null || value === '') return Promise.resolve();
                const err = validateRepaymentCents(toCents(value), maxCents);
                return err ? Promise.reject(new Error(err)) : Promise.resolve();
              },
            },
          ]}
        >
          {/* 不设 max：超限时由上面的校验规则给出明确错误提示，而不是静默钳制输入值 */}
          <InputNumber
            min={0.01}
            precision={2}
            style={{ width: '100%' }}
            addonBefore="¥"
            placeholder="本次还款金额（元）"
            autoFocus
          />
        </Form.Item>
        <Form.Item
          name="paymentMethod"
          label="支付方式"
          extra="可不填；如：微信、支付宝、银行转账、现金"
        >
          <Input placeholder="可不填" maxLength={30} allowClear />
        </Form.Item>
        <div style={{ marginTop: -8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {isEditing
              ? `除本笔外剩余未还 ¥${fmtMoney(maxCents / 100)}，本笔最多可记录该值`
              : `当前剩余未还 ¥${fmtMoney(maxCents / 100)}，还款金额不能超过该值`}
          </Text>
          {hasAmount && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                本次还款后剩余：¥{fmtMoney(afterCents / 100)}
              </Text>
            </div>
          )}
        </div>
      </Form>
    </Modal>
  );
}
