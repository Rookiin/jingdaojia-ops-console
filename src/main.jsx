import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { loadSeed } from './data/loader.js'

// 渲染前注入种子：loader 内部有一次性标志 + meta.seedId + 按 id upsert 三重幂等，
// 兼容 StrictMode 双执行/热更新；已有 localStorage 数据时直接复用。
loadSeed()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
