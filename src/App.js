import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

function App() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [mode, setMode] = useState('proxy');
  const [connectionTime, setConnectionTime] = useState(0);
  const [vlessKey, setVlessKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [daysLeft] = useState(14);
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState([]);
  const [networkData, setNetworkData] = useState([]);
  const timerRef = useRef(null);
  const networkRef = useRef(null);
  const canvasRef = useRef(null);

  const addLog = useCallback((type, message) => {
    const now = new Date();
    const time = now.toLocaleTimeString('ru-RU');
    setLogs(prev => [...prev.slice(-99), { time, type, message }]);
  }, []);

  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.clearRect(0, 0, width, height);
    
    if (networkData.length < 2) return;
    
    const maxValue = Math.max(...networkData.map(d => d.value), 100);
    
    ctx.beginPath();
    ctx.strokeStyle = connected ? '#00c37f' : '#ff4444';
    ctx.lineWidth = 2;
    
    networkData.forEach((point, i) => {
      const x = (i / (networkData.length - 1)) * width;
      const y = height - (point.value / maxValue) * (height - 10);
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    
    ctx.stroke();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, connected ? 'rgba(0,195,127,0.3)' : 'rgba(255,68,68,0.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
  }, [networkData, connected]);

  useEffect(() => {
    if (connected) {
      timerRef.current = setInterval(() => {
        setConnectionTime(prev => prev + 1);
      }, 1000);
      
      networkRef.current = setInterval(() => {
        const now = new Date();
        const baseValue = 50 + Math.random() * 50;
        const hasIssue = Math.random() < 0.05;
        
        if (hasIssue) {
          addLog('warning', 'Временное снижение скорости соединения');
          setNetworkData(prev => [...prev.slice(-29), { time: now, value: 5 + Math.random() * 10 }]);
        } else {
          setNetworkData(prev => [...prev.slice(-29), { time: now, value: baseValue }]);
        }
      }, 1000);
      
      addLog('success', `Подключено в режиме ${mode.toUpperCase()}`);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (networkRef.current) clearInterval(networkRef.current);
      setConnectionTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (networkRef.current) clearInterval(networkRef.current);
    };
  }, [connected, mode, addLog]);

  useEffect(() => {
    drawGraph();
  }, [networkData, drawGraph]);

  useEffect(() => {
    const key = localStorage.getItem('vlessKey');
    if (key) {
      setVlessKey(key);
      setSavedKey(key);
    }
    addLog('info', 'Приложение запущено');
    
    // Listen for VPN logs from main process
    if (window.electronAPI && window.electronAPI.onVpnLog) {
      window.electronAPI.onVpnLog((data) => {
        addLog(data.type, data.message);
      });
    }
    
    return () => {
      if (window.electronAPI && window.electronAPI.removeVpnLogListener) {
        window.electronAPI.removeVpnLogListener();
      }
    };
  }, [addLog]);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  const handleSaveKey = () => {
    if (vlessKey.trim() && vlessKey.startsWith('vless://')) {
      localStorage.setItem('vlessKey', vlessKey);
      setSavedKey(vlessKey);
    }
  };

  const handleConnect = async () => {
    if (!savedKey.trim()) return;

    setConnecting(true);
    addLog('info', `Подключение в режиме ${mode.toUpperCase()}...`);
    setNetworkData([]);
    
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.connect(savedKey, mode);
        if (result.success) {
          setConnected(true);
        } else {
          addLog('error', `Ошибка подключения: ${result.error}`);
          alert('Ошибка: ' + result.error);
        }
      } else {
        await new Promise(resolve => setTimeout(resolve, 1500));
        setConnected(true);
      }
    } catch (error) {
      addLog('error', `Критическая ошибка: ${error.message}`);
      alert('Ошибка: ' + error.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);
    addLog('info', 'Отключение...');
    
    try {
      if (window.electronAPI) {
        await window.electronAPI.disconnect();
      } else {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      setConnected(false);
      addLog('info', 'Соединение разорвано');
      setNetworkData([]);
    } catch (error) {
      addLog('error', `Ошибка при отключении: ${error.message}`);
      alert('Ошибка: ' + error.message);
    } finally {
      setConnecting(false);
    }
  };

  const getGraphTimes = () => {
    const times = [];
    const now = new Date();
    for (let i = 4; i >= 0; i--) {
      const t = new Date(now.getTime() - i * 6000);
      times.push(t.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }));
    }
    return times;
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('info', 'Логи очищены');
  };

  const openBot = () => {
    window.open('https://t.me/puffvpn_bot', '_blank');
  };

  const hasKey = savedKey.trim().length > 0;

  return (
    <div className="app">
      <div className="logo">
        <svg viewBox="0 0 100 100" className="star">
          <path 
            d="M50 0 L58 42 L100 50 L58 58 L50 100 L42 58 L0 50 L42 42 Z" 
            fill="#FF0099"
          />
        </svg>
      </div>

      {!hasKey ? (
        <div className="welcome-screen">
          <div className="welcome-card">
            <h2 className="welcome-title">Вставьте впн ключ</h2>
            <input
              type="text"
              className="key-input"
              placeholder="vless://..."
              value={vlessKey}
              onChange={(e) => setVlessKey(e.target.value)}
              onBlur={handleSaveKey}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
            />
            <button className="bot-btn" onClick={openBot}>
              <svg width="16" height="14" viewBox="0 0 24 24" fill="white">
                <path d="M12 2L2 8l10 6 10-6-10-6zM2 16l10 6 10-6M2 12l10 6 10-6"/>
              </svg>
              Перейти в бота
            </button>
          </div>
        </div>
      ) : (
        <div className="main-screen">
          <div className="main-grid">
            <div className="panel connection-panel">
              <div className="status-row">
                <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
                <span className="status-text">{connected ? 'Подключен' : 'Не подключен'}</span>
              </div>
              <div className="timer">{formatTime(connectionTime)}</div>

              <div className="graph-area">
                <canvas ref={canvasRef} width={271} height={60} className="graph-canvas"></canvas>
                <div className="graph-times">
                  {getGraphTimes().map((t, i) => <span key={i}>{t}</span>)}
                </div>
              </div>

              <div className="mode-toggle">
                <button 
                  className={`mode-btn ${mode === 'proxy' ? 'active' : ''}`}
                  onClick={() => !connected && setMode('proxy')}
                >
                  proxy
                </button>
                <button 
                  className={`mode-btn ${mode === 'tun' ? 'active' : ''}`}
                  onClick={() => !connected && setMode('tun')}
                >
                  TUN
                </button>
              </div>

              <div className="connect-row">
                <div className="country-flag">🇳🇱</div>
                <button 
                  className={`connect-btn ${connecting ? 'loading' : ''}`}
                  onClick={connected ? handleDisconnect : handleConnect}
                  disabled={connecting}
                >
                  {connecting ? '...' : connected ? 'Отключиться' : 'Подключиться'}
                </button>
              </div>
            </div>

            <div className="right-column">
              <div className="panel subscription-panel">
                <div className="days-row">
                  <span className="days-num">{daysLeft}</span>
                  <span className="days-label">days</span>
                </div>
                <div className="sub-text">your subscription</div>
                <button className="bot-btn" onClick={openBot}>
                  <svg width="16" height="14" viewBox="0 0 24 24" fill="white">
                    <path d="M12 2L2 8l10 6 10-6-10-6zM2 16l10 6 10-6M2 12l10 6 10-6"/>
                  </svg>
                  Перейти в бота
                </button>
              </div>

              <div className="panel menu-panel">
                <button className="menu-item" onClick={() => { console.log('Settings clicked'); setShowSettings(true); }}>
                  <div className="menu-icon settings">⚙</div>
                  <span>Настройки</span>
                  <span className="arrow">›</span>
                </button>
                <div className="menu-divider"></div>
                <button className="menu-item" onClick={() => window.open('https://t.me/puffvpn_support', '_blank')}>
                  <div className="menu-icon support">💬</div>
                  <span>Поддержка</span>
                  <span className="arrow">›</span>
                </button>
                <div className="menu-divider"></div>
                <button className="menu-item">
                  <div className="menu-icon lang">🌐</div>
                  <span>Язык</span>
                  <span className="arrow">›</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-panel" onClick={e => e.stopPropagation()}>
            <div className="settings-header">
              <h3>Логи подключения</h3>
              <button className="close-btn" onClick={() => setShowSettings(false)}>×</button>
            </div>
            <div className="logs-container">
              {logs.length === 0 ? (
                <div className="no-logs">Нет логов</div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`log-item log-${log.type}`}>
                    <span className="log-time">{log.time}</span>
                    <span className="log-message">{log.message}</span>
                  </div>
                ))
              )}
            </div>
            <div className="settings-footer">
              <button className="clear-logs-btn" onClick={clearLogs}>Очистить логи</button>
            </div>
          </div>
        </div>
      )}

      <div className="version">puffvpn.0.10.03</div>
    </div>
  );
}

export default App;
