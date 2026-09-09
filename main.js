const { app, BrowserWindow, session, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// >>> Adres strony Aqua Maker (bez HTTPS — zgodnie z konfiguracją hostingu) <<<
const SITE_URL = 'http://botmakeraqua.aquastudios.pl/';

const SESSION_PARTITION = 'persist:aquamaker'; // trwałe ciasteczka -> trwała sesja logowania

let mainWindow;

function createWindow() {
  const ses = session.fromPartition(SESSION_PARTITION);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Aqua Maker',
    icon: path.join(__dirname, 'icon.png'),
    backgroundColor: '#04060f',
    frame: false, // własny, stylowany pasek okna rysowany przez stronę (patrz assets/js/titlebar.js)
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  loadSiteWithFallback();

  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', 'normal'));

  // linki zewnętrzne (partnerzy, discord developer portal, target=_blank) -> domyślna przeglądarka
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SITE_URL)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ------------------------------------------------------------
// Ładowanie strony z wykrywaniem WSZYSTKICH rodzajów awarii:
// błąd sieci, kod HTTP 4xx/5xx, ORAZ strona, która "wczytała się"
// (status 200) ale jest pusta/zepsuta (np. fatal error PHP bez
// wyświetlania błędów -> serwer i tak zwraca 200 z pustą treścią).
// ------------------------------------------------------------
const ERROR_PAGE = () => path.join(__dirname, 'error.html');
let watchdogTimer = null;
let expectingSite = false;

function clearWatchdog() {
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
}

function showFallback() {
  if (!mainWindow) return;
  expectingSite = false;
  clearWatchdog();
  mainWindow.loadFile(ERROR_PAGE());
}

function loadSiteWithFallback() {
  if (!mainWindow) return;
  expectingSite = true;
  clearWatchdog();

  // Jeśli strona nie skończy się wczytywać w 30 sekund — uznajemy to za awarię.
  // (Wartość celowo wysoka — tańszy/wolniejszy hosting potrafi odpowiadać kilka-kilkanaście sekund.)
  watchdogTimer = setTimeout(() => { if (expectingSite) showFallback(); }, 30000);

  mainWindow.loadURL(SITE_URL);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('web-contents-created', (_event, contents) => {
  // Każda nawigacja główna w obrębie naszej strony (kliknięcie "Zaloguj się",
  // przejście do panelu itd.) ponownie uzbraja wykrywanie awarii —
  // nie tylko pierwsze wczytanie aplikacji.
  contents.on('did-start-navigation', (_e, url, _isInPlace, isMainFrame) => {
    if (isMainFrame && url.startsWith(SITE_URL)) {
      expectingSite = true;
      clearWatchdog();
      watchdogTimer = setTimeout(() => { if (expectingSite) showFallback(); }, 30000);
    }
  });

  // Tylko kod HTTP błędu (4xx/5xx) sprawdzamy od razu — to pewny sygnał awarii
  // niezależny od tego, jak długo strona się jeszcze renderuje.
  contents.on('did-navigate', (_e, url, httpResponseCode) => {
    if (!expectingSite) return;
    if (httpResponseCode >= 400) showFallback();
  });

  contents.on('did-fail-load', (_e, errorCode) => {
    if (!expectingSite) return;
    if (errorCode === -3) return; // ERR_ABORTED — normalne przy szybkiej nawigacji, ignorujemy
    showFallback();
  });

  // Sprawdzenie "czy strona ma jakąkolwiek treść" robimy WYŁĄCZNIE po did-finish-load,
  // czyli gdy przeglądarka uznaje stronę za w pełni załadowaną (odpowiednik window.onload).
  // Sprawdzanie wcześniej (np. tuż po did-navigate) dawało fałszywe alarmy na wolniejszym
  // hostingu, bo strona fizycznie nie zdążyła jeszcze dotrzeć w całości.
  contents.on('did-finish-load', () => {
    if (!expectingSite) return;
    clearWatchdog();
    checkPageHasContent(contents);
  });
});

function checkPageHasContent(contents) {
  if (!expectingSite) return;
  // Uwaga: używamy textContent (nie innerText) — uwzględnia też elementy
  // chwilowo ukryte przez CSS (np. panel czeka na odpowiedź z API),
  // więc nie zgłosimy fałszywego alarmu na poprawnie działającej stronie.
  contents.executeJavaScript(
    'document.body ? document.body.textContent.trim().length : 0'
  ).then((len) => {
    if (expectingSite && len < 10) showFallback(); // realnie pusta strona -> traktujemy jako awarię
    else expectingSite = false; // wszystko OK, przestajemy pilnować
  }).catch(() => {});
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  killLocalBot();
});

// ------------------------------------------------------------
// Sterowanie własnym paskiem okna (minimalizuj / maksymalizuj / zamknij)
// ------------------------------------------------------------
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-toggle-maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
ipcMain.on('retry-load', () => loadSiteWithFallback());

// ------------------------------------------------------------
// Uruchamianie / zatrzymywanie wyeksportowanego bota lokalnie (do testów)
// ------------------------------------------------------------
function sendStatus(msg) {
  if (mainWindow) mainWindow.webContents.send('run-status', msg);
}

// Informuje renderer (przycisk w panelu), czy bot lokalny aktualnie działa,
// żeby mógł zmienić się w "Zatrzymaj bota" i z powrotem — niezależne od
// treści statusu, więc działa niezawodnie nawet gdy status to zwykły log bota.
function sendState(state) {
  if (mainWindow) mainWindow.webContents.send('bot-state', state); // 'running' | 'stopped'
}

let localBotProcess = null;

// Zabija lokalnego bota razem z ewentualnymi procesami potomnymi.
// Na Windows samo proc.kill() potrafi zabić tylko powłokę-rodzica,
// zostawiając prawdziwy proces node.exe "osierocony" i wciąż działający
// (stąd taskkill /t, który zabija całe drzewo procesów).
function killLocalBot() {
  const proc = localBotProcess;
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') {
    exec('taskkill /pid ' + proc.pid + ' /t /f', () => {});
  } else {
    try { proc.kill('SIGTERM'); } catch (e) { /* proces już nie istnieje */ }
  }
}

