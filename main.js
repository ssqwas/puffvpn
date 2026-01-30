const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

let mainWindow;
let tray;
let xrayProcess = null;
let currentMode = 'proxy';

const isDev = !app.isPackaged;

// Auto-updater setup (only in production)
let autoUpdater = null;
if (!isDev) {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  
  autoUpdater.on('update-available', () => {
    if (mainWindow) {
      mainWindow.webContents.send('vpn-log', { type: 'info', message: 'Доступно обновление, загружается...' });
    }
  });
  
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) {
      mainWindow.webContents.send('vpn-log', { type: 'success', message: 'Обновление загружено. Перезапустите приложение для установки.' });
    }
  });
  
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
  });
}

// Check if running as admin (Windows)
function isAdmin() {
  if (process.platform !== 'win32') return true;
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// Request admin rights and restart
function requestAdminAndRestart() {
  const exePath = process.execPath;
  const args = process.argv.slice(1);
  
  try {
    spawn('powershell', [
      '-Command',
      `Start-Process -FilePath "${exePath}" -ArgumentList "${args.join(' ')}" -Verb RunAs`
    ], { detached: true, stdio: 'ignore' });
    app.quit();
  } catch (err) {
    dialog.showErrorBox('Ошибка', 'Не удалось запросить права администратора');
  }
}

// Check admin on startup (production only)
if (!isDev && !isAdmin()) {
  app.on('ready', () => {
    const result = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Запустить от администратора', 'Продолжить без прав'],
      defaultId: 0,
      title: 'PuffVPN',
      message: 'Для TUN режима требуются права администратора',
      detail: 'Хотите перезапустить приложение с правами администратора?'
    });
    
    if (result === 0) {
      requestAdminAndRestart();
    } else {
      createWindow();
      createTray();
      if (autoUpdater) autoUpdater.checkForUpdatesAndNotify();
    }
  });
} else {
  app.on('ready', () => {
    createWindow();
    createTray();
    if (autoUpdater) autoUpdater.checkForUpdatesAndNotify();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'build', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const { nativeImage } = require('electron');
  
  // Create a simple pink star icon programmatically
  const size = 16;
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAABB0lEQVR4nGNgGLTg////DP///2f4//8/AwMDA8P/f/8Z/v/7x/D/718GZAwMYHj/5y/D/9+/GP7/+snw/9dPhv+/fjD8//md4f/P7wz/f3xl+P/jC8P/758Y/n//yPD/23uG/1/fMfz/8prh/+eXDP8/PWf4/+Epw/8Pjxn+v3/I8P/tfYb/r+8y/H91m+H/y5sM/59fZ/j/7CrD/yeXGP4/usDw/8F5hv/3TzP8v3eS4f+d4wz/bx9j+H/rCMP/mwcZ/l/fz/D/6l6G/5d3Mfy/tIPh/4WtDP/PbWb4f3ojw/9TGxj+n1zH8P/4aob/R1cy/D+0nOH/gcUM//cvYPi/dwbD/z3TGBgAJ0dPjfKGuekAAAAASUVORK5CYII=`);
  
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Открыть PuffVPN', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: 'Подключиться', click: () => mainWindow.webContents.send('tray-connect') },
    { label: 'Отключиться', click: () => mainWindow.webContents.send('tray-disconnect') },
    { type: 'separator' },
    { label: 'Выход', click: () => {
      app.isQuitting = true;
      stopXray();
      app.quit();
    }}
  ]);

  tray.setToolTip('PuffVPN');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow.show());
}

function getXrayPath() {
  if (isDev) {
    return path.join(__dirname, 'xray', process.platform === 'win32' ? 'xray.exe' : 'xray');
  }
  return path.join(process.resourcesPath, 'xray', process.platform === 'win32' ? 'xray.exe' : 'xray');
}

