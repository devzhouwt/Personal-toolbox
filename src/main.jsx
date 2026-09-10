import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'antd/dist/reset.css';
import App from './App';

// Calendar/DatePicker 等组件的月份、星期文本取自 dayjs locale，需显式切换为中文
dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      {/* GitHub Pages 不支持 SPA 路径重写，使用 HashRouter 避免刷新子路由 404 */}
      <HashRouter>
        <App />
      </HashRouter>
    </ConfigProvider>
  </React.StrictMode>
);