ipcMain.on('stop-bot-locally', () => {
  if (!localBotProcess) return;
  sendStatus('⏹ Zatrzymywanie bota...');
  killLocalBot();
});

ipcMain.on('run-bot-locally', async (event, { exportUrl }) => {
  try {
    // jeśli poprzedni lokalny bot wciąż działa, zatrzymaj go najpierw
    if (localBotProcess && !localBotProcess.killed) {
      killLocalBot();
      localBotProcess = null;
    }

    const extractZip = require('extract-zip');
    const ses = session.fromPartition(SESSION_PARTITION);

    sendStatus('Pobieranie konfiguracji bota...');
    // exportUrl zawiera "&local=1" -> serwer sam wstawia zapisany token do .env,
    // więc nie trzeba niczego ręcznie uzupełniać.
    const response = await ses.fetch(exportUrl); // fetch z sesji -> wysyła ciasteczko logowania
    if (!response.ok) {
      sendStatus('❌ Nie udało się pobrać bota (błąd ' + response.status + '). Zaloguj się ponownie.');
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const workDir = path.join(os.tmpdir(), 'aquamaker-local-' + Date.now());
    fs.mkdirSync(workDir, { recursive: true });
    const zipPath = path.join(workDir, 'bot.zip');
    fs.writeFileSync(zipPath, buffer);

    sendStatus('Rozpakowywanie plików...');
    const extractDir = path.join(workDir, 'bot');
    await extractZip(zipPath, { dir: extractDir });

    sendStatus('Instalowanie zależności (npm install)... to może chwilę potrwać.');
    await runCommand('npm', ['install'], extractDir);

    sendStatus('🚀 Uruchamianie bota lokalnie...');
    // Bez shell:true — "node" to prawdziwy plik wykonywalny (nie .cmd jak npm),
    // więc nie ma tu problemu z EINVAL, a dzięki temu proces można też
    // niezawodnie zatrzymać (patrz killLocalBot powyżej).
    const proc = spawn('node', ['index.js'], { cwd: extractDir });
    localBotProcess = proc;
    sendState('running');

    proc.stdout.on('data', d => sendStatus(d.toString().trim()));
    proc.stderr.on('data', d => sendStatus('⚠ ' + d.toString().trim()));
    proc.on('error', (err) => {
      sendStatus('❌ Nie udało się uruchomić bota: ' + err.message);
      if (localBotProcess === proc) { localBotProcess = null; sendState('stopped'); }
    });
    proc.on('close', (code) => {
      sendStatus(code === 0 || code === null ? '⏹ Bot lokalny zatrzymany.' : '⏹ Bot lokalny zatrzymany (kod ' + code + ').');
      if (localBotProcess === proc) { localBotProcess = null; sendState('stopped'); }
    });
  } catch (err) {
    sendStatus('❌ Błąd: ' + err.message);
    sendState('stopped');
  }
});

function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    // WAŻNE: na Windows "npm" to w rzeczywistości plik npm.cmd — próba jego
    // bezpośredniego spawn() (bez powłoki) kończy się błędem "spawn EINVAL",
    // bo CreateProcess nie potrafi uruchomić pliku .cmd jako zwykłego programu.
    // shell:true każe Node'owi odpalić polecenie przez cmd.exe (Windows) albo
    // /bin/sh (Linux/macOS), więc działa identycznie na każdej platformie.
    const proc = spawn(cmd, args, { cwd, shell: true });
    proc.stdout.on('data', d => sendStatus(d.toString().trim()));
    proc.stderr.on('data', d => sendStatus(d.toString().trim()));
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(cmd + ' zakończył się kodem ' + code)));
    proc.on('error', reject);
  });
}