function getSingboxPath() {
  if (isDev) {
    return path.join(__dirname, 'xray', process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
  }
  return path.join(process.resourcesPath, 'xray', process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
}

function getConfigPath(mode) {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, mode === 'tun' ? 'singbox-config.json' : 'config.json');
}

function sendVpnLog(type, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('vpn-log', { type, message });
  }
}

function cleanAnsiCodes(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[[\d;]*m/g, '');
}

function parseVpnError(msg) {
  msg = cleanAnsiCodes(msg).toLowerCase();
  
  if (msg.includes('connection refused')) return 'Сервер недоступен - проверьте адрес и порт';
  if (msg.includes('timeout')) return 'Таймаут подключения - сервер не отвечает';
  if (msg.includes('certificate')) return 'Ошибка сертификата TLS - проверьте SNI';
  if (msg.includes('handshake')) return 'Ошибка TLS handshake - проверьте настройки безопасности';
  if (msg.includes('invalid')) return 'Неверный формат ключа или конфигурации';
  if (msg.includes('permission') || msg.includes('access denied')) return 'Нет прав доступа - запустите от администратора';
  if (msg.includes('address already in use')) return 'Порт уже занят другим приложением';
  if (msg.includes('network unreachable')) return 'Сеть недоступна - проверьте интернет';
  if (msg.includes('dns')) return 'Ошибка DNS - не удается разрешить адрес сервера';
  if (msg.includes('reality') && msg.includes('public')) return 'Неверный public key для Reality';
  if (msg.includes('uuid')) return 'Неверный UUID в ключе';
  if (msg.includes('wsasend') || msg.includes('wsarecv')) return 'Соединение разорвано - сетевая ошибка Windows';
  if (msg.includes('connection reset')) return 'Соединение сброшено сервером';
  if (msg.includes('eof')) return 'Соединение закрыто сервером';
  if (msg.includes('established connection was aborted')) return 'Установленное соединение было прервано';
  if (msg.includes('no route to host')) return 'Нет маршрута к серверу';
  if (msg.includes('i/o timeout')) return 'Таймаут ввода/вывода - медленное соединение';
  
  // Clean up for display
  const clean = cleanAnsiCodes(msg).slice(0, 100);
  return clean || 'Неизвестная ошибка';
}

function startVPN(config, mode) {
  return new Promise((resolve, reject) => {
    const configPath = getConfigPath(mode);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    currentMode = mode;
    
    let exePath, args;
    
    if (mode === 'tun') {
      exePath = getSingboxPath();
      args = ['run', '-c', configPath];
      
      if (!fs.existsSync(exePath)) {
        sendVpnLog('error', 'sing-box не найден. Скачайте sing-box для TUN режима.');
        reject(new Error('sing-box not found for TUN mode.'));
        return;
      }
    } else {
      exePath = getXrayPath();
      args = ['run', '-c', configPath];
      
      if (!fs.existsSync(exePath)) {
        sendVpnLog('error', 'xray-core не найден. Скачайте xray-core.');
        reject(new Error('Xray core not found.'));
        return;
      }
    }

    sendVpnLog('info', `Запуск ${mode.toUpperCase()} режима...`);
    console.log(`Starting ${mode} mode with: ${exePath}`);
    xrayProcess = spawn(exePath, args);

    let started = false;
    let errorOutput = '';

    xrayProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      console.log(`vpn: ${msg}`);
      
      if (msg.includes('started') || msg.includes('sing-box started')) {
        if (!started) {
          started = true;
          sendVpnLog('success', `VPN успешно запущен (${mode.toUpperCase()})`);
          resolve();
        }
      } else if (msg.includes('error') || msg.includes('failed')) {
        sendVpnLog('error', parseVpnError(msg.toLowerCase()));
      } else if (msg.includes('warn')) {
        sendVpnLog('warning', msg.slice(0, 100));
      }
    });

    xrayProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      console.error(`vpn error: ${msg}`);
      errorOutput += msg;
      
      const parsed = parseVpnError(msg.toLowerCase());
      sendVpnLog('error', parsed);
    });

    xrayProcess.on('error', (err) => {
      sendVpnLog('error', `Не удалось запустить процесс: ${err.message}`);
      reject(err);
    });

    xrayProcess.on('close', (code) => {
      console.log(`vpn exited with code ${code}`);
      if (code !== 0) {
        if (mode === 'tun' && errorOutput.toLowerCase().includes('permission')) {
          sendVpnLog('error', 'TUN требует прав администратора. Запустите приложение от имени администратора.');
          reject(new Error('TUN режим требует прав администратора.'));
        } else if (!started) {
          sendVpnLog('error', `Процесс завершился с кодом ${code}`);
          reject(new Error('Ошибка подключения: ' + parseVpnError(errorOutput.toLowerCase())));
        }
      }
      if (started) {
        sendVpnLog('warning', 'VPN процесс неожиданно завершился');
      }
      xrayProcess = null;
    });

    setTimeout(() => {
      if (!started) {
        sendVpnLog('info', 'Ожидание подключения...');
        resolve();
      }
    }, 3000);
  });
}

function stopXray() {
  return new Promise((resolve) => {
    if (xrayProcess) {
      xrayProcess.kill();
      xrayProcess = null;
    }
    resolve();
  });
}

// Windows System Proxy Functions
function enableSystemProxy(proxyServer) {
  if (process.platform !== 'win32') {
    console.log('System proxy setup only supported on Windows');
    return;
  }
  
  try {
    const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    // Enable proxy and set proxy server
    execSync(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 1 /f`, { shell: 'cmd.exe' });
    execSync(`reg add "${regPath}" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f`, { shell: 'cmd.exe' });
    // Bypass local addresses
    execSync(`reg add "${regPath}" /v ProxyOverride /t REG_SZ /d "localhost;127.*;10.*;192.168.*;<local>" /f`, { shell: 'cmd.exe' });
    
    // Refresh Internet Settings
    refreshInternetSettings();
    console.log('System proxy enabled:', proxyServer);
  } catch (error) {
    console.error('Failed to enable system proxy:', error);
  }
}

function disableSystemProxy() {
  if (process.platform !== 'win32') {
    return;
  }
  
  try {
    const regPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    execSync(`reg add "${regPath}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { shell: 'cmd.exe' });
    refreshInternetSettings();
    console.log('System proxy disabled');
  } catch (error) {
    console.error('Failed to disable system proxy:', error);
  }
}

function refreshInternetSettings() {
  // Use PowerShell to refresh Internet settings so changes take effect immediately
  try {
    execSync(`powershell -Command "$signature = @'
[DllImport(\"wininet.dll\", SetLastError = true, CharSet=CharSet.Auto)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@
$type = Add-Type -MemberDefinition $signature -Name WinINet -Namespace Proxy -PassThru
$type::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
$type::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)"`, { stdio: 'ignore' });
  } catch (e) {
    // Ignore refresh errors
  }
}

function generateVlessConfig(vlessUrl, mode = 'proxy') {
  const url = new URL(vlessUrl);
  const uuid = url.username;
  const address = url.hostname;
  const port = parseInt(url.port) || 443;
  const params = new URLSearchParams(url.search);

  if (mode === 'tun') {
    // sing-box config format for TUN mode
    const transport = params.get('type') || 'tcp';
    const security = params.get('security') || 'tls';
    
    const outbound = {
      tag: 'proxy',
      type: 'vless',
      server: address,
      server_port: port,
      uuid: uuid,
      flow: params.get('flow') || ''
    };

    // TLS settings
    if (security === 'tls') {
      outbound.tls = {
        enabled: true,
        server_name: params.get('sni') || address,
        utls: {
          enabled: true,
          fingerprint: params.get('fp') || 'chrome'
        }
      };
    } else if (security === 'reality') {
      outbound.tls = {
        enabled: true,
        server_name: params.get('sni') || '',
        utls: {
          enabled: true,
          fingerprint: params.get('fp') || 'chrome'
        },
        reality: {
          enabled: true,
          public_key: params.get('pbk') || '',
          short_id: params.get('sid') || ''
        }
      };
    }

    // Transport settings
    if (transport === 'ws') {
      outbound.transport = {
        type: 'ws',
        path: params.get('path') || '/',
        headers: { Host: params.get('host') || address }
      };
    } else if (transport === 'grpc') {
      outbound.transport = {
        type: 'grpc',
        service_name: params.get('serviceName') || ''
      };
    }

    return {
      log: { level: 'warn' },
      dns: {
        servers: [
          {
            tag: 'google',
            address: '8.8.8.8',
            detour: 'proxy'
          },
          {
            tag: 'local',
            address: '223.5.5.5',
            detour: 'direct'
          }
        ],
        rules: [
          { outbound: 'any', server: 'local' }
        ],
        final: 'google'
      },
      inbounds: [
        {
          tag: 'tun-in',
          type: 'tun',
          interface_name: 'PuffVPN',
          inet4_address: '172.19.0.1/30',
          mtu: 1500,
          auto_route: true,
          strict_route: true,
          stack: 'system',
          sniff: true,
          sniff_override_destination: true
        }
      ],
      outbounds: [
        outbound,
        { tag: 'direct', type: 'direct' },
        { tag: 'block', type: 'block' },
        { tag: 'dns-out', type: 'dns' }
      ],
      route: {
        auto_detect_interface: true,
        final: 'proxy',
        rules: [
          { protocol: 'dns', outbound: 'dns-out' },
          { ip_is_private: true, outbound: 'direct' }
        ]
      }
    };
  }

  // xray config format for proxy mode
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'socks',
        port: 10808,
        listen: '127.0.0.1',
        protocol: 'socks',
        settings: { udp: true }
      },
      {
        tag: 'http',
        port: 10809,
        listen: '127.0.0.1',
        protocol: 'http'
      }
    ],
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'vless',
        settings: {
          vnext: [{
            address: address,
            port: port,
            users: [{
              id: uuid,
              encryption: params.get('encryption') || 'none',
              flow: params.get('flow') || ''
            }]
          }]
        },
        streamSettings: {
          network: params.get('type') || 'tcp',
          security: params.get('security') || 'tls',
          tlsSettings: params.get('security') === 'tls' ? {
            serverName: params.get('sni') || address,
            fingerprint: params.get('fp') || 'chrome'
          } : undefined,
          realitySettings: params.get('security') === 'reality' ? {
            serverName: params.get('sni') || '',
            fingerprint: params.get('fp') || 'chrome',
            publicKey: params.get('pbk') || '',
            shortId: params.get('sid') || ''
          } : undefined,
          wsSettings: params.get('type') === 'ws' ? {
            path: params.get('path') || '/',
            headers: { Host: params.get('host') || address }
          } : undefined,
          grpcSettings: params.get('type') === 'grpc' ? {
            serviceName: params.get('serviceName') || ''
          } : undefined
        }
      },
      { tag: 'direct', protocol: 'freedom' },
      { tag: 'block', protocol: 'blackhole' }
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
        { type: 'field', domain: ['geosite:category-ads'], outboundTag: 'block' }
      ]
    }
  };

  return config;
}

// IPC Handlers
ipcMain.handle('connect', async (event, { vlessKey, mode }) => {
  try {
    const config = generateVlessConfig(vlessKey, mode);
    await startVPN(config, mode);
    
    // Enable system proxy only for proxy mode
    if (mode === 'proxy') {
      enableSystemProxy('127.0.0.1:10809');
    }
    // TUN mode automatically routes all traffic via the virtual adapter
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('disconnect', async () => {
  try {
    disableSystemProxy();
    await stopXray();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-status', () => {
  return { connected: xrayProcess !== null };
});

ipcMain.on('minimize', () => mainWindow.minimize());
ipcMain.on('close', () => mainWindow.hide());

// Note: Window creation is handled in app.on('ready') above

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopXray();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  disableSystemProxy();
  stopXray();
});
