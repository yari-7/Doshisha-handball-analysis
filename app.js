/**
 * リアルタイム ハンドボール試合分析ダッシュボード
 * 試合中にアクションを入力し、タイムアウト・ハーフタイムに分析結果を確認する
 */

// ===== 定数 =====
const TIME_PERIODS_1ST = ['00~05', '05~10', '10~15', '15~20', '20~25', '25~30'];
const TIME_PERIODS_2ND = ['30~35', '35~40', '40~45', '45~50', '50~55', '55~60'];
const TIME_PERIODS_ALL = [...TIME_PERIODS_1ST, ...TIME_PERIODS_2ND];
const SHOOT_TYPES = ['DS', 'LS', 'WS', 'BT', 'EG', 'PT', 'PS'];
const DIRECT_ACTIONS = ['警告', '退場', '失格', 'タイムアウト'];
const SHOOT_LABELS = {
  DS: 'ディスタンス', LS: 'ライン', WS: 'ウイング',
  BT: 'ブレイクスルー', EG: 'エンプティ', PT: '7mスロー', PS: 'ポスト'
};
const RESULT_TYPES = ['Goal', 'Save', 'Out', 'Block', 'TM', 'VL', '警告', '退場', '失格', 'TO'];

// ... (existing code)

let inputState = {
  team: 'Own',
  playerNo: null,
  phase: 'SetOF',
  action: null,
  zone: null,
  course: null,
  psDetail: null, // New State for PS Detail
  pendingResult: null,
  insertAtIndex: null // null=末尾追加, 数値=その位置に挿入
};

// アクション追加ヘルパー（挿入モード対応）
function addActionToList(action) {
  if (inputState.insertAtIndex != null) {
    matchState.actions.splice(inputState.insertAtIndex, 0, action);
    inputState.insertAtIndex++; // 複数挿入時に位置をずらす
  } else {
    matchState.actions.push(action);
  }
}

// ... (existing code)



const STORAGE_KEY = 'handball_realtime_match'; // Old key
const INDEX_KEY = 'handball_match_index'; // New key for list of matches
const TEAM_CONFIG_KEY = 'handball_team_config'; // New key for persistent team settings

const DEFAULT_TEAM_CONFIG = {
  ownName: '同志社',
  players: [
    { no: 2, name: 'まい' },
    { no: 7, name: 'みか' },
    { no: 9, name: 'かほ' },
    { no: 10, name: 'あすか' },
    { no: 13, name: 'しゅり' },
    { no: 14, name: 'りな' },
    { no: 15, name: 'あいか' },
    { no: 16, name: 'こう' },
    { no: 17, name: 'りお' },
    { no: 19, name: 'りん' },
    { no: 20, name: 'みさと' }
  ]
};

// ===== グローバル状態 =====
let matchState = {
  id: null,
  ownName: '',
  oppName: '',
  players: [],       // [{no, name}] Own
  oppPlayers: [],    // [{no, name}] Opp
  ownGk: null,
  oppGk: null,
  ownGkList: [], // New: List of registered GKs
  oppGkList: [], // New: List of registered GKs
  halfDuration: 30,
  actions: [],
  stats: null,
  startTime: null,
  isPracticeMatch: false // ★練習試合モードフラグ
};



// ===== ストップウォッチ状態 =====
let stopwatch = {
  running: false,
  elapsed: 0,        // 経過秒数
  half: 1,           // 1=前半, 2=後半
  startTimestamp: null,
  intervalId: null,
  finished: false
};

let charts = {};
let sessionInitialSnapshot = null;
let isNewMatchSession = false;
let isPrepareMode = false;

// ===== Chart.jsグローバル設定 =====
// ===== Chart.jsグローバル設定 =====
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
  Chart.defaults.font.family = "'Inter', 'Noto Sans JP', sans-serif";
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
  initHomeScreen();
  initSetupScreen();
  initInputPanel();
  initStopwatchEvents();
  initHeatmapEvents();
  initMainTabs();
  initMatchMenu();
  initMemberEdit();
  initOppRegistry();
  initOppAutoFill();

  // 練習試合モードのトグル連動
  const practiceToggle = document.getElementById('practiceModeToggle');
  if (practiceToggle) {
    practiceToggle.addEventListener('change', (e) => {
      const isPractice = e.target.checked;
      const oppGkGroup = document.getElementById('oppGkSetupGroup');
      if (sections[2]) sections[2].style.display = isPractice ? 'none' : '';
      if (oppGkGroup) oppGkGroup.style.display = isPractice ? 'none' : '';
    });
  }

  migrateOldData();
  showHomeScreen();
});

// ========================================
// ホーム画面
// ========================================
function initHomeScreen() {
  document.getElementById('homeNewMatchBtn').addEventListener('click', () => {
    isNewMatchSession = true;
    isPrepareMode = false;
    // 新規試合作成時は状態をリセット
    document.getElementById('setupScreen').style.display = 'block';
    document.getElementById('homeScreen').style.display = 'none';
    matchState.id = `match_${Date.now()}`;
    updateSetupButtons();
  });

  document.getElementById('homePrepareMatchBtn').addEventListener('click', () => {
    isNewMatchSession = true;
    isPrepareMode = true;
    document.getElementById('setupScreen').style.display = 'block';
    document.getElementById('homeScreen').style.display = 'none';
    matchState.id = `match_${Date.now()}`;
    updateSetupButtons();
  });

  document.getElementById('setupBackBtn')?.addEventListener('click', () => {
    isPrepareMode = false;
    document.getElementById('setupScreen').style.display = 'none';
    showHomeScreen();
  });

  document.getElementById('headerHomeBtn')?.addEventListener('click', () => {
    if (confirm('試合データを保存してホームに戻りますか？\\n（[キャンセル] を押すと、保存せずに破棄するか確認します）')) {
      saveData();
      document.getElementById('mainScreen').style.display = 'none';
      showHomeScreen();
    } else {
      if (confirm('現在入力中の内容を【保存せずに破棄】して戻りますか？\\n（新規作成の場合は試合自体が取り消され、続きからの場合は開く前の状態に戻ります）')) {
        if (isNewMatchSession) {
          localStorage.removeItem(`handball_${matchState.id}`);
          const index = getMatchIndex();
          saveMatchIndex(index.filter(m => m.id !== matchState.id));
        } else {
          if (sessionInitialSnapshot) {
            localStorage.setItem(`handball_${matchState.id}`, sessionInitialSnapshot);
            const initialData = JSON.parse(sessionInitialSnapshot);
            const ownScore = initialData.stats ? initialData.stats.own.Score : 0;
            const oppScore = initialData.stats ? initialData.stats.opp.Score : 0;
            const index = getMatchIndex();
            const idx = index.findIndex(m => m.id === matchState.id);
            if (idx >= 0) {
              index[idx].scoreOwn = ownScore;
              index[idx].scoreOpp = oppScore;
              saveMatchIndex(index);
            }
          }
        }
        document.getElementById('mainScreen').style.display = 'none';
        showHomeScreen();
      }
    }
  });

  // Team Settings Button
  document.getElementById('homeTeamSettingsBtn').addEventListener('click', openTeamSettings);
  document.getElementById('teamSettingsCloseBtn').addEventListener('click', closeTeamSettings);
  document.getElementById('tsSaveBtn').addEventListener('click', saveTeamSettingsFromModal);
  document.getElementById('tsAddPlayerBtn').addEventListener('click', tsAddPlayer);
  document.getElementById('tsPlayerNo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('tsPlayerName').focus();
  });
  document.getElementById('tsPlayerName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tsAddPlayer();
  });
}

// ===== 自チーム設定モーダル =====
let tsPlayers = [];

function openTeamSettings() {
  const config = getTeamConfig();
  document.getElementById('tsTeamName').value = config.ownName || '';
  tsPlayers = [...(config.players || [])];
  document.getElementById('tsGk1').value = config.gks && config.gks[0] ? config.gks[0] : '';
  document.getElementById('tsGk2').value = config.gks && config.gks[1] ? config.gks[1] : '';
  document.getElementById('tsGk3').value = config.gks && config.gks[2] ? config.gks[2] : '';
  renderTsPlayers();
  document.getElementById('teamSettingsModal').style.display = 'flex';
}

function closeTeamSettings() {
  document.getElementById('teamSettingsModal').style.display = 'none';
}

function renderTsPlayers() {
  const container = document.getElementById('tsPlayerList');
  if (tsPlayers.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;">選手が登録されていません</p>';
    return;
  }
  container.innerHTML = tsPlayers.map(p => `
    <div class="ts-player-item">
      <span class="ts-player-no">#${p.no}</span>
      <span class="ts-player-name">${p.name || ''}</span>
      <button class="ts-player-remove" onclick="tsRemovePlayer(${p.no})">✕</button>
    </div>
  `).join('');
}

function tsAddPlayer() {
  const noInput = document.getElementById('tsPlayerNo');
  const nameInput = document.getElementById('tsPlayerName');
  const no = parseInt(noInput.value);
  if (!no || no < 1 || no > 99) return;
  if (tsPlayers.some(p => p.no === no)) {
    noInput.value = '';
    nameInput.value = '';
    return;
  }
  tsPlayers.push({ no, name: nameInput.value.trim() });
  tsPlayers.sort((a, b) => a.no - b.no);
  renderTsPlayers();
  noInput.value = '';
  nameInput.value = '';
  noInput.focus();
}

function tsRemovePlayer(no) {
  tsPlayers = tsPlayers.filter(p => p.no !== no);
  renderTsPlayers();
}
window.tsRemovePlayer = tsRemovePlayer;

function saveTeamSettingsFromModal() {
  const ownName = document.getElementById('tsTeamName').value.trim();
  if (!ownName) {
    alert('チーム名を入力してください');
    return;
  }
  const gk1 = parseInt(document.getElementById('tsGk1').value);
  const gk2 = parseInt(document.getElementById('tsGk2').value);
  const gk3 = parseInt(document.getElementById('tsGk3').value);
  const gks = [gk1, gk2, gk3].filter(n => n && !isNaN(n));
  const config = {
    ownName: ownName,
    players: tsPlayers,
    gks: gks
  };
  localStorage.setItem(TEAM_CONFIG_KEY, JSON.stringify(config));
  alert('✅ 自チーム設定を保存しました');
  closeTeamSettings();
}

function getTeamConfig() {
  const savedConfig = localStorage.getItem(TEAM_CONFIG_KEY);
  if (savedConfig) {
    return JSON.parse(savedConfig);
  }
  return { ...DEFAULT_TEAM_CONFIG, gks: [] };
}

// ===== 相手チーム管理 =====
const OPP_REGISTRY_KEY = 'handball_opp_teams';
let oppEditPlayers = [];
let oppEditingTeamId = null;

function getOppRegistry() {
  const data = localStorage.getItem(OPP_REGISTRY_KEY);
  return data ? JSON.parse(data) : [];
}

function saveOppRegistry(teams) {
  localStorage.setItem(OPP_REGISTRY_KEY, JSON.stringify(teams));
}

function initOppRegistry() {
  document.getElementById('homeOppRegistryBtn').addEventListener('click', openOppRegistry);
  document.getElementById('oppRegistryCloseBtn').addEventListener('click', closeOppRegistry);
  document.getElementById('oppEditCloseBtn').addEventListener('click', closeOppRegistry);
  document.getElementById('oppAddTeamBtn').addEventListener('click', addOppTeam);
  document.getElementById('oppNewTeamName').addEventListener('keydown', (e) => { if (e.key === 'Enter') addOppTeam(); });
  document.getElementById('oppEditBackBtn').addEventListener('click', showOppListView);
  document.getElementById('oppEditSaveBtn').addEventListener('click', saveOppTeamEdit);
  document.getElementById('oppEditAddPlayerBtn').addEventListener('click', oppEditAddPlayer);
  document.getElementById('oppEditPlayerNo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('oppEditPlayerName').focus();
  });
  document.getElementById('oppEditPlayerName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') oppEditAddPlayer();
  });
}

function openOppRegistry() {
  showOppListView();
  document.getElementById('oppRegistryModal').style.display = 'flex';
}

function closeOppRegistry() {
  document.getElementById('oppRegistryModal').style.display = 'none';
}

function showOppListView() {
  document.getElementById('oppRegistryListView').style.display = '';
  document.getElementById('oppRegistryEditView').style.display = 'none';
  renderOppTeamList();
}

function renderOppTeamList() {
  const container = document.getElementById('oppTeamList');
  const teams = getOppRegistry();
  if (teams.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px 0;">登録されたチームはありません</p>';
    return;
  }
  container.innerHTML = teams.map(t => `
    <div class="opp-team-item">
      <div class="opp-team-info" onclick="editOppTeam('${t.id}')">
        <div class="opp-team-name">${t.name}</div>
        <div class="opp-team-meta">${t.players.length}人登録</div>
      </div>
      <button class="ts-player-remove" onclick="event.stopPropagation(); deleteOppTeam('${t.id}')" style="font-size:0.9rem;">✕</button>
    </div>
  `).join('');
}

function addOppTeam() {
  const nameInput = document.getElementById('oppNewTeamName');
  const name = nameInput.value.trim();
  if (!name) return;
  const teams = getOppRegistry();
  teams.push({ id: `opp_${Date.now()}`, name, players: [], gks: [] });
  saveOppRegistry(teams);
  nameInput.value = '';
  renderOppTeamList();
}

function deleteOppTeam(id) {
  if (!confirm('このチームを削除しますか？')) return;
  const teams = getOppRegistry().filter(t => t.id !== id);
  saveOppRegistry(teams);
  renderOppTeamList();
}
window.deleteOppTeam = deleteOppTeam;

function editOppTeam(id) {
  const teams = getOppRegistry();
  const team = teams.find(t => t.id === id);
  if (!team) return;
  oppEditingTeamId = id;
  oppEditPlayers = [...team.players];
  document.getElementById('oppEditTeamName').value = team.name;
  document.getElementById('oppEditTitle').textContent = team.name;
  document.getElementById('oppEditGk1').value = team.gks && team.gks[0] ? team.gks[0] : '';
  document.getElementById('oppEditGk2').value = team.gks && team.gks[1] ? team.gks[1] : '';
  document.getElementById('oppEditGk3').value = team.gks && team.gks[2] ? team.gks[2] : '';
  renderOppEditPlayers();
  document.getElementById('oppRegistryListView').style.display = 'none';
  document.getElementById('oppRegistryEditView').style.display = '';
}
window.editOppTeam = editOppTeam;

function renderOppEditPlayers() {
  const container = document.getElementById('oppEditPlayerList');
  if (oppEditPlayers.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;text-align:center;">選手が登録されていません</p>';
    return;
  }
  container.innerHTML = oppEditPlayers.map(p => `
    <div class="ts-player-item">
      <span class="ts-player-no">#${p.no}</span>
      <span class="ts-player-name">${p.name || ''}</span>
      <button class="ts-player-remove" onclick="oppEditRemovePlayer(${p.no})">✕</button>
    </div>
  `).join('');
}

function oppEditAddPlayer() {
  const noInput = document.getElementById('oppEditPlayerNo');
  const nameInput = document.getElementById('oppEditPlayerName');
  const no = parseInt(noInput.value);
  if (!no || no < 1 || no > 99) return;
  if (oppEditPlayers.some(p => p.no === no)) { noInput.value = ''; nameInput.value = ''; return; }
  oppEditPlayers.push({ no, name: nameInput.value.trim() });
  oppEditPlayers.sort((a, b) => a.no - b.no);
  renderOppEditPlayers();
  noInput.value = '';
  nameInput.value = '';
  noInput.focus();
}

function oppEditRemovePlayer(no) {
  oppEditPlayers = oppEditPlayers.filter(p => p.no !== no);
  renderOppEditPlayers();
}
window.oppEditRemovePlayer = oppEditRemovePlayer;

function saveOppTeamEdit() {
  const name = document.getElementById('oppEditTeamName').value.trim();
  if (!name) { alert('チーム名を入力してください'); return; }
  const gk1 = parseInt(document.getElementById('oppEditGk1').value);
  const gk2 = parseInt(document.getElementById('oppEditGk2').value);
  const gk3 = parseInt(document.getElementById('oppEditGk3').value);
  const gks = [gk1, gk2, gk3].filter(n => n && !isNaN(n));
  const teams = getOppRegistry();
  const idx = teams.findIndex(t => t.id === oppEditingTeamId);
  if (idx >= 0) {
    teams[idx].name = name;
    teams[idx].players = oppEditPlayers;
    teams[idx].gks = gks;
    saveOppRegistry(teams);
    alert('✅ 保存しました');
    showOppListView();
  }
}

// 試合設定画面での相手チーム自動入力
function initOppAutoFill() {
  const oppInput = document.getElementById('oppTeamInput');
  if (!oppInput) return;

  // 候補表示用の要素を作成
  const suggestBox = document.createElement('div');
  suggestBox.id = 'oppTeamSuggest';
  suggestBox.className = 'opp-suggest-box';
  suggestBox.style.display = 'none';
  oppInput.parentNode.style.position = 'relative';
  oppInput.parentNode.appendChild(suggestBox);

  oppInput.addEventListener('input', () => {
    const val = oppInput.value.trim();
    if (!val) { suggestBox.style.display = 'none'; return; }
    const teams = getOppRegistry();
    const matches = teams.filter(t => t.name.toLowerCase().includes(val.toLowerCase()));
    if (matches.length === 0) { suggestBox.style.display = 'none'; return; }
    suggestBox.innerHTML = matches.map(t =>
      `<div class="opp-suggest-item" data-id="${t.id}">${t.name}<span class="opp-suggest-meta">${t.players.length}人</span></div>`
    ).join('');
    suggestBox.style.display = '';
    suggestBox.querySelectorAll('.opp-suggest-item').forEach(item => {
      item.addEventListener('click', () => {
        applyOppTeam(item.dataset.id);
        suggestBox.style.display = 'none';
      });
    });
  });

  oppInput.addEventListener('blur', () => {
    setTimeout(() => { suggestBox.style.display = 'none'; }, 200);
  });
}

function applyOppTeam(teamId) {
  const teams = getOppRegistry();
  const team = teams.find(t => t.id === teamId);
  if (!team) return;
  document.getElementById('oppTeamInput').value = team.name;
  matchState.oppPlayers = [...team.players];
  renderRegisteredOppPlayers();
  // GK自動入力
  if (team.gks && team.gks.length > 0) {
    if (document.getElementById('oppGkInput1')) document.getElementById('oppGkInput1').value = team.gks[0] || '';
    if (document.getElementById('oppGkInput2')) document.getElementById('oppGkInput2').value = team.gks[1] || '';
    if (document.getElementById('oppGkInput3')) document.getElementById('oppGkInput3').value = team.gks[2] || '';
  }
}

function showHomeScreen() {
  document.getElementById('mainScreen').style.display = 'none';
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('homeScreen').style.display = 'block';
  renderMatchList();
}

function getMatchIndex() {
  const idx = localStorage.getItem(INDEX_KEY);
  return idx ? JSON.parse(idx) : [];
}

function saveMatchIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function migrateOldData() {
  const oldDataStr = localStorage.getItem(STORAGE_KEY);
  if (oldDataStr) {
    try {
      const data = JSON.parse(oldDataStr);
      data.id = `match_migrated_${Date.now()}`;
      localStorage.setItem(`handball_${data.id}`, JSON.stringify(data));

      const index = getMatchIndex();
      index.push({
        id: data.id,
        ownName: data.ownName,
        oppName: data.oppName,
        tournamentName: data.tournamentName || '',
        date: new Date(data.startTime || Date.now()).toISOString(),
        scoreOwn: data.stats ? data.stats.own.Score : 0,
        scoreOpp: data.stats ? data.stats.opp.Score : 0
      });
      saveMatchIndex(index);
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error('Migration failed', e);
    }
  }
}

function renderMatchList() {
  const container = document.getElementById('matchListContainer');
  const index = getMatchIndex();

  if (index.length === 0) {
    container.innerHTML = '<p class="setup-hint" style="text-align: center;">過去のデータはありません</p>';
    return;
  }

  // 1. Group by tournamentName
  const grouped = {};
  index.forEach(match => {
    const tName = match.tournamentName && match.tournamentName.trim() !== '' ? match.tournamentName : '未分類';
    if (!grouped[tName]) {
      grouped[tName] = [];
    }
    grouped[tName].push(match);
  });

  // 2. Sort groups
  const groupArray = Object.keys(grouped).map(key => {
    const matches = grouped[key];
    matches.sort((a, b) => new Date(b.date) - new Date(a.date));
    const preparedCount = matches.filter(m => m.status === 'prepared').length;
    return {
      name: key,
      matches: matches,
      latestDate: new Date(matches[0].date).getTime(),
      preparedCount: preparedCount
    };
  });

  groupArray.sort((a, b) => {
    if (a.name === '未分類') return 1;
    if (b.name === '未分類') return -1;
    return b.latestDate - a.latestDate;
  });

  // 3. Render folder grid (Files app style)
  let html = '<div class="folder-grid">';
  groupArray.forEach(group => {
    const latestMatch = group.matches[0];
    const d = new Date(latestMatch.date);
    const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    const preparedBadge = group.preparedCount > 0 ? `<span class="folder-badge-prepared">${group.preparedCount}件準備中</span>` : '';

    html += `
      <div class="folder-card" onclick="openFolder('${group.name.replace(/'/g, "\\'")}')">
        <div class="folder-card-icon">📁</div>
        <div class="folder-card-name">${group.name}</div>
        <div class="folder-card-meta">${group.matches.length}試合 · ${dateStr}</div>
        ${preparedBadge}
      </div>
    `;
  });
  html += '</div>';

  container.innerHTML = html;
}

let folderEditMode = false;
let selectedMatchIds = new Set();
let currentOpenFolderName = null;

function openFolder(folderName) {
  currentOpenFolderName = folderName;
  const container = document.getElementById('matchListContainer');
  const index = getMatchIndex();

  const matches = index.filter(m => {
    const tName = m.tournamentName && m.tournamentName.trim() !== '' ? m.tournamentName : '未分類';
    return tName === folderName;
  });
  matches.sort((a, b) => new Date(b.date) - new Date(a.date));

  const editBtnLabel = folderEditMode ? '完了' : '編集';
  const editBtnClass = folderEditMode ? 'folder-edit-btn active' : 'folder-edit-btn';

  let html = `
    <div class="folder-detail-header">
      <button class="folder-back-btn" onclick="closeFolderView()">◀ 戻る</button>
      <div class="folder-detail-title">📁 ${folderName}</div>
      <div class="folder-detail-count">${matches.length}試合</div>
      <button class="${editBtnClass}" onclick="toggleFolderEditMode()">${editBtnLabel}</button>
    </div>
  `;

  if (folderEditMode) {
    html += `
      <div class="folder-batch-bar">
        <span id="selectedCount">${selectedMatchIds.size}件選択中</span>
        <button class="folder-batch-delete-btn" onclick="batchDeleteMatches()" ${selectedMatchIds.size === 0 ? 'disabled' : ''}>🗑 選択を削除</button>
      </div>
    `;
  }

  html += '<div class="folder-detail-list">';

  matches.forEach(match => {
    const d = new Date(match.date);
    const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    const title = `${match.ownName} vs ${match.oppName}`;
    const isSelected = selectedMatchIds.has(match.id);

    if (folderEditMode) {
      // 編集モード: チェックボックス付き
      html += `
        <div class="match-list-item ${isSelected ? 'match-selected' : ''}" onclick="toggleMatchSelect('${match.id}')">
          <div class="match-checkbox ${isSelected ? 'checked' : ''}">✓</div>
          <div class="match-item-info">
            <div class="match-item-title">${match.status === 'prepared' ? '📋 ' : ''}${title}</div>
            <div class="match-item-date">${match.status === 'prepared' ? '事前準備済み' : dateStr}</div>
            <div class="match-item-score">${match.status === 'prepared' ? '' : `${match.scoreOwn} - ${match.scoreOpp}`}</div>
          </div>
        </div>
      `;
    } else {
      // 通常モード
      if (match.status === 'prepared') {
        html += `
          <div class="match-list-item match-prepared" onclick="startPreparedMatch('${match.id}')">
            <div class="match-item-info">
              <div class="match-item-title">📋 ${title}</div>
              <div class="match-item-date">事前準備済み</div>
              <div class="match-item-score" style="color:#5eead4;">▶ タップで開始</div>
            </div>
            <button class="match-delete-btn" onclick="event.stopPropagation(); deleteMatchById('${match.id}')" title="削除">🗑️</button>
          </div>
        `;
      } else {
        html += `
          <div class="match-list-item" onclick="resumeMatchById('${match.id}')">
            <div class="match-item-info">
              <div class="match-item-title">${title}</div>
              <div class="match-item-date">${dateStr}</div>
              <div class="match-item-score">${match.scoreOwn} - ${match.scoreOpp}</div>
            </div>
            <button class="match-delete-btn" onclick="event.stopPropagation(); deleteMatchById('${match.id}')" title="削除">🗑️</button>
          </div>
        `;
      }
    }
  });

  html += '</div>';
  container.innerHTML = html;
}

function toggleFolderEditMode() {
  folderEditMode = !folderEditMode;
  if (!folderEditMode) selectedMatchIds.clear();
  openFolder(currentOpenFolderName);
}

function toggleMatchSelect(id) {
  if (selectedMatchIds.has(id)) {
    selectedMatchIds.delete(id);
  } else {
    selectedMatchIds.add(id);
  }
  openFolder(currentOpenFolderName);
}

function batchDeleteMatches() {
  if (selectedMatchIds.size === 0) return;
  if (!confirm(`${selectedMatchIds.size}件の試合データを削除しますか？\nこの操作は取り消せません。`)) return;

  selectedMatchIds.forEach(id => {
    localStorage.removeItem(`handball_${id}`);
  });

  const index = getMatchIndex();
  saveMatchIndex(index.filter(m => !selectedMatchIds.has(m.id)));
  selectedMatchIds.clear();
  folderEditMode = false;

  // フォルダ内に試合が残っているか確認
  const remaining = getMatchIndex().filter(m => {
    const tName = m.tournamentName && m.tournamentName.trim() !== '' ? m.tournamentName : '未分類';
    return tName === currentOpenFolderName;
  });

  if (remaining.length === 0) {
    renderMatchList(); // フォルダが空ならフォルダ一覧に戻る
  } else {
    openFolder(currentOpenFolderName);
  }
}

function closeFolderView() {
  folderEditMode = false;
  selectedMatchIds.clear();
  currentOpenFolderName = null;
  renderMatchList();
}
window.openFolder = openFolder;
window.closeFolderView = closeFolderView;
window.toggleFolderEditMode = toggleFolderEditMode;
window.toggleMatchSelect = toggleMatchSelect;
window.batchDeleteMatches = batchDeleteMatches;

// ========================================
// 試合設定画面
// ========================================
function initSetupScreen() {
  const addBtn = document.getElementById('addPlayerBtn');
  const startBtn = document.getElementById('startMatchBtn');
  const noInput = document.getElementById('playerNoInput');
  const nameInput = document.getElementById('playerNameInput');

  // Load Default or Saved Team Config
  loadSavedTeamConfig();

  addBtn.addEventListener('click', () => addPlayer());
  noInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPlayer(); });

  // Opp Player Registration
  const addOppBtn = document.getElementById('addOppPlayerBtn');
  const oppNoInput = document.getElementById('oppPlayerNoInput');
  const oppNameInput = document.getElementById('oppPlayerNameInput');

  if (addOppBtn) {
    addOppBtn.addEventListener('click', addOppPlayer);
    oppNoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') oppNameInput.focus(); });
    oppNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addOppPlayer(); });
  }

  startBtn.addEventListener('click', () => {
    if (isPrepareMode) {
      prepareMatchSave();
    } else {
      startMatch();
    }
  });

  document.getElementById('resumeBtn')?.addEventListener('click', resumeMatch);
  document.getElementById('resetBtn')?.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    document.getElementById('resumeSection').style.display = 'none';
  });
}

function updateSetupButtons() {
  const startBtn = document.getElementById('startMatchBtn');
  if (isPrepareMode) {
    startBtn.textContent = '💾 保存（事前準備）';
    startBtn.classList.add('btn-secondary');
    startBtn.classList.remove('btn-start');
  } else {
    startBtn.textContent = '🏟️ 試合開始';
    startBtn.classList.remove('btn-secondary');
    startBtn.classList.add('btn-start');
  }
}

function loadSavedTeamConfig() {
  const config = getTeamConfig();
  document.getElementById('ownTeamInput').value = config.ownName || '';
  matchState.players = [...(config.players || [])];

  // GK auto-fill
  if (config.gks && config.gks.length > 0) {
    if (document.getElementById('ownGkInput1')) document.getElementById('ownGkInput1').value = config.gks[0] || '';
    if (document.getElementById('ownGkInput2')) document.getElementById('ownGkInput2').value = config.gks[1] || '';
    if (document.getElementById('ownGkInput3')) document.getElementById('ownGkInput3').value = config.gks[2] || '';
  }
  renderRegisteredPlayers();
}

function saveTeamConfig() {
  const config = {
    ownName: document.getElementById('ownTeamInput').value || matchState.ownName,
    players: matchState.players,
    gks: matchState.ownGkList || []
  };
  localStorage.setItem(TEAM_CONFIG_KEY, JSON.stringify(config));
}

function addPlayer() {
  const noInput = document.getElementById('playerNoInput');
  const nameInput = document.getElementById('playerNameInput');
  const no = parseInt(noInput.value);
  if (!no || no < 1 || no > 99) return;

  const name = nameInput.value.trim();
  if (matchState.players.some(p => p.no === no)) {
    noInput.value = '';
    nameInput.value = '';
    return;
  }
  matchState.players.push({ no, name });
  matchState.players.sort((a, b) => a.no - b.no);
  renderRegisteredPlayers();
  noInput.value = '';
  nameInput.value = '';
  noInput.focus();
}

function removePlayer(no) {
  matchState.players = matchState.players.filter(p => p.no !== no);
  renderRegisteredPlayers();
}

function renderRegisteredPlayers() {
  const container = document.getElementById('registeredPlayers');
  container.innerHTML = matchState.players.map(p => `
    <div class="registered-player">
      #${p.no}${p.name ? ` ${p.name}` : ''}
      <button class="remove-player" onclick="removePlayer(${p.no})">✕</button>
    </div>
  `).join('');
}

function addOppPlayer() {
  const noInput = document.getElementById('oppPlayerNoInput');
  const nameInput = document.getElementById('oppPlayerNameInput');
  const no = parseInt(noInput.value);
  if (!no || no < 1 || no > 99) return;

  const name = nameInput.value.trim();
  if (matchState.oppPlayers.some(p => p.no === no)) {
    noInput.value = '';
    nameInput.value = '';
    return;
  }
  matchState.oppPlayers.push({ no, name });
  matchState.oppPlayers.sort((a, b) => a.no - b.no);
  renderRegisteredOppPlayers();
  noInput.value = '';
  nameInput.value = '';
  noInput.focus();
}

function removeOppPlayer(no) {
  matchState.oppPlayers = matchState.oppPlayers.filter(p => p.no !== no);
  renderRegisteredOppPlayers();
}

function renderRegisteredOppPlayers() {
  const container = document.getElementById('registeredOppPlayers');
  if (!container) return;
  container.innerHTML = matchState.oppPlayers.map(p => `
    <div class="registered-player">
      #${p.no}${p.name ? ` ${p.name}` : ''}
      <button class="remove-player" onclick="removeOppPlayer(${p.no})">✕</button>
    </div>
    `).join('');
}

function startMatch() {
  const ownName = document.getElementById('ownTeamInput').value.trim();
  const oppName = document.getElementById('oppTeamInput').value.trim();

  // Get GK Inputs
  const ownGk1 = parseInt(document.getElementById('ownGkInput1').value);
  const ownGk2 = parseInt(document.getElementById('ownGkInput2').value);
  const ownGk3 = parseInt(document.getElementById('ownGkInput3').value);
  const ownGks = [ownGk1, ownGk2, ownGk3].filter(n => n && !isNaN(n));

  const oppGk1 = parseInt(document.getElementById('oppGkInput1').value);
  const oppGk2 = parseInt(document.getElementById('oppGkInput2').value);
  const oppGk3 = parseInt(document.getElementById('oppGkInput3').value);
  const oppGks = [oppGk1, oppGk2, oppGk3].filter(n => n && !isNaN(n));

  const halfDuration = parseInt(document.getElementById('halfDurationInput').value);

  const isPracticeMatch = document.getElementById('practiceModeToggle').checked;

  if (!ownName || !oppName) {
    alert('チーム名を入力してください');
    return;
  }
  if (matchState.players.length === 0) {
    alert('少なくとも1人の選手を登録してください');
    return;
  }
  if (ownGks.length === 0) {
    alert('自チームGK番号を少なくとも1人入力してください');
    return;
  }
  if (!halfDuration || halfDuration < 1) {
    alert('ハーフ時間を正しく入力してください');
    return;
  }

  matchState.isPracticeMatch = isPracticeMatch;

  if (isPracticeMatch) {
    const practicePlayers = [
      { no: 'LW', name: 'レフトウィング' },
      { no: 'LB', name: 'レフトバック' },
      { no: 'CB', name: 'センターバック' },
      { no: 'PV', name: 'ポスト' },
      { no: 'RB', name: 'ライトバック' },
      { no: 'RW', name: 'ライトウィング' },
      { no: 'GK', name: 'ゴールキーパー' }
    ];
    matchState.oppPlayers = [...practicePlayers];
    matchState.ownGkList = ownGks;
    matchState.oppGkList = ['GK'];
    matchState.ownGk = ownGks[0];
    matchState.oppGk = 'GK';
  } else {
    matchState.ownGkList = ownGks;
    matchState.oppGkList = oppGks;
    matchState.ownGk = ownGks[0];
    matchState.oppGk = oppGks.length > 0 ? oppGks[0] : 1;
  }

  matchState.ownName = ownName;
  matchState.oppName = oppName;
  matchState.tournamentName = document.getElementById('tournamentNameInput').value.trim();

  matchState.halfDuration = halfDuration;
  matchState.actions = [];
  matchState.stats = computeStats([]);
  matchState.startTime = Date.now(); // Set start time

  if (!matchState.id) {
    matchState.id = `match_${Date.now()}`;
  }

  // indexに追加
  const index = getMatchIndex();
  const existingIdx = index.findIndex(m => m.id === matchState.id);
  const matchInfo = {
    id: matchState.id,
    ownName: matchState.ownName,
    oppName: matchState.oppName,
    tournamentName: matchState.tournamentName || '',
    date: new Date(matchState.startTime).toISOString(),
    scoreOwn: 0,
    scoreOpp: 0
  };

  if (existingIdx >= 0) {
    index[existingIdx] = matchInfo;
  } else {
    index.push(matchInfo);
  }
  saveMatchIndex(index);

  saveData();
  sessionInitialSnapshot = JSON.stringify(matchState);
  showMainScreen();
}

function prepareMatchSave() {
  const ownName = document.getElementById('ownTeamInput').value.trim();
  const oppName = document.getElementById('oppTeamInput').value.trim();

  if (!ownName || !oppName) {
    alert('チーム名を入力してください');
    return;
  }

  // GK（任意）
  const ownGk1 = parseInt(document.getElementById('ownGkInput1').value);
  const ownGk2 = parseInt(document.getElementById('ownGkInput2').value);
  const ownGk3 = parseInt(document.getElementById('ownGkInput3').value);
  const ownGks = [ownGk1, ownGk2, ownGk3].filter(n => n && !isNaN(n));

  const oppGk1 = parseInt(document.getElementById('oppGkInput1').value);
  const oppGk2 = parseInt(document.getElementById('oppGkInput2').value);
  const oppGk3 = parseInt(document.getElementById('oppGkInput3').value);
  const oppGks = [oppGk1, oppGk2, oppGk3].filter(n => n && !isNaN(n));

  const halfDuration = parseInt(document.getElementById('halfDurationInput').value) || 30;
  const isPracticeMatch = document.getElementById('practiceModeToggle').checked;

  matchState.isPracticeMatch = isPracticeMatch;

  if (isPracticeMatch) {
    const practicePlayers = [
      { no: 'LW', name: 'レフトウィング' },
      { no: 'LB', name: 'レフトバック' },
      { no: 'CB', name: 'センターバック' },
      { no: 'PV', name: 'ポスト' },
      { no: 'RB', name: 'ライトバック' },
      { no: 'RW', name: 'ライトウィング' },
      { no: 'GK', name: 'ゴールキーパー' }
    ];
    matchState.oppPlayers = [...practicePlayers];
    matchState.ownGkList = ownGks;
    matchState.oppGkList = ['GK'];
    matchState.ownGk = ownGks.length > 0 ? ownGks[0] : null;
    matchState.oppGk = 'GK';
  } else {
    matchState.ownGkList = ownGks;
    matchState.oppGkList = oppGks;
    matchState.ownGk = ownGks.length > 0 ? ownGks[0] : null;
    matchState.oppGk = oppGks.length > 0 ? oppGks[0] : null;
  }

  matchState.ownName = ownName;
  matchState.oppName = oppName;
  matchState.tournamentName = document.getElementById('tournamentNameInput').value.trim();
  matchState.halfDuration = halfDuration;
  matchState.actions = [];
  matchState.stats = computeStats([]);
  matchState.startTime = Date.now();

  if (!matchState.id) {
    matchState.id = `match_${Date.now()}`;
  }

  // indexに追加（status: prepared）
  const index = getMatchIndex();
  const existingIdx = index.findIndex(m => m.id === matchState.id);
  const matchInfo = {
    id: matchState.id,
    ownName: matchState.ownName,
    oppName: matchState.oppName,
    tournamentName: matchState.tournamentName || '',
    date: new Date(matchState.startTime).toISOString(),
    scoreOwn: 0,
    scoreOpp: 0,
    status: 'prepared'
  };

  if (existingIdx >= 0) {
    index[existingIdx] = matchInfo;
  } else {
    index.push(matchInfo);
  }
  saveMatchIndex(index);
  saveData();

  isPrepareMode = false;
  alert(`✅ 事前準備を保存しました！\n${ownName} vs ${oppName}\nホーム画面のフォルダから「▶ タップで開始」で試合を始められます。`);
  showHomeScreen();
}

function startPreparedMatch(matchId) {
  // 準備済み試合を読み込んで開始
  const dataStr = localStorage.getItem(`handball_${matchId}`);
  if (!dataStr) {
    alert('データが見つかりません');
    return;
  }

  const data = JSON.parse(dataStr);
  Object.assign(matchState, data);
  matchState.id = matchId;
  matchState.startTime = Date.now(); // 開始時刻を更新

  // indexのstatusをactiveに変更
  const index = getMatchIndex();
  const idx = index.findIndex(m => m.id === matchId);
  if (idx >= 0) {
    index[idx].status = 'active';
    index[idx].date = new Date().toISOString();
    saveMatchIndex(index);
  }

  isNewMatchSession = true;
  sessionInitialSnapshot = JSON.stringify(matchState);
  showMainScreen();
}

function checkSavedData() {
  // 過去のresumeSection表示ロジックは削除（ホーム画面のリストを使うため）
  document.getElementById('resumeSection').style.display = 'none';
}

// ... (resumeMatch - no change needed as it rehydrates matchState directly) ...

// ... (in initMatchMenu) ...

document.getElementById('exportBtn').addEventListener('click', () => {
  const data = JSON.stringify(matchState, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  // Filename: [Tournament_]Own_vs_Opp_Date.json
  const dateStr = new Date().toISOString().slice(0, 10);
  const tournamentPart = matchState.tournamentName ? `${matchState.tournamentName}_` : '';
  a.download = `${tournamentPart}${matchState.ownName}_vs_${matchState.oppName}_${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

function resumeMatchById(id) {
  const saved = localStorage.getItem(`handball_${id}`);
  if (!saved) {
    alert('データが見つかりません');
    return;
  }

  try {
    const data = JSON.parse(saved);
    // ストップウォッチ状態を復元
    if (data._stopwatch) {
      stopwatch.elapsed = data._stopwatch.elapsed || 0;
      stopwatch.half = data._stopwatch.half || 1;
      stopwatch.finished = data._stopwatch.finished || false;
      delete data._stopwatch;
    }
    matchState = data; // 復元
    sessionInitialSnapshot = JSON.stringify(matchState);
    isNewMatchSession = false;
    matchState.stats = computeStats(matchState.actions);

    // Setup画面の入力値も復元（再設定時用）
    document.getElementById('ownTeamInput').value = matchState.ownName;
    document.getElementById('oppTeamInput').value = matchState.oppName;
    if (matchState.tournamentName) document.getElementById('tournamentNameInput').value = matchState.tournamentName;

    showMainScreen();
  } catch (e) {
    alert('データの読み込みに失敗しました');
    console.error(e);
  }
}
// グローバル空間に公開してHTMLから叩けるようにする
window.resumeMatchById = resumeMatchById;

function deleteMatchById(id) {
  if (!confirm('この試合データを削除しますか？\nこの操作は取り消せません。')) return;

  // localStorageから試合データを削除
  localStorage.removeItem(`handball_${id}`);

  // インデックスからも削除
  const index = getMatchIndex();
  saveMatchIndex(index.filter(m => m.id !== id));

  // リストを再描画
  renderMatchList();
}
window.deleteMatchById = deleteMatchById;

function showMainScreen() {
  document.getElementById('homeScreen').style.display = 'none';
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'block';

  // Header
  document.getElementById('headerOwnName').textContent = matchState.ownName;
  document.getElementById('headerOppName').textContent = matchState.oppName;
  document.getElementById('teamBtnOwnName').textContent = matchState.ownName;
  document.getElementById('teamBtnOppName').textContent = matchState.oppName;
  document.getElementById('currentOwnGk').textContent = matchState.ownGk || '-';
  document.getElementById('currentOppGk').textContent = matchState.oppGk || '-';

  // Initialize input UI
  renderPlayerGrid();
  updateScoreDisplay();
  renderHistory();
  renderHistory();
  updateStopwatchDisplay();

  // Intersection Observer for Sticky Timer
  if (!window.stickyObserver) {
    window.stickyObserver = new IntersectionObserver((entries) => {
      const sticky = document.getElementById('stickyTimer');
      const entry = entries[0];
      // stopwatch-sectionが見えなくなり、かつ画面より上にある場合
      if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
        if (!matchState.startTime) return;
        sticky.style.display = 'flex';
      } else {
        sticky.style.display = 'none';
      }
    }, { threshold: 0 });

    const target = document.querySelector('.stopwatch-section');
    if (target) window.stickyObserver.observe(target);
  }
}

// ========================================
// データ永続化
// ========================================
function saveData() {
  if (!matchState.id) return; // Prevent saving empty state

  const saveObj = { ...matchState };
  // ストップウォッチ状態も保存
  saveObj._stopwatch = {
    elapsed: stopwatch.elapsed,
    half: stopwatch.half,
    finished: stopwatch.finished
  };
  localStorage.setItem(`handball_${matchState.id}`, JSON.stringify(saveObj));
}

// ========================================
// 入力パネル
// ========================================
// ========================================
// 入力パネル
// ========================================
function initInputPanel() {
  // Team buttons
  document.querySelectorAll('.team-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      inputState.team = btn.dataset.team;
      inputState.playerNo = null;
      renderPlayerGrid();
      resetActionSelection();
    });
  });

  // Phase buttons
  document.querySelectorAll('.phase-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.phase-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      inputState.phase = btn.dataset.phase;
    });
  });

  // ---------------------------------------------------------
  // 新しい入力フロー: コートエリア選択
  // ---------------------------------------------------------
  document.querySelectorAll('.court-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.court-action-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const area = btn.dataset.area;
      inputState.zone = null;
      inputState.action = null;
      inputState.course = null;

      // Reset Active States
      document.querySelectorAll('.sub-action-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.fixed-btn').forEach(b => b.classList.remove('active'));

      // Show Sub-Action Container
      document.getElementById('subActionContainer').style.display = '';

      // Filter Sub-Action Buttons based on Area
      const subBtns = document.querySelectorAll('.sub-action-btn');
      subBtns.forEach(b => b.style.display = 'none'); // Hide all first

      if (['LW', 'RW'].includes(area)) {
        // Side: Select Zone, Show WS & TO
        inputState.zone = area === 'LW' ? 'L' : 'R'; // Zone is fixed for Side
        // Show WS, TO
        // (If user wants BT from side, add here. For now: WS, TO)
        document.querySelector('.sub-action-btn[data-sub="WS"]').style.display = '';
        document.querySelector('.sub-action-btn[data-sub="TO"]').style.display = '';
      } else {
        // Back (L, C, R): Select Zone, Show DS, BT, LS, TO
        inputState.zone = area;
        // Show DS, BT, LS, TO
        document.querySelector('.sub-action-btn[data-sub="DS"]').style.display = '';
        document.querySelector('.sub-action-btn[data-sub="BT"]').style.display = '';
        document.querySelector('.sub-action-btn[data-sub="LS"]').style.display = '';
        document.querySelector('.sub-action-btn[data-sub="TO"]').style.display = '';
        document.querySelector('.sub-action-btn[data-sub="PS"]').style.display = ''; // Show PS for Back players
      }

      // Hide Course/Result sections until sub-action selected
      document.getElementById('courseSection').style.display = 'none';
      document.getElementById('resultSection').style.display = 'none';
    });
  });

  // ---------------------------------------------------------
  // サブアクション選択 (DS, BT, LS, TO)
  // ---------------------------------------------------------
  document.querySelectorAll('.sub-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Toggle active state
      document.querySelectorAll('.sub-action-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      inputState.action = btn.dataset.sub;
      inputState.course = null;

      if (inputState.action === 'TO') {
        // Hide Shoot Course, Show TO Results (Types)
        document.getElementById('courseSection').style.display = 'none';
        showTOResults();
      } else if (inputState.action === 'PS') {
        // PS Logic -> Show Detail Selection (optional) + Course & Results immediately
        document.getElementById('psDetailSection').style.display = 'block';
        document.getElementById('courseSection').style.display = '';
        showShootResults();
      } else {
        // Shoot actions: Show Course
        document.getElementById('courseSection').style.display = '';
        document.getElementById('psDetailSection').style.display = 'none';
        showShootResults();
      }
    });
  });

  // PS Detail Buttons (toggle)
  document.querySelectorAll('.ps-detail-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('selected')) {
        // 同じボタンを再度押したら選択解除
        btn.classList.remove('selected');
        inputState.psDetail = null;
      } else {
        document.querySelectorAll('.ps-detail-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        inputState.psDetail = btn.dataset.detail;
      }
    });
  });

  // ---------------------------------------------------------
  // 固定アクション選択 (Right Side)
  // ---------------------------------------------------------
  document.querySelectorAll('.fixed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const fixedAction = btn.dataset.fixed;
      const isSanction = ['警告', '退場', '失格'].includes(fixedAction);

      // Special Logic: PT + Sanction
      if (inputState.action === 'PT' && isSanction) {
        // Toggle Sanction
        if (inputState.sanction === fixedAction) {
          // Untoggle
          inputState.sanction = null;
          btn.classList.remove('active-sub');
        } else {
          // Set Sanction (clear previous if any)
          document.querySelectorAll('.fixed-btn').forEach(b => b.classList.remove('active-sub'));
          inputState.sanction = fixedAction;
          btn.classList.add('active-sub');
        }

        // Update Player Input Visibility (Show Opp Input for DF)
        renderPlayerGrid();
        return; // Stop here, do not switch main action
      }

      // Normal Logic
      // 他の選択を解除
      document.querySelectorAll('.court-action-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.fixed-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.fixed-btn').forEach(b => b.classList.remove('active-sub')); // Clear subs
      document.getElementById('subActionContainer').style.display = 'none';
      btn.classList.add('active');

      inputState.action = btn.dataset.fixed;
      inputState.sanction = null; // Clear sanction if switching main action
      inputState.zone = 'C'; // デフォルト
      inputState.course = null;
      document.querySelectorAll('.course-btn').forEach(b => b.classList.remove('active'));

      if (['PT', 'EG'].includes(inputState.action)) {
        // 特殊シュート
        document.getElementById('courseSection').style.display = '';
        showShootResults();
      } else {
        // タイムアウト/罰則 -> 結果不要、即確認へ
        document.getElementById('courseSection').style.display = 'none';
        document.getElementById('resultSection').style.display = 'none';
        inputState.pendingResult = inputState.action; // 結果=アクション名
        if (inputState.action === 'タイムアウト') inputState.pendingResult = 'TimeOut';

        document.getElementById('confirmSection').style.display = '';
      }

      // Re-render player grid (to hide/show inputs correctly)
      renderPlayerGrid();
    });
  });

  // Zone buttons (Hidden in new flow usually, but kept for logic safety if needed)
  document.querySelectorAll('.zone-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.zone-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      inputState.zone = btn.dataset.zone;
    });
  });

  // Course buttons
  document.querySelectorAll('.course-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.course-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      inputState.course = parseInt(btn.dataset.course);
    });
  });

  // Confirm button
  document.getElementById('confirmBtn').addEventListener('click', () => {
    if (inputState.pendingResult) {
      submitAction(inputState.pendingResult);
    }
  });

  // Edit modal buttons
  document.getElementById('editSaveBtn').addEventListener('click', saveEdit);
  document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
  document.getElementById('editModalClose').addEventListener('click', closeEditModal);
  document.getElementById('editModalOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });

  // GK change buttons
  // GK change buttons (with multiple GK support)
  document.getElementById('changeOwnGkBtn').addEventListener('click', () => {
    // If we have a list, cycle or prompt with options?
    // User probably wants to quickly switch. Let's try: prompt with current + options
    // Or better: prompt "New GK No" but placeholder/hint shows registered.
    const list = matchState.ownGkList || [];
    let msg = '自チームの新しいGK番号を入力:';
    if (list.length > 0) {
      msg += `\n(登録済み: ${list.join(', ')})`;
    }
    const newGk = prompt(msg, matchState.ownGk);
    if (newGk && parseInt(newGk)) {
      matchState.ownGk = parseInt(newGk);
      document.getElementById('currentOwnGk').textContent = matchState.ownGk;
      saveData();
    }
  });
  document.getElementById('changeOppGkBtn').addEventListener('click', () => {
    const list = matchState.oppGkList || [];
    let msg = '相手チームの新しいGK番号を入力:';
    if (list.length > 0) {
      msg += `\n(登録済み: ${list.join(', ')})`;
    }
    const newGk = prompt(msg, matchState.oppGk);
    if (newGk && parseInt(newGk)) {
      matchState.oppGk = parseInt(newGk);
      document.getElementById('currentOppGk').textContent = matchState.oppGk;
      saveData();
    }
  });

  // PT Sequence Events
  document.querySelectorAll('.sanction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sanction-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  document.getElementById('sanctionNextBtn').addEventListener('click', () => {
    // 1. Capture Sanction Data
    const selectedBtn = document.querySelector('.sanction-btn.selected');
    const sancAction = selectedBtn ? selectedBtn.dataset.sanction : 'ライン内防御';
    const defNo = parseInt(document.getElementById('sanctionDefenderNo').value) || null;

    // Store Step 2 (Sanction)
    if (!inputState.sequenceData) inputState.sequenceData = {};

    // If "ライン内防御" -> No Card, but maybe record it? 
    // The user request says: "ライン内防御、警告、退場、失格"
    // If "ライン内防御", maybe no sanction card entry? Or just logic flow?
    // Request says: "①PTになったプレー②退場者記載③PTの結果".
    // If no card, ② might be skipped or just a memo.
    // Let's store it. If action is 'ライン内防御', we might treat it differently or just store as is.

    inputState.sequenceData.step2 = {
      action: sancAction,
      no: defNo
    };

    // 2. Prepare Step 3 (PT Shooter Selection)
    // Switch Action to PT
    inputState.action = 'PT';
    inputState.zone = 'C';
    inputState.course = null;
    inputState.sanction = null; // We handled sanction in step2 data

    // Switch UI to Player Grid (Shooter)
    document.getElementById('sanctionSequenceSection').style.display = 'none';
    document.getElementById('courseSection').style.display = ''; // Prepare for PT shoot
    showShootResults(); // Show PT results (Goal/Save/etc) - note: this logic calls showShootResults again, which adds "PT Flow" button again. Ideally we want standard PT results.
    // Fix: showShootResults adds "PT Flow" button. But for Action=PT, we probably don't want to loop back to PT Flow.
    // We should check if Action is PT in showShootResults or just hide it.
    // Or just let it be, user won't click it again.

    renderPlayerGrid(); // Show shooter grid
    document.querySelector('.input-panel').scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('sanctionCancelBtn').addEventListener('click', () => {
    resetActionSelection();
  });
}

// ========================================
// ストップウォッチ
// ========================================
function initStopwatchEvents() {
  document.getElementById('swStartBtn').addEventListener('click', startStopwatch);
  document.getElementById('swPauseBtn').addEventListener('click', pauseStopwatch);
  document.getElementById('swResumeBtn').addEventListener('click', resumeStopwatch);
  document.getElementById('swHalfBtn').addEventListener('click', endFirstHalf);
  document.getElementById('swEndBtn').addEventListener('click', endMatch);

  // Time Click Edit
  document.getElementById('stopwatchTime').addEventListener('click', editStopwatchTime);
  document.getElementById('stickyTime').addEventListener('click', editStopwatchTime);
}

function editStopwatchTime() {
  const currentTotalSec = Math.floor(stopwatch.elapsed);
  const mm = String(Math.floor(currentTotalSec / 60)).padStart(2, '0');
  const ss = String(currentTotalSec % 60).padStart(2, '0');

  const input = prompt('時間を入力してください (例: 10:00)', `${mm}:${ss}`);
  if (!input) return;

  const parts = input.split(':');
  if (parts.length !== 2) {
    alert('形式が正しくありません (例: 10:00)');
    return;
  }

  const newMin = parseInt(parts[0]);
  const newSec = parseInt(parts[1]);

  if (isNaN(newMin) || isNaN(newSec) || newSec < 0 || newSec > 59) {
    alert('正しい数値を入力してください');
    return;
  }

  const newTotalSec = (newMin * 60) + newSec;
  stopwatch.elapsed = newTotalSec;

  // Adjust/Reset Start Timestamp if running to maintain continuity without jump
  if (stopwatch.running) {
    stopwatch.startTimestamp = Date.now() - (stopwatch.elapsed * 1000);
  }

  updateStopwatchDisplay();
  saveData();
}

function startStopwatch() {
  if (stopwatch.running) return;
  stopwatch.running = true;
  stopwatch.startTimestamp = Date.now() - (stopwatch.elapsed * 1000);
  stopwatch.intervalId = setInterval(tickStopwatch, 200);
  updateStopwatchButtons();
}

function pauseStopwatch() {
  if (!stopwatch.running) return;
  stopwatch.running = false;
  clearInterval(stopwatch.intervalId);
  stopwatch.intervalId = null;
  updateStopwatchButtons();
  saveData();
}

function resumeStopwatch() {
  startStopwatch();
}

function tickStopwatch() {
  stopwatch.elapsed = (Date.now() - stopwatch.startTimestamp) / 1000;
  updateStopwatchDisplay();
}

function endFirstHalf() {
  pauseStopwatch();
  // Valid for: 1 (1st), 3 (Ext1-1st), 5 (Ext2-1st)
  let msg = '前半を終了しますか？';
  if (stopwatch.half === 3) msg = '延長1 前半を終了しますか？';
  if (stopwatch.half === 5) msg = '延長2 前半を終了しますか？';

  if (!confirm(msg)) return;

  stopwatch.half += 1; // 1->2, 3->4, 5->6
  stopwatch.elapsed = 0;
  stopwatch.startTimestamp = null;
  updateStopwatchDisplay();
  updateStopwatchButtons();
  saveData();
}

function endMatch() {
  pauseStopwatch();
  // Valid for: 2 (2nd), 4 (Ext1-2nd), 6 (Ext2-2nd)

  if (stopwatch.half === 6) {
    if (!confirm('延長2 後半を終了して、試合を終了しますか？')) return;
    stopwatch.finished = true;
  } else if (stopwatch.half === 4) {
    // Ext 1 End
    const choice = prompt('延長1 後半終了。\n1: 試合終了\n2: 延長2 へ進む', '1');
    if (choice === '2') {
      stopwatch.half = 5;
      stopwatch.elapsed = 0;
      stopwatch.startTimestamp = null;
    } else {
      stopwatch.finished = true;
    }
  } else {
    // Regular 2nd Half End (half=2)
    const choice = prompt('後半終了。\n1: 試合終了\n2: 延長1 へ進む', '1');
    if (choice === '2') {
      stopwatch.half = 3;
      stopwatch.elapsed = 0;
      stopwatch.startTimestamp = null;
    } else {
      stopwatch.finished = true;
    }
  }

  updateStopwatchDisplay();
  updateStopwatchButtons();
  saveData();
}

function getTimePeriodFromStopwatch() {
  const mins = Math.floor(stopwatch.elapsed / 60);
  const halfDur = matchState.halfDuration || 30;

  let isGrossTime = (mins >= halfDur && (stopwatch.half === 2 || stopwatch.half === 3 || stopwatch.half === 4));
  let offset = 0;

  if (!isGrossTime) {
    if (stopwatch.half === 1) offset = 0;
    else if (stopwatch.half === 2) offset = halfDur;
    else if (stopwatch.half === 3) offset = halfDur * 2; // Ext1 Start (e.g. 60)
    else if (stopwatch.half === 4) offset = (halfDur * 2) + 5; // Ext1 Second
    else if (stopwatch.half === 5) offset = (halfDur * 2) + 10; // Ext2 Start
    else if (stopwatch.half === 6) offset = (halfDur * 2) + 15; // Ext2 Second
  }

  const pStart = Math.floor(mins / 5) * 5;
  const pEnd = pStart + 5;
  return `${String(pStart + offset).padStart(2, '0')}~${String(pEnd + offset).padStart(2, '0')}`;
}

function updateStopwatchDisplay() {
  const totalSec = Math.floor(stopwatch.elapsed);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');

  const timeEl = document.getElementById('stopwatchTime');
  const periodEl = document.getElementById('stopwatchPeriod');
  const badgeEl = document.getElementById('halfBadge');

  timeEl.textContent = `${mm}:${ss} `;
  periodEl.textContent = getTimePeriodFromStopwatch();

  // Sticky Timer Update
  document.getElementById('stickyTime').textContent = `${mm}:${ss} `;
  document.getElementById('stickyPeriod').textContent = getTimePeriodFromStopwatch();

  if (stopwatch.running) {
    timeEl.classList.remove('paused');
  } else if (stopwatch.elapsed > 0 && !stopwatch.finished) {
    timeEl.classList.add('paused');
  } else {
    timeEl.classList.remove('paused');
  }

  badgeEl.className = 'stopwatch-half-badge';
  if (stopwatch.finished) {
    badgeEl.classList.add('finished');
    badgeEl.textContent = '試合終了';
  } else {
    switch (stopwatch.half) {
      case 1: badgeEl.textContent = '前半'; break;
      case 2: badgeEl.classList.add('second-half'); badgeEl.textContent = '後半'; break;
      case 3: badgeEl.className = 'stopwatch-half-badge ext-half'; badgeEl.textContent = '延長1 前'; break;
      case 4: badgeEl.className = 'stopwatch-half-badge ext-half'; badgeEl.textContent = '延長1 後'; break;
      case 5: badgeEl.className = 'stopwatch-half-badge ext-half'; badgeEl.textContent = '延長2 前'; break;
      case 6: badgeEl.className = 'stopwatch-half-badge ext-half'; badgeEl.textContent = '延長2 後'; break;
      default: badgeEl.textContent = '-';
    }
  }
}

function updateStopwatchButtons() {
  const startBtn = document.getElementById('swStartBtn');
  const pauseBtn = document.getElementById('swPauseBtn');
  const resumeBtn = document.getElementById('swResumeBtn');
  const halfBtn = document.getElementById('swHalfBtn');
  const endBtn = document.getElementById('swEndBtn');

  startBtn.style.display = 'none';
  pauseBtn.style.display = 'none';
  resumeBtn.style.display = 'none';
  halfBtn.style.display = 'none';
  endBtn.style.display = 'none';

  if (stopwatch.finished) {
    // 試合終了時は何も表示しない
    return;
  }

  if (stopwatch.running) {
    pauseBtn.style.display = '';
    // Odd halves (1, 3, 5) use "Half End", Even halves (2, 4, 6) use "Match/Period End"
    if (stopwatch.half % 2 !== 0) {
      halfBtn.style.display = '';
    } else {
      endBtn.style.display = '';
    }
  } else {
    // Stopped/Paused
    if (stopwatch.elapsed === 0 && !stopwatch.startTimestamp) {
      // Before Start of a Period
      startBtn.style.display = '';
      if (stopwatch.half === 1) startBtn.textContent = '▶️ 試合開始';
      else if (stopwatch.half === 2) startBtn.textContent = '▶️ 後半開始';
      else if (stopwatch.half === 3) startBtn.textContent = '▶️ 延長1前半開始';
      else if (stopwatch.half === 4) startBtn.textContent = '▶️ 延長1後半開始';
      else if (stopwatch.half === 5) startBtn.textContent = '▶️ 延長2前半開始';
      else if (stopwatch.half === 6) startBtn.textContent = '▶️ 延長2後半開始';

    } else {
      // Paused mid-game
      resumeBtn.style.display = '';
      if (stopwatch.half % 2 !== 0) {
        halfBtn.style.display = '';
      } else {
        endBtn.style.display = '';
      }
    }
  }

  // Update Sticky Button icon
  const stickyBtn = document.getElementById('stickyToggleBtn');
  if (stickyBtn) {
    if (stopwatch.running) {
      stickyBtn.textContent = '⏸️';
      stickyBtn.style.display = 'flex';
    } else if (!stopwatch.finished && stopwatch.elapsed > 0) {
      stickyBtn.textContent = '▶️';
      stickyBtn.style.display = 'flex';
    } else {
      stickyBtn.style.display = 'none';
    }
  }
}

// Sticky Button Handler
function toggleStickyStopwatch() {
  if (stopwatch.running) {
    pauseStopwatch();
  } else {
    resumeStopwatch();
  }
}

function renderPlayerGrid() {
  const grid = document.getElementById('playerGrid');
  const oppInput = document.getElementById('oppPlayerInput');
  const noEl = document.getElementById('oppPlayerNo');

  // Reset Input Event Handler to avoid stacking
  noEl.oninput = null;

  // Logic:
  // 1. If Team is Own: Show Grid.
  // 2. If Team is Opp: Show Grid (if players exist) OR Input.
  // 3. SPECIAL: If Sanction is active (PT+Sanction), force Show Input for DF (Opponent), 
  //    AND keep Grid for Own (Shooter).

  const isSanctionMode = !!inputState.sanction;

  if (inputState.team === 'Own') {
    // Show Own Players Grid
    grid.style.display = 'flex';
    grid.innerHTML = matchState.players.map(p => {
      const isActive = inputState.playerNo === p.no;
      // 自チームは練習試合モードでも名前を表示する
      const nameHtml = p.name ? `<small class="player-btn-name">${p.name}</small>` : '';
      return `<button class="player-btn ${isActive ? 'active' : ''}" data-no="${p.no}" title="${p.name || ''}">${p.no}${nameHtml}</button>`;
    }).join('');

    grid.querySelectorAll('.player-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.player-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const rawNo = btn.dataset.no;
        inputState.playerNo = parseInt(rawNo);
      });
    });

    if (isSanctionMode) {
      // Show Opp Input for Sanction Target
      oppInput.style.display = '';
      oppInput.querySelector('input').placeholder = 'DF#'; // Change placeholder context
      noEl.value = inputState.sanctionPlayerNo || '';
      noEl.oninput = () => { inputState.sanctionPlayerNo = parseInt(noEl.value) || null; };
    } else {
      oppInput.style.display = 'none';
      oppInput.querySelector('input').placeholder = '背番号'; // Reset
    }

  } else {
    // Normal Opp Logic
    if (matchState.oppPlayers && matchState.oppPlayers.length > 0) {
      grid.style.display = 'flex';
      oppInput.style.display = 'none'; // Use grid for Opp too
      grid.innerHTML = matchState.oppPlayers.map(p => {
        const isActive = inputState.playerNo === p.no;
        const nameHtml = (!matchState.isPracticeMatch && p.name) ? `<small class="player-btn-name">${p.name}</small>` : '';
        return `<button class="player-btn ${isActive ? 'active' : ''}" data-no="${p.no}" title="${p.name || ''}">${p.no}${nameHtml}</button>`;
      }).join('');

      grid.querySelectorAll('.player-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          grid.querySelectorAll('.player-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const rawNo = btn.dataset.no;
          inputState.playerNo = matchState.isPracticeMatch ? rawNo : parseInt(rawNo);
        });
      });
    } else {
      grid.style.display = 'none';
      oppInput.style.display = '';
      noEl.value = inputState.playerNo || '';
      noEl.oninput = () => { inputState.playerNo = parseInt(noEl.value) || null; };
    }
  }
}

function resetActionSelection() {
  document.querySelectorAll('.court-action-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sub-action-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.fixed-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.course-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.ps-detail-btn').forEach(b => b.classList.remove('selected')); // Reset PS Details

  document.getElementById('subActionContainer').style.display = 'none';
  // document.getElementById('zoneSection').style.display = 'none'; // Removed as element no longer exists
  document.getElementById('courseSection').style.display = 'none';
  document.getElementById('psDetailSection').style.display = 'none'; // Hide PS Detail
  document.getElementById('resultSection').style.display = 'none';
  document.getElementById('confirmSection').style.display = 'none';
  document.getElementById('sanctionSequenceSection').style.display = 'none'; // Hide sanction seq

  inputState.action = null;
  inputState.zone = null;
  inputState.course = null;
  inputState.psDetail = null; // Reset State
  inputState.pendingResult = null;
  inputState.pendingMemo = null;
  inputState.sanction = null;
  inputState.sanctionPlayerNo = null;
  inputState.sequenceData = null; // Clear sequence data
  cancelInsertMode(); // 挿入モード解除

  // Clear sub-active states
  document.querySelectorAll('.fixed-btn').forEach(b => b.classList.remove('active-sub'));

  // Reset sanction seq UI
  document.querySelectorAll('.sanction-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('sanctionDefenderNo').value = '';

  // Reset DF Input display if it was forced shown
  const oppInput = document.getElementById('oppPlayerInput');
  const playerGrid = document.getElementById('playerGrid');
  // Re-evaluate display based on team (standard logic will handle this in renderPlayerGrid, 
  // but we reset specific overrides here if any)
}

function showShootResults() {
  const section = document.getElementById('resultSection');
  const grid = document.getElementById('resultGrid');
  section.style.display = '';
  grid.classList.remove('single-col');

  grid.innerHTML = `
    <button class="result-btn goal" data-result="Goal">⚽ Goal</button>
    <button class="result-btn miss" data-result="Save">🧤 Save</button>
    <button class="result-btn miss" data-result="Out">❌ Out</button>
    <button class="result-btn miss" data-result="Block">🛡️ Block</button>
    <div style="width:100%; height:1px; background:rgba(255,255,255,0.1); grid-column:span 2; margin:4px 0;"></div>
    <button class="result-btn miss" data-result="PT_Ans_NoShot">7mスロー</button>
  `;

  grid.querySelectorAll('.result-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = btn.dataset.result;
      if (r === 'PT_Ans_Out') {
        startPTSequence('Out');
        return;
      }
      if (r === 'PT_Ans_NoShot') {
        startPTSequence('No Shot');
        return;
      }

      grid.querySelectorAll('.result-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      inputState.pendingResult = r;
      document.getElementById('confirmSection').style.display = '';
    });
  });
}

// PT Sequence Logic
function startPTSequence(prevResult) {
  // Store current action as "Sequence Step 1"
  inputState.sequenceData = {
    step1: {
      team: inputState.team,
      no: inputState.playerNo,
      phase: inputState.phase,
      action: inputState.action, // e.g., BT
      zone: inputState.zone,
      course: inputState.course,
      result: prevResult || 'Out', // 'Out' or 'No Shot'
      memo: 'PT獲得'
    }
  };

  // Switch UI to Sanction Selection
  document.getElementById('resultSection').style.display = 'none';
  document.getElementById('courseSection').style.display = 'none';
  const sanctionSec = document.getElementById('sanctionSequenceSection');
  sanctionSec.style.display = 'block';

  // Sanction Event Listeners (ensure single bind or clean up? simple add here is risky if called multiple times)
  // Better to init these once globally or check. For simplicity in this app structure:
  // We will re-render innerHTML or manage via ID.
  // Since buttons are static in HTML, we should bind them in initInputEvents or helper.
  // Let's rely on global init actions, but here we prepare UI state.
}

function showTOResults() {
  const section = document.getElementById('resultSection');
  const grid = document.getElementById('resultGrid');
  section.style.display = '';
  grid.classList.add('single-col');

  grid.innerHTML = `
    <button class="result-btn miss" data-result="TM" data-memo="パスカット">パスカット</button>
    <button class="result-btn miss" data-result="TM" data-memo="パスミス">パスミス</button>
    <button class="result-btn miss" data-result="TM" data-memo="キャッチミス">キャッチミス</button>
    <button class="result-btn miss" data-result="VL" data-memo="オーバーステップ">オーバーステップ</button>
    <button class="result-btn miss" data-result="VL" data-memo="ラインクロス">ラインクロス</button>
    <button class="result-btn miss" data-result="VL" data-memo="ダブルドリブル">ダブルドリブル</button>
    <button class="result-btn miss" data-result="VL" data-memo="チャージング">チャージング</button>
    <button class="result-btn miss" data-result="VL" data-memo="パッシブ">パッシブ</button>
    <button class="result-btn miss" data-result="TO" data-memo="その他">その他</button>
  `;

  grid.querySelectorAll('.result-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.result-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      inputState.pendingResult = btn.dataset.result;
      inputState.pendingMemo = btn.dataset.memo;
      document.getElementById('confirmSection').style.display = '';
    });
  });
}

function submitAction(result) {
  // Append PS Detail to Memo if applicable
  if (inputState.action === 'PS' && inputState.psDetail) {
    const detailLabel = inputState.psDetail === 'Block' ? 'ブロック' : '裏抜け';
    inputState.pendingMemo = inputState.pendingMemo ? `[${detailLabel}] ${inputState.pendingMemo}` : `[${detailLabel}]`;
  }

  // Validation
  // TOの場合は選手選択任意 (inputState.action === 'TO')
  if (!inputState.playerNo && inputState.action !== 'タイムアウト' && inputState.action !== 'TO') {
    alert('選手番号を選択してください');
    return;
  }
  if (!inputState.action) {
    alert('アクションを選択してください');
    return;
  }
  // Direct record actions do not require a zone
  if (SHOOT_TYPES.includes(inputState.action) && !inputState.zone) {
    alert('ゾーンを選択してください');
    return;
  }

  // Create Sanction Action if exists
  // Create Sanction Action if exists
  const now = getTimePeriodFromStopwatch();
  const exact = document.getElementById('stopwatchTime').textContent.trim();

  // BATCH SUBMISSION FOR PT SEQUENCE
  if (inputState.sequenceData && inputState.sequenceData.step1) {
    const s1 = inputState.sequenceData.step1;
    const s2 = inputState.sequenceData.step2;

    // 1. Previous Action (e.g. BT -> Out/PT獲得)
    addActionToList({
      time: now,
      exactTime: exact,
      half: stopwatch.half,
      own_gk: matchState.ownGk,
      opp_gk: matchState.oppGk,
      team: s1.team,
      no: s1.no,
      phase: s1.phase,
      action: s1.action,
      zone: s1.zone,
      course: s1.course,
      result: s1.result,
      memo: s1.memo
    });

    // 2. Sanction (if applicable)
    // "ライン内防御" usually doesn't need a card record unless user wants to track it.
    // User said: "①PTになったプレー②退場者記載③PTの結果".
    // If "ライン内防御", maybe skip ②?
    // Let's assume we record if it's Warning/suspension/DQ.
    if (s2 && ['警告', '退場', '失格'].includes(s2.action) && s2.no) {
      addActionToList({
        time: now,
        exactTime: exact,
        half: stopwatch.half,
        own_gk: matchState.ownGk,
        opp_gk: matchState.oppGk,
        team: inputState.team === 'Own' ? 'Opp' : 'Own', // Opponent
        no: s2.no,
        phase: s1.phase,
        action: s2.action,
        zone: 'C',
        course: null,
        result: s2.action,
        memo: 'DF反則'
      });
    }

    // 3. PT Action (Current Submission)
    const ptAction = {
      time: now,
      exactTime: exact,
      half: stopwatch.half,
      own_gk: matchState.ownGk,
      opp_gk: matchState.oppGk,
      team: inputState.team,
      no: inputState.playerNo,
      phase: inputState.phase,
      action: 'PT',
      zone: inputState.zone,
      course: inputState.course,
      result: result,
      memo: null
    };
    addActionToList(ptAction);

    // Complete Batch
    matchState.stats = computeStats(matchState.actions);
    saveData();
    updateScoreDisplay();
    renderHistory();
    resetActionSelection();

    // Reset Panel Flash
    const panel = document.querySelector('.input-panel');
    panel.classList.add('input-flash');
    setTimeout(() => panel.classList.remove('input-flash'), 500);

    // Auto-switch Team
    inputState.team = inputState.team === 'Own' ? 'Opp' : 'Own';
    inputState.playerNo = null;
    document.querySelectorAll('.team-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.team === inputState.team);
    });
    renderPlayerGrid();
    return; // Exit function
  }

  if (inputState.sanction) {
    if (inputState.team === 'Own' && !inputState.sanctionPlayerNo) {
      // Sanction needs a target player (Opponent)
      // We can allow empty, but alert might be better. 
      // For now allowing empty if user didn't input.
    }

    const sanctionAction = {
      time: now,
      exactTime: exact,
      half: stopwatch.half,
      own_gk: matchState.ownGk,
      opp_gk: matchState.oppGk,
      team: inputState.team === 'Own' ? 'Opp' : 'Own', // Opposite team gets sanction
      no: inputState.sanctionPlayerNo,
      phase: inputState.phase,
      action: inputState.sanction, // '警告', '退場', etc.
      zone: inputState.zone,
      course: null,
      result: inputState.sanction, // Result is the sanction itself usually
      memo: 'PTに伴う罰則'
    };
    addActionToList(sanctionAction);
  }

  const newAction = {
    time: now,
    exactTime: exact,
    half: stopwatch.half,
    own_gk: matchState.ownGk,
    opp_gk: matchState.oppGk,
    team: inputState.team,
    no: inputState.playerNo, // Can be null for TO
    phase: inputState.phase,
    action: inputState.action,
    zone: inputState.zone,
    course: inputState.course,
    result: result,
    memo: inputState.pendingMemo || null // Save memo if exists (for TO details)
  };

  addActionToList(newAction);
  matchState.stats = computeStats(matchState.actions);

  // Auto-Stop Timer on Timeout
  if (result === 'TimeOut') {
    pauseStopwatch();
  }

  saveData();
  updateScoreDisplay();
  renderHistory();

  // Reset for next input
  resetActionSelection();

  // Panel Flash Effect
  const panel = document.querySelector('.layout-container');
  if (panel) {
    panel.classList.add('input-flash');
    setTimeout(() => panel.classList.remove('input-flash'), 500);
  }

  // Auto-switch Team (Toggle Own/Opp)
  inputState.team = inputState.team === 'Own' ? 'Opp' : 'Own';
  inputState.playerNo = null; // Reset player for new team

  // Update UI for Team Switch
  document.querySelectorAll('.team-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.team === inputState.team);
  });

  // Re-render player grid for new team
  renderPlayerGrid();
}

function updateScoreDisplay() {
  const s = matchState.stats;
  if (!s) return;
  const ownScore = s.own.total.goals;
  const oppScore = s.opp.total.goals;

  document.getElementById('headerOwnScore').textContent = ownScore;
  document.getElementById('headerOppScore').textContent = oppScore;

  document.getElementById('headerHalfOwn').textContent =
    `${matchState.ownName}: 前半${s.own.first.goals} / 後半${s.own.second.goals}`;
  document.getElementById('headerHalfOpp').textContent =
    `${matchState.oppName}: 前半${s.opp.first.goals} / 後半${s.opp.second.goals}`;

  // Update Index with latest score
  if (matchState.id) {
    const index = getMatchIndex();
    const existingIdx = index.findIndex(m => m.id === matchState.id);
    if (existingIdx >= 0) {
      index[existingIdx].scoreOwn = ownScore;
      index[existingIdx].scoreOpp = oppScore;
      saveMatchIndex(index);
    }
  }
}

// ========================================
// 入力履歴
// ========================================
function renderHistory(scrollToIndex) {
  const list = document.getElementById('historyList');
  const count = document.getElementById('historyCount');
  const actions = matchState.actions;
  count.textContent = `${actions.length}件`;

  if (actions.length === 0) {
    list.innerHTML = '<div class="history-empty">まだアクションが記録されていません</div>';
    return;
  }

  // 古い順（試合開始が上）
  let html = '';
  actions.forEach((a, i) => {
    // 挿入ボタン（各アイテムの前に配置）
    html += `<div class="history-insert-row"><button class="history-insert-btn" onclick="insertActionAt(${i})" title="ここに挿入">＋</button></div>`;

    const teamClass = a.team === 'Own' ? 'own' : 'opp';
    const memoHtml = a.memo ? `<span class="history-memo">(${a.memo})</span>` : '';
    html += `
      <div class="history-item" data-index="${i}">
        <span class="history-time">${a.exactTime || a.time}</span>
        <span class="history-team ${teamClass}">${a.team === 'Own' ? matchState.ownName.charAt(0) : matchState.oppName.charAt(0)}</span>
        <span class="history-no">${a.no ? '#' + a.no : '-'}</span>
        <span class="history-action">${a.action}</span>
        <span class="history-zone">${a.zone || ''}</span>
        ${a.course ? `<span class="history-zone">C${a.course}</span>` : ''}
        <span class="history-result ${a.result}">${a.result}</span>
        ${memoHtml}
        <span class="history-actions">
          <button class="history-edit" onclick="editAction(${i})" title="編集">✏</button>
          <button class="history-delete" onclick="deleteAction(${i})" title="削除">✕</button>
        </span>
      </div>
    `;
  });

  list.innerHTML = html;

  // スクロール位置: 指定indexがあればその行へ、なければ最下部へ
  if (scrollToIndex !== undefined && scrollToIndex !== null) {
    const targetEl = list.querySelector(`[data-index="${scrollToIndex}"]`);
    if (targetEl) {
      targetEl.scrollIntoView({ block: 'center' });
      return;
    }
  }
  list.scrollTop = list.scrollHeight;
}

function insertActionAt(index) {
  inputState.insertAtIndex = index;

  // 挿入モード表示
  let banner = document.getElementById('insertModeBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'insertModeBanner';
    banner.style.cssText = 'background:#0d9488;color:#fff;text-align:center;padding:8px 16px;font-size:14px;font-weight:600;position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;border-radius:8px;margin:8px 0;';
    const mainTab = document.querySelector('.main-tab-bar') || document.querySelector('.input-panel');
    if (mainTab) mainTab.parentNode.insertBefore(banner, mainTab.nextSibling);
    else document.body.prepend(banner);
  }
  banner.innerHTML = `<span>📌 挿入モード：アクション #${index + 1} の前に追加</span><button onclick="cancelInsertMode()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:4px 12px;border-radius:6px;font-size:13px;cursor:pointer;">✕ 解除</button>`;
  banner.style.display = 'flex';

  // 入力タブに切り替え
  document.querySelectorAll('.main-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === 'input');
  });
  document.getElementById('inputView').style.display = '';
  document.getElementById('inputView').classList.add('active');
  document.getElementById('analysisView').style.display = 'none';
  document.getElementById('analysisView').classList.remove('active');
}

function cancelInsertMode() {
  inputState.insertAtIndex = null;
  const banner = document.getElementById('insertModeBanner');
  if (banner) banner.style.display = 'none';
}

function deleteAction(index) {
  if (index < 0 || index >= matchState.actions.length) return;
  matchState.actions.splice(index, 1);
  matchState.stats = computeStats(matchState.actions);
  saveData();
  updateScoreDisplay();
  const scrollTo = Math.min(index, matchState.actions.length - 1);
  renderHistory(scrollTo >= 0 ? scrollTo : null);
}

let editingIndex = null;

function editAction(index) {
  if (index < 0 || index >= matchState.actions.length) return;
  editingIndex = index;
  const a = matchState.actions[index];

  document.getElementById('editTime').value = a.exactTime || a.time || '';
  document.getElementById('editTeam').value = a.team;
  document.getElementById('editNo').value = a.no || '';
  document.getElementById('editPhase').value = a.phase || 'SetOF';
  document.getElementById('editAction').value = a.action;
  document.getElementById('editZone').value = a.zone || '';
  document.getElementById('editCourse').value = a.course || '';
  document.getElementById('editResult').value = a.result;

  document.getElementById('editModalOverlay').style.display = '';
}

function saveEdit() {
  if (editingIndex === null) return;
  const a = matchState.actions[editingIndex];

  const newTime = document.getElementById('editTime').value.trim();
  a.exactTime = newTime;
  // time period を exactTime から推定
  if (newTime && newTime.includes(':')) {
    const mins = parseInt(newTime.split(':')[0]);
    const halfDur = matchState.halfDuration || 30;

    // 如果ユーザーが後半で「35分」など通算時間を入力した場合を考慮
    // (mins が halfDur を超えている場合は既に通算時間扱いとする)
    let isGrossTime = mins >= halfDur && (a.half === 2 || a.half === 3 || a.half === 4);

    let offset = 0;
    if (!isGrossTime) {
      if (a.half === 2) offset = halfDur;
      else if (a.half === 3) offset = halfDur * 2;
      else if (a.half === 4) offset = (halfDur * 2) + 5;
      else if (a.half === 5) offset = (halfDur * 2) + 10;
      else if (a.half === 6) offset = (halfDur * 2) + 15;
    }

    const pStart = Math.floor(mins / 5) * 5;
    const pEnd = pStart + 5;
    a.time = `${String(pStart + offset).padStart(2, '0')}~${String(pEnd + offset).padStart(2, '0')}`;
  }

  a.team = document.getElementById('editTeam').value;
  const noInputVal = document.getElementById('editNo').value.trim();
  if (!noInputVal) {
    a.no = null;
  } else if (!isNaN(noInputVal)) {
    a.no = parseInt(noInputVal);
  } else {
    a.no = noInputVal; // For practice mode positions
  }
  a.phase = document.getElementById('editPhase').value;
  a.action = document.getElementById('editAction').value;
  a.zone = document.getElementById('editZone').value || null;
  const courseVal = document.getElementById('editCourse').value;
  a.course = courseVal ? parseInt(courseVal) : null;
  a.result = document.getElementById('editResult').value;

  matchState.stats = computeStats(matchState.actions);

  // Time editing could change the chronological order; sort array to keep it linear.
  const halfDurHelper = matchState.halfDuration || 30;
  matchState.actions.sort((act1, act2) => {
    const getGrossSecs = (act) => {
      let baseSec = 0;
      if (act.exactTime && act.exactTime.includes(':')) {
        const pts = act.exactTime.split(':');
        baseSec = parseInt(pts[0]) * 60 + parseInt(pts[1]);
      } else if (act.time && act.time.includes('~')) {
        baseSec = parseInt(act.time.split('~')[0]) * 60;
      }
      // if it's already gross time, don't double add offset
      let isGross = (Math.floor(baseSec / 60) >= halfDurHelper && act.half > 1);
      if (isGross) return baseSec;

      let offset = 0;
      if (act.half === 2) offset = halfDurHelper;
      else if (act.half === 3) offset = halfDurHelper * 2;
      else if (act.half === 4) offset = (halfDurHelper * 2) + 5;
      else if (act.half === 5) offset = (halfDurHelper * 2) + 10;
      else if (act.half === 6) offset = (halfDurHelper * 2) + 15;
      return baseSec + (offset * 60);
    };
    return getGrossSecs(act1) - getGrossSecs(act2);
  });

  saveData();
  updateScoreDisplay();
  renderHistory();
  const savedIndex = editingIndex;
  closeEditModal();
  renderHistory(savedIndex);
}

function closeEditModal() {
  editingIndex = null;
  document.getElementById('editModalOverlay').style.display = 'none';
}

// ========================================
// メインタブ
// ========================================
function initMainTabs() {
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const view = tab.dataset.view;
      document.getElementById('inputView').style.display = view === 'input' ? '' : 'none';
      document.getElementById('inputView').classList.toggle('active', view === 'input');
      document.getElementById('analysisView').style.display = view === 'analysis' ? '' : 'none';
      document.getElementById('analysisView').classList.toggle('active', view === 'analysis');

      if (view === 'analysis') {
        renderAnalysisDashboard();
      }
    });
  });

  // Team comparison tabs
  document.getElementById('teamTabs')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-btn')) {
      document.querySelectorAll('#teamTabs .tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      renderTeamComparison(e.target.dataset.tab);
    }
  });
}

// ========================================
// 試合メニュー
// ========================================
function initMatchMenu() {
  const fab = document.getElementById('matchMenuBtn');
  const menu = document.getElementById('matchMenu');

  fab.addEventListener('click', () => {
    menu.style.display = menu.style.display === 'none' ? '' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!fab.contains(e.target) && !menu.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  document.getElementById('editMemberBtn').addEventListener('click', () => {
    openMemberEditModal();
    menu.style.display = 'none';
  });

  document.getElementById('newMatchBtn').addEventListener('click', () => {
    if (confirm('現在の試合データを破棄して新しい試合を始めますか？')) {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const data = JSON.stringify(matchState, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Filename: [Tournament_]Own_vs_Opp_Date.json
    const dateStr = new Date().toISOString().slice(0, 10);
    const tournamentPart = matchState.tournamentName ? `${matchState.tournamentName}_` : '';
    a.download = `${tournamentPart}${matchState.ownName}_vs_${matchState.oppName}_${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Member Edit Modal Events
  document.getElementById('memberEditCloseBtn').addEventListener('click', closeMemberEditModal);
  document.getElementById('editAddPlayerBtn').addEventListener('click', addEditPlayer);
  document.getElementById('editPlayerNoInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('editPlayerNameInput').focus();
  });
  document.getElementById('editPlayerNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addEditPlayer();
  });
}


// ========================================
// メンバー編集モーダル制御
// ========================================
let currentEditTeam = 'own';

function initMemberEdit() {
  document.getElementById('editTeamSelect').addEventListener('click', (e) => {
    if (e.target.classList.contains('team-btn')) {
      document.querySelectorAll('#editTeamSelect .team-btn').forEach(btn => btn.classList.remove('active'));
      e.target.classList.add('active');
      currentEditTeam = e.target.dataset.team;
      renderEditRegisteredPlayers();
    }
  });
}

function openMemberEditModal() {
  currentEditTeam = 'own';
  document.querySelectorAll('#editTeamSelect .team-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector('#editTeamSelect .team-btn[data-team="own"]').classList.add('active');

  renderEditRegisteredPlayers();
  document.getElementById('memberEditModalOverlay').style.display = 'flex';
}

function closeMemberEditModal() {
  document.getElementById('memberEditModalOverlay').style.display = 'none';
  renderPlayerGrid(); // Update main input panel for own team
  initInputPanel();   // Re-init to update both team panels if opp team was edited
  saveTeamConfig();   // Persist changes
  saveData();         // Save current match state
}

function renderEditRegisteredPlayers() {
  const container = document.getElementById('editRegisteredPlayers');
  const playersData = currentEditTeam === 'own' ? matchState.players : matchState.oppPlayers;

  container.innerHTML = playersData.map(p => `
    <div class="registered-player">
      #${p.no}${p.name ? ` ${p.name}` : ''}
      <button class="remove-player" onclick="removeEditPlayer(${p.no})">✕</button>
    </div>
  `).join('');
}

function addEditPlayer() {
  const noInput = document.getElementById('editPlayerNoInput');
  const nameInput = document.getElementById('editPlayerNameInput');
  const no = parseInt(noInput.value);
  if (!no || no < 1 || no > 99) return;

  const targetArray = currentEditTeam === 'own' ? matchState.players : matchState.oppPlayers;
  const name = nameInput.value.trim();

  if (targetArray.some(p => p.no === no)) {
    alert('既に登録されている番号です');
    return;
  }

  targetArray.push({ no, name });
  targetArray.sort((a, b) => a.no - b.no);

  renderEditRegisteredPlayers();
  noInput.value = '';
  nameInput.value = '';
  noInput.focus();
}

function removeEditPlayer(no) {
  if (confirm(`本当に #${no} を削除しますか？`)) {
    if (currentEditTeam === 'own') {
      matchState.players = matchState.players.filter(p => p.no !== no);
    } else {
      matchState.oppPlayers = matchState.oppPlayers.filter(p => p.no !== no);
    }
    renderEditRegisteredPlayers();
  }
}

// ========================================
// 統計計算 (既存ロジックを移植)
// ========================================
function computeStats(actions) {
  const stats = {
    own: { total: {}, first: {}, second: {}, byTime: {}, byShoot: {}, byZone: {}, byPosition: {} },
    opp: { total: {}, first: {}, second: {}, byTime: {}, byShoot: {}, byZone: {}, byPosition: {} }
  };

  TIME_PERIODS_ALL.forEach(t => {
    stats.own.byTime[t] = { attacks: 0, goals: 0, shots: 0, to: 0 };
    stats.opp.byTime[t] = { attacks: 0, goals: 0, shots: 0, to: 0 };
  });

  SHOOT_TYPES.forEach(s => {
    stats.own.byShoot[s] = { goals: 0, shots: 0 };
    stats.opp.byShoot[s] = { goals: 0, shots: 0 };
  });

  ['L', 'C', 'R'].forEach(z => {
    stats.own.byZone[z] = { goals: 0, shots: 0, to: 0 };
    stats.opp.byZone[z] = { goals: 0, shots: 0, to: 0 };
  });

  const POSITIONS = ['LW', 'LB', 'CB', 'PV', 'PT', 'RB', 'RW'];
  POSITIONS.forEach(p => {
    stats.own.byPosition[p] = { goals: 0, shots: 0, to: 0 };
    stats.opp.byPosition[p] = { goals: 0, shots: 0, to: 0 };
  });

  ['total', 'first', 'second'].forEach(period => {
    ['own', 'opp'].forEach(team => {
      stats[team][period] = {
        attacks: 0, goals: 0, shots: 0, turnovers: 0,
        saves_made: 0, on_target_against: 0,
        set_attacks: 0, set_goals: 0, fb_attacks: 0, fb_goals: 0
      };
    });
  });

  actions.forEach(a => {
    const team = a.team === 'Own' ? 'own' : 'opp';
    const otherTeam = team === 'own' ? 'opp' : 'own';

    // a.half is 1,2 (regular), 3,4 (ext1), 5,6 (ext2)
    // Map odds (1,3,5) into 'first' and evens (2,4,6) into 'second'
    let period = 'first';

    // Fallback for older data that doesn't have a.half recorded
    if (a.half === undefined) {
      if (!TIME_PERIODS_1ST.includes(a.time)) {
        period = 'second';
      }
    } else if ([2, 4, 6].includes(a.half)) {
      period = 'second';
    }

    const isShotAction = SHOOT_TYPES.includes(a.action);
    const isTO = a.action === 'TO';

    stats[team].total.attacks++;
    stats[team][period].attacks++;
    if (stats[team].byTime[a.time]) stats[team].byTime[a.time].attacks++;

    if (a.phase === 'SetOF') {
      stats[team].total.set_attacks++;
      stats[team][period].set_attacks++;
    } else {
      stats[team].total.fb_attacks++;
      stats[team][period].fb_attacks++;
    }

    if (a.result === 'Goal') {
      stats[team].total.goals++;
      stats[team][period].goals++;
      if (stats[team].byTime[a.time]) stats[team].byTime[a.time].goals++;

      if (a.phase === 'SetOF') { stats[team][period].set_goals++; stats[team].total.set_goals++; }
      else { stats[team][period].fb_goals++; stats[team].total.fb_goals++; }
    }

    if (isShotAction) {
      stats[team].total.shots++;
      stats[team][period].shots++;
      if (stats[team].byTime[a.time]) stats[team].byTime[a.time].shots++;
      if (stats[team].byShoot[a.action]) stats[team].byShoot[a.action].shots++;
      if (stats[team].byZone[a.zone]) stats[team].byZone[a.zone].shots++;

      const pos = mapToPosition(a.action, a.zone);
      if (pos && stats[team].byPosition[pos]) stats[team].byPosition[pos].shots++;

      if (a.result === 'Goal') {
        if (stats[team].byShoot[a.action]) stats[team].byShoot[a.action].goals++;
        if (stats[team].byZone[a.zone]) stats[team].byZone[a.zone].goals++;
        if (pos && stats[team].byPosition[pos]) stats[team].byPosition[pos].goals++;
      }

      if (a.result === 'Save') {
        stats[otherTeam].total.saves_made++;
        stats[otherTeam][period].saves_made++;
      }

      if (a.result === 'Goal' || a.result === 'Save') {
        stats[otherTeam].total.on_target_against++;
        stats[otherTeam][period].on_target_against++;
      }
    }

    if (isTO) {
      stats[team].total.turnovers++;
      stats[team][period].turnovers++;
      if (stats[team].byTime[a.time]) stats[team].byTime[a.time].to++;
      if (stats[team].byZone[a.zone]) stats[team].byZone[a.zone].to++;
    }
  });

  return stats;
}

function mapToPosition(action, zone) {
  if (action === 'WS' && zone === 'L') return 'LW';
  if (action === 'WS' && zone === 'R') return 'RW';
  if (action === 'WS' && zone === 'C') return 'CB';
  // LS・BTはゾーンに基づいてポジション分類（CからのLSはCB、LからはLBなど）
  if (action === 'LS' || action === 'BT') {
    if (zone === 'LW') return 'LW';
    if (zone === 'L') return 'LB';
    if (zone === 'C') return 'CB';
    if (zone === 'R') return 'RB';
    if (zone === 'RW') return 'RW';
    return 'PV'; // ゾーンが不明な場合のフォールバック
  }
  if (action === 'PS') return 'PV'; // ポストシュートは常にPV
  if (action === 'DS' && zone === 'L') return 'LB';
  if (action === 'DS' && zone === 'R') return 'RB';
  if (action === 'DS' && zone === 'C') return 'CB';
  if (action === 'PT') return 'PT';
  if (action === 'EG') return 'CB';
  return null;
}

// ========================================
// ユーティリティ
// ========================================
function pct(a, b) {
  if (!b || b === 0) return '0.0%';
  return (a / b * 100).toFixed(1) + '%';
}

// ========================================
// 分析ダッシュボード描画
// ========================================
function renderAnalysisDashboard() {
  if (!matchState.stats) matchState.stats = computeStats(matchState.actions);
  renderKPIs();
  renderTeamComparison('total');
  renderTimeCharts();
  renderShootTypeCharts();
  renderCourtDiagram();
  renderGKSection();
  renderGKHalfStats();
  renderShootingRanking();
  renderTimeline();
  renderScoringFlow();
  updateHeatmapPlayerSelect();
  renderHeatmap();
}

// ===== KPI =====
function renderKPIs() {
  const s = matchState.stats;
  const kpis = [
    {
      label: '攻撃成功率 (xG)',
      ownVal: pct(s.own.total.goals, s.own.total.attacks),
      oppVal: pct(s.opp.total.goals, s.opp.total.attacks),
      ownSub: `${s.own.total.goals}/${s.own.total.attacks}`,
      oppSub: `${s.opp.total.goals}/${s.opp.total.attacks}`
    },
    {
      label: 'シュート成功率 (G%)',
      ownVal: pct(s.own.total.goals, s.own.total.shots),
      oppVal: pct(s.opp.total.goals, s.opp.total.shots),
      ownSub: `${s.own.total.goals}/${s.own.total.shots}`,
      oppSub: `${s.opp.total.goals}/${s.opp.total.shots}`
    },
    {
      label: 'ターンオーバー率 (TO%)',
      ownVal: pct(s.own.total.turnovers, s.own.total.attacks),
      oppVal: pct(s.opp.total.turnovers, s.opp.total.attacks),
      ownSub: `${s.own.total.turnovers}/${s.own.total.attacks}`,
      oppSub: `${s.opp.total.turnovers}/${s.opp.total.attacks}`
    },
    {
      label: 'セーブ率 (S%)',
      ownVal: pct(s.own.total.saves_made, s.own.total.on_target_against),
      oppVal: pct(s.opp.total.saves_made, s.opp.total.on_target_against),
      ownSub: `${s.own.total.saves_made}/${s.own.total.on_target_against}`,
      oppSub: `${s.opp.total.saves_made}/${s.opp.total.on_target_against}`
    }
  ];

  const grid = document.getElementById('kpiGrid');
  grid.innerHTML = '';
  kpis.forEach(kpi => {
    const ownNum = parseFloat(kpi.ownVal);
    const oppNum = parseFloat(kpi.oppVal);
    const total = ownNum + oppNum || 1;
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `
      <div class="kpi-label">${kpi.label}</div>
      <div class="kpi-values">
        <div>
          <div class="kpi-value own">${kpi.ownVal}</div>
          <div class="kpi-sub">${matchState.ownName} (${kpi.ownSub})</div>
        </div>
        <div style="text-align:right;">
          <div class="kpi-value opp">${kpi.oppVal}</div>
          <div class="kpi-sub">${matchState.oppName} (${kpi.oppSub})</div>
        </div>
      </div>
      <div class="kpi-bar-container">
        <div class="kpi-bar-own" style="width:${(ownNum / total * 100).toFixed(1)}%"></div>
        <div class="kpi-bar-opp" style="width:${(oppNum / total * 100).toFixed(1)}%"></div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ===== チーム比較 =====
function renderTeamComparison(period) {
  const s = matchState.stats;
  const own = s.own[period];
  const opp = s.opp[period];

  const rows = [
    { label: '攻撃回数', own: own.attacks, opp: opp.attacks },
    { label: '得点', own: own.goals, opp: opp.goals },
    { label: 'シュート数', own: own.shots, opp: opp.shots },
    { label: 'ターンオーバー', own: own.turnovers, opp: opp.turnovers },
    { label: '攻撃成功率', own: pct(own.goals, own.attacks), opp: pct(opp.goals, opp.attacks) },
    { label: 'シュート成功率', own: pct(own.goals, own.shots), opp: pct(opp.goals, opp.shots) },
    { label: 'TO率', own: pct(own.turnovers, own.attacks), opp: pct(opp.turnovers, opp.attacks) },
    { label: 'セーブ率', own: pct(own.saves_made, own.on_target_against), opp: pct(opp.saves_made, opp.on_target_against) },
    { label: 'セットOF攻撃', own: `${own.set_goals}/${own.set_attacks}`, opp: `${opp.set_goals}/${opp.set_attacks}` },
    { label: 'FB+Q攻撃', own: `${own.fb_goals}/${own.fb_attacks}`, opp: `${opp.fb_goals}/${opp.fb_attacks}` },
  ];

  const grid = document.getElementById('teamComparison');
  grid.innerHTML = `
    <div class="compare-panel own">
      <div class="compare-team-header own">🔵 ${matchState.ownName}</div>
      ${rows.map(r => `
        <div class="compare-row">
          <span class="compare-label">${r.label}</span>
          <span class="compare-value">${r.own}</span>
        </div>
      `).join('')}
    </div>
    <div class="compare-panel opp">
      <div class="compare-team-header opp">🔴 ${matchState.oppName}</div>
      ${rows.map(r => `
        <div class="compare-row">
          <span class="compare-label">${r.label}</span>
          <span class="compare-value">${r.opp}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ===== 時間帯別グラフ =====
function renderTimeCharts() {
  const s = matchState.stats;
  const labels = TIME_PERIODS_ALL.map(t => t.replace('~', '-'));
  const ownAttacks = TIME_PERIODS_ALL.map(t => s.own.byTime[t]?.attacks || 0);
  const oppAttacks = TIME_PERIODS_ALL.map(t => s.opp.byTime[t]?.attacks || 0);

  if (charts.timeAttack) charts.timeAttack.destroy();
  charts.timeAttack = new Chart(document.getElementById('timeAttackChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: matchState.ownName, data: ownAttacks, backgroundColor: 'rgba(59,130,246,0.6)', borderColor: '#3b82f6', borderWidth: 1, borderRadius: 4 },
        { label: matchState.oppName, data: oppAttacks, backgroundColor: 'rgba(239,68,68,0.6)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: '時間帯別 攻撃回数', font: { size: 14, weight: '600' } }, legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, suggestedMax: 5, ticks: { stepSize: 1 } } }
    }
  });

  // 攻撃成功率
  const ownXG = TIME_PERIODS_ALL.map(t => { const d = s.own.byTime[t]; return d && d.attacks > 0 ? +(d.goals / d.attacks * 100).toFixed(1) : 0; });
  const oppXG = TIME_PERIODS_ALL.map(t => { const d = s.opp.byTime[t]; return d && d.attacks > 0 ? +(d.goals / d.attacks * 100).toFixed(1) : 0; });

  if (charts.timeGoal) charts.timeGoal.destroy();

  const halfDividerPlugin = {
    id: 'halfDivider',
    afterDraw(chart) {
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      const x = (xScale.getPixelForValue(5) + xScale.getPixelForValue(6)) / 2;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.moveTo(x, yScale.top);
      ctx.lineTo(x, yScale.bottom);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = 'bold 10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('前半 | 後半', x, yScale.top - 6);
      ctx.restore();
    }
  };

  charts.timeGoal = new Chart(document.getElementById('timeGoalChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: matchState.ownName, data: ownXG, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 5, pointHoverRadius: 7 },
        { label: matchState.oppName, data: oppXG, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.4, pointRadius: 5, pointHoverRadius: 7 }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: { display: true, text: '時間帯別 攻撃成功率 (%)', font: { size: 14, weight: '600' } },
        legend: { position: 'bottom' },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%` } }
      },
      scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } }
    },
    plugins: [halfDividerPlugin]
  });
}

// ===== シュート種別グラフ =====
function renderShootTypeCharts() {
  const s = matchState.stats;

  function makeShootChart(canvasId, teamKey, teamName) {
    const labels = SHOOT_TYPES.map(t => SHOOT_LABELS[t]);
    const goals = SHOOT_TYPES.map(t => s[teamKey].byShoot[t]?.goals || 0);
    const misses = SHOOT_TYPES.map(t => { const d = s[teamKey].byShoot[t]; return d ? d.shots - d.goals : 0; });

    if (charts[canvasId]) charts[canvasId].destroy();
    charts[canvasId] = new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'ゴール', data: goals, backgroundColor: 'rgba(16,185,129,0.7)', borderColor: '#10b981', borderWidth: 1, borderRadius: 4 },
          { label: 'ミス', data: misses, backgroundColor: 'rgba(239,68,68,0.4)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        plugins: { title: { display: true, text: `${teamName} シュート種別`, font: { size: 14, weight: '600' } }, legend: { position: 'bottom' } },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  }

  makeShootChart('shootTypeOwnChart', 'own', matchState.ownName);
  makeShootChart('shootTypeOppChart', 'opp', matchState.oppName);
}

// ===== コート図 =====
function renderCourtDiagram() {
  document.getElementById('courtOwnTitle').textContent = matchState.ownName;
  document.getElementById('courtOppTitle').textContent = matchState.oppName;
  drawCourt('courtOwn', 'own');
  drawCourt('courtOpp', 'opp');
}

function drawCourt(canvasId, teamKey) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const goalY = 50;

  // Court lines
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(60, goalY); ctx.lineTo(w - 60, goalY); ctx.stroke();

  // Goal
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 3;
  const goalW = 100;
  ctx.beginPath();
  ctx.moveTo(cx - goalW / 2, goalY); ctx.lineTo(cx - goalW / 2, goalY - 18);
  ctx.lineTo(cx + goalW / 2, goalY - 18); ctx.lineTo(cx + goalW / 2, goalY);
  ctx.stroke();

  // 6m arc
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.ellipse(cx, goalY, 140, 90, 0, 0, Math.PI); ctx.stroke();
  ctx.setLineDash([]);

  // 9m arc
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.setLineDash([10, 6]);
  ctx.beginPath(); ctx.ellipse(cx, goalY, 190, 140, 0, 0, Math.PI); ctx.stroke();
  ctx.setLineDash([]);

  const s = matchState.stats;
  const positions = s[teamKey].byPosition;

  const posLayout = [
    { key: 'LW', label: 'LW', x: 35, y: goalY + 55 },
    { key: 'LB', label: 'LB', x: cx - 110, y: goalY + 145 },
    { key: 'CB', label: 'CB', x: cx, y: goalY + 170 },
    { key: 'PV', label: 'PV', x: cx - 55, y: goalY + 65 },
    { key: 'PT', label: 'PT', x: cx + 55, y: goalY + 65 },
    { key: 'RB', label: 'RB', x: cx + 110, y: goalY + 145 },
    { key: 'RW', label: 'RW', x: w - 35, y: goalY + 55 }
  ];

  posLayout.forEach(pos => {
    const d = positions[pos.key];
    if (!d) return;
    const rate = d.shots > 0 ? d.goals / d.shots : 0;
    const shotCount = d.shots;
    const radius = shotCount > 0 ? Math.max(20, Math.min(45, 12 + shotCount * 3)) : 16;
    const alpha = shotCount > 0 ? Math.max(0.25, Math.min(0.85, rate * 0.9 + 0.15)) : 0.12;

    if (shotCount > 0) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = teamKey === 'own' ? `rgba(59,130,246,${alpha * 0.6})` : `rgba(239,68,68,${alpha * 0.6})`;
    }

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = teamKey === 'own' ? `rgba(59,130,246,${alpha})` : `rgba(239,68,68,${alpha})`;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Border
    ctx.strokeStyle = teamKey === 'own' ? `rgba(96,165,250,${alpha + 0.1})` : `rgba(248,113,113,${alpha + 0.1})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label
    ctx.fillStyle = '#f0f4ff';
    ctx.font = `bold ${radius > 30 ? 14 : 11}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pos.label, pos.x, pos.y - (radius > 25 ? 10 : 6));

    if (shotCount > 0) {
      ctx.font = `bold ${radius > 30 ? 16 : 12}px 'JetBrains Mono'`;
      ctx.fillText(`${d.goals}/${d.shots}`, pos.x, pos.y + 4);
      ctx.font = `bold ${radius > 30 ? 11 : 9}px Inter`;
      ctx.fillStyle = rate >= 0.5 ? '#6ee7b7' : '#fca5a5';
      ctx.fillText(`${(rate * 100).toFixed(0)}%`, pos.x, pos.y + (radius > 30 ? 20 : 16));
    }
  });
}

// ===== GK分析 =====
function renderGKSection() {
  const container = document.getElementById('gkSection');
  const s = matchState.stats;

  function buildGKCard(teamKey, teamName, className) {
    // Build GK stats from actions (which GK was on court)
    const gkStats = {};
    matchState.actions.forEach(a => {
      const shootTeam = a.team === 'Own' ? 'own' : 'opp';
      if (shootTeam === teamKey) return; // this team is shooting, other team's GK is saving
      if (!SHOOT_TYPES.includes(a.action)) return;

      const gkNo = teamKey === 'own' ? a.own_gk : a.opp_gk;
      if (!gkNo) return;
      if (!gkStats[gkNo]) gkStats[gkNo] = { saves: 0, onTarget: 0, goals: 0 };

      if (a.result === 'Goal' || a.result === 'Save') {
        gkStats[gkNo].onTarget++;
        if (a.result === 'Save') gkStats[gkNo].saves++;
        if (a.result === 'Goal') gkStats[gkNo].goals++;
      }
    });

    const gkNos = Object.keys(gkStats).sort((a, b) => {
      if (!isNaN(a) && !isNaN(b)) return parseInt(a) - parseInt(b);
      return a.localeCompare(b);
    });
    let totalSaves = 0, totalOnTarget = 0;
    gkNos.forEach(no => { totalSaves += gkStats[no].saves; totalOnTarget += gkStats[no].onTarget; });

    let html = `<div class="gk-card ${className}">
      <div class="gk-card-title" style="color:${className === 'own' ? 'var(--accent-own-light)' : 'var(--accent-opp-light)'}">
        🧤 ${teamName} GK
      </div>`;

    gkNos.forEach(no => {
      const g = gkStats[no];
      const rate = g.onTarget > 0 ? (g.saves / g.onTarget * 100).toFixed(1) : '0.0';
      html += `
        <div class="gk-row"><span class="label">#${no}</span><span class="value">${rate}% (${g.saves}/${g.onTarget})</span></div>`;
    });

    if (gkNos.length === 0) {
      html += '<div class="gk-row"><span class="label">データなし</span></div>';
    }

    const totalRate = totalOnTarget > 0 ? (totalSaves / totalOnTarget * 100).toFixed(1) : '0.0';
    html += `<div class="gk-row gk-subtotal"><span class="label">合計</span><span class="value">${totalRate}% (${totalSaves}/${totalOnTarget})</span></div>`;
    html += '</div>';
    return html;
  }

  container.innerHTML = buildGKCard('own', matchState.ownName, 'own') + buildGKCard('opp', matchState.oppName, 'opp');
}

// ===== GKセーブ率 前後半 =====
function renderGKHalfStats() {
  const container = document.getElementById('gkHalfStats');
  const s = matchState.stats;

  function buildHalfCard(teamKey, teamName) {
    const first = s[teamKey].first;
    const second = s[teamKey].second;
    const total = s[teamKey].total;

    return `<div class="gk-half-card">
      <div class="gk-half-card-title" style="color:${teamKey === 'own' ? 'var(--accent-own-light)' : 'var(--accent-opp-light)'}">
        ${teamName} セーブ率
      </div>
      <div class="gk-half-row"><span>前半</span><span>${pct(first.saves_made, first.on_target_against)} (${first.saves_made}/${first.on_target_against})</span></div>
      <div class="gk-half-row"><span>後半</span><span>${pct(second.saves_made, second.on_target_against)} (${second.saves_made}/${second.on_target_against})</span></div>
      <div class="gk-half-row" style="font-weight:700;border-top:1px solid var(--border-glass);padding-top:6px;margin-top:4px">
        <span>合計</span><span>${pct(total.saves_made, total.on_target_against)} (${total.saves_made}/${total.on_target_against})</span>
      </div>
    </div>`;
  }

  container.innerHTML = buildHalfCard('own', matchState.ownName) + buildHalfCard('opp', matchState.oppName);
}

// ===== 選手別ランキング =====
function renderShootingRanking() {
  const actions = matchState.actions;

  function buildRanking(containerId, teamKey, teamName, teamColor) {
    const playerStats = {};
    actions.forEach(a => {
      if ((a.team === 'Own' ? 'own' : 'opp') !== teamKey) return;
      if (!SHOOT_TYPES.includes(a.action)) return;
      if (!playerStats[a.no]) playerStats[a.no] = { goals: 0, shots: 0 };
      playerStats[a.no].shots++;
      if (a.result === 'Goal') playerStats[a.no].goals++;
    });

    const sorted = Object.entries(playerStats)
      .map(([no, st]) => {
        const parsedNo = isNaN(no) ? no : parseInt(no);
        return { no: parsedNo, ...st, rate: st.shots > 0 ? st.goals / st.shots : 0 };
      })
      .sort((a, b) => b.rate - a.rate || b.goals - a.goals);

    const container = document.getElementById(containerId);
    let html = `<div style="font-weight:700;margin-bottom:8px;color:${teamColor}">${teamName}</div>`;
    if (sorted.length === 0) {
      html += '<div style="color:var(--text-muted);font-size:0.85rem;">データなし</div>';
    } else {
      html += `<table class="rank-table"><thead><tr><th>#</th><th>背番号</th><th>成功率</th><th>G/S</th></tr></thead><tbody>`;
      sorted.forEach((p, i) => {
        html += `<tr>
          <td>${i + 1}</td>
          <td style="font-weight:700">${p.no}</td>
          <td style="color:${p.rate >= 0.5 ? '#6ee7b7' : '#fca5a5'}">${(p.rate * 100).toFixed(1)}%</td>
          <td>${p.goals}/${p.shots}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    container.innerHTML = html;
  }

  buildRanking('rankOwnCard', 'own', matchState.ownName, 'var(--accent-own-light)');
  buildRanking('rankOppCard', 'opp', matchState.oppName, 'var(--accent-opp-light)');
}

// ===== タイムライン =====
function renderTimeline() {
  // Filters
  const filtersDiv = document.getElementById('timelineFilters');
  const filters = ['全て', 'Own', 'Opp', 'Goal', 'TO'];
  filtersDiv.innerHTML = filters.map((f, i) =>
    `<button class="timeline-filter-btn ${i === 0 ? 'active' : ''}" data-filter="${f}">${f === 'Own' ? matchState.ownName : f === 'Opp' ? matchState.oppName : f}</button>`
  ).join('');

  filtersDiv.querySelectorAll('.timeline-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filtersDiv.querySelectorAll('.timeline-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderTimelineItems(btn.dataset.filter);
    });
  });

  renderTimelineItems('全て');
}

function renderTimelineItems(filter, forPdf = false) {
  const container = document.getElementById('timelineContainer');
  let actions = [...matchState.actions];

  if (filter === 'Own') actions = actions.filter(a => a.team === 'Own');
  else if (filter === 'Opp') actions = actions.filter(a => a.team === 'Opp');
  else if (filter === 'Goal') actions = actions.filter(a => a.result === 'Goal');
  else if (filter === 'TO') actions = actions.filter(a => a.action === 'TO');

  if (actions.length === 0) {
    container.innerHTML = '<div class="history-empty">データなし</div>';
    return;
  }

  // PDF用のインラインスタイル
  const pS = forPdf ? {
    header: 'color:#94a3b8;border-bottom:1px solid rgba(255,255,255,0.15);',
    time: 'color:#e2e8f0;',
    no: 'color:#f8fafc;font-weight:700;',
    phase: 'color:#94a3b8;',
    phaseFb: 'color:#60a5fa;font-weight:700;',
    action: 'color:#f8fafc;font-weight:600;',
    zone: 'color:#94a3b8;',
    teamOwn: 'background:#2563eb;color:#fff;font-weight:700;',
    teamOpp: 'background:#dc2626;color:#fff;font-weight:700;',
    item: 'border-bottom:1px solid rgba(255,255,255,0.1);',
    rGoal: 'background:rgba(16,185,129,0.4);color:#6ee7b7;font-weight:600;',
    rSave: 'background:rgba(245,158,11,0.4);color:#fcd34d;font-weight:600;',
    rBad: 'background:rgba(239,68,68,0.3);color:#fca5a5;font-weight:600;',
    rOther: 'background:rgba(148,163,184,0.3);color:#e2e8f0;font-weight:600;',
  } : { header: '', time: '', no: '', phase: '', phaseFb: '', action: '', zone: '', teamOwn: '', teamOpp: '', item: '', rGoal: '', rSave: '', rBad: '', rOther: '' };

  let html = `<div class="timeline-header" style="display:flex;gap:8px;${pS.header}">
    <span style="min-width:44px">時間</span>
    <span style="min-width:36px">チーム</span>
    <span style="min-width:24px">No</span>
    <span style="min-width:48px">フェーズ</span>
    <span style="min-width:28px">種別</span>
    <span style="min-width:16px">Z</span>
    <span>結果</span>
  </div>`;

  actions.forEach(a => {
    const teamClass = a.team === 'Own' ? 'own' : 'opp';
    const phaseClass = a.phase !== 'SetOF' ? 'fb-highlight' : '';
    const teamStyle = a.team === 'Own' ? pS.teamOwn : pS.teamOpp;
    const phaseStyle = phaseClass ? pS.phaseFb : pS.phase;
    let resultStyle = pS.rOther;
    if (a.result === 'Goal') resultStyle = pS.rGoal;
    else if (a.result === 'Save') resultStyle = pS.rSave;
    else if (a.result === 'Out' || a.result === 'Block') resultStyle = pS.rBad;

    html += `
      <div class="timeline-item" style="${pS.item}">
        <span class="timeline-time-col" style="${pS.time}">${a.time}</span>
        <span class="timeline-team ${teamClass}" style="${teamStyle}">${a.team === 'Own' ? matchState.ownName.charAt(0) : matchState.oppName.charAt(0)}</span>
        <span class="timeline-no" style="${pS.no}">#${a.no}</span>
        <span class="timeline-phase ${phaseClass}" style="${phaseStyle}">${a.phase}</span>
        <span class="timeline-action-col" style="${pS.action}">${a.action}</span>
        <span class="timeline-zone-col" style="${pS.zone}">${a.zone || ''}</span>
        <span class="timeline-result-col ${a.result}" style="${resultStyle}">${a.result}</span>
      </div>`;
  });

  container.innerHTML = html;
}

// ===== 得点の流れ =====
function renderScoringFlow() {
  const canvas = document.getElementById('scoringFlowCanvas');
  if (!canvas) return;

  const actions = matchState.actions;
  const goalActions = [];
  let ownScore = 0, oppScore = 0;

  goalActions.push({ label: 'Start', own: 0, opp: 0 });

  actions.forEach((a, i) => {
    if (a.result === 'Goal') {
      if (a.team === 'Own') ownScore++;
      else oppScore++;
      goalActions.push({
        label: `${a.exactTime || a.time}`,
        own: ownScore,
        opp: oppScore,
        team: a.team
      });
    }
  });

  if (goalActions.length <= 1) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#64748b';
    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('得点データなし', canvas.width / 2, 150);
    return;
  }

  // Canvas幅は親コンテナに合わせる（responsive: trueで自動調整）
  canvas.style.width = '100%';

  if (charts.scoringFlow) charts.scoringFlow.destroy();
  charts.scoringFlow = new Chart(canvas, {
    type: 'line',
    data: {
      labels: goalActions.map(g => g.label),
      datasets: [
        {
          label: matchState.ownName,
          data: goalActions.map(g => g.own),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: false,
          tension: 0.1,
          pointRadius: 5,
          pointHoverRadius: 7,
          stepped: 'before'
        },
        {
          label: matchState.oppName,
          data: goalActions.map(g => g.opp),
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.1)',
          fill: false,
          tension: 0.1,
          pointRadius: 5,
          pointHoverRadius: 7,
          stepped: 'before'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        title: { display: true, text: '得点の流れ', font: { size: 14, weight: '600' } },
        legend: { position: 'bottom' }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } },
        x: { ticks: { maxRotation: 45 } }
      }
    }
  });
}

// ========================================
// シュートヒートマップ分析
// ========================================
// 状態管理用：現在選択されているアクション（タブ）
let currentHeatmapAction = 'DS';

function renderHeatmap() {
  const teamSelect = document.getElementById('heatmapTeamSelect');
  const playerSelect = document.getElementById('heatmapPlayerSelect');
  if (!teamSelect || !playerSelect) return;

  const team = teamSelect.value;
  const playerNo = playerSelect.value; // 'all' or number
  const action = currentHeatmapAction;

  // 3つのゾーンを描画
  renderZoneGrid('L', team, playerNo, action);
  renderZoneGrid('C', team, playerNo, action);
  renderZoneGrid('R', team, playerNo, action);
}

function renderZoneGrid(zone, team, playerNo, action) {
  const gridId = `heatmapGrid${zone}`;
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '';

  // データ集計
  const data = calculateHeatmapData(team, playerNo, action, zone);

  // 1〜9のセル生成
  for (let i = 1; i <= 9; i++) {
    const cellData = data[i] || { attempts: 0, goals: 0, rate: 0 };
    const cell = document.createElement('div');
    cell.className = 'heatmap-cell';

    // 背景色: rate 0(赤) -> 1(緑)。0件の場合はグレー
    if (cellData.attempts > 0) {
      // HSL: 0(赤) -> 120(緑)
      const hue = Math.round(cellData.rate * 120);
      cell.style.backgroundColor = `hsla(${hue}, 70%, 40%, 0.9)`;
    } else {
      cell.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    }

    cell.innerHTML = `
      <span class="heatmap-cell-label">${i}</span>
      <span class="heatmap-cell-rate">${(cellData.rate * 100).toFixed(0)}%</span>
      <span class="heatmap-cell-count">${cellData.goals}/${cellData.attempts}</span>
    `;

    grid.appendChild(cell);
  }
}

function calculateHeatmapData(team, playerNo, action, zone) {
  const data = {}; // { 1: {attempts, goals, rate}, ... }

  // 対象アクション抽出
  const actions = matchState.actions.filter(a => {
    if (a.team !== team) return false;
    if (playerNo !== 'all' && a.no != playerNo) return false;
    if (a.action !== action) return false; // アクションでフィルタ
    if (a.zone !== zone) return false;     // ゾーンでフィルタ
    if (!a.course) return false;
    return true;
  });

  // 集計
  actions.forEach(a => {
    const c = a.course;
    if (!data[c]) data[c] = { attempts: 0, goals: 0 };

    data[c].attempts++;
    if (['Goal'].includes(a.result)) {
      data[c].goals++;
    }
  });

  // レート計算
  Object.keys(data).forEach(k => {
    const d = data[k];
    d.rate = d.attempts > 0 ? d.goals / d.attempts : 0;
  });

  return data;
}

// フィルタ更新用
function updateHeatmapPlayerSelect() {
  const teamSelect = document.getElementById('heatmapTeamSelect');
  const playerSelect = document.getElementById('heatmapPlayerSelect');
  if (!teamSelect || !playerSelect) return;

  const team = teamSelect.value;
  const currentVal = playerSelect.value;

  playerSelect.innerHTML = '<option value="all">全員</option>';

  const players = team === 'Own' ? matchState.players : matchState.oppPlayers;
  const targetPlayers = players || [];

  targetPlayers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.no;
    opt.text = `#${p.no} ${p.name || ''}`;
    playerSelect.appendChild(opt);
  });

  // 選択復元（存在すれば）
  if (currentVal !== 'all' && targetPlayers.some(p => p.no == currentVal)) {
    playerSelect.value = currentVal;
  }
}

function initHeatmapEvents() {
  const teamSelect = document.getElementById('heatmapTeamSelect');
  const playerSelect = document.getElementById('heatmapPlayerSelect');
  const tabContainer = document.getElementById('heatmapActionTabs');

  if (teamSelect) {
    teamSelect.addEventListener('change', () => {
      updateHeatmapPlayerSelect();
      renderHeatmap();
    });
  }
  if (playerSelect) {
    playerSelect.addEventListener('change', renderHeatmap);
  }

  if (tabContainer) {
    tabContainer.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // アクティブ切り替え
        tabContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // アクション更新
        currentHeatmapAction = btn.dataset.action;
        renderHeatmap();
      });
    });
  }
}

// ========================================
// PDFレポート出力機能
// ========================================
document.getElementById('exportPdfBtn').addEventListener('click', async () => {
  document.getElementById('matchMenu').style.display = 'none';

  try {
    await generatePdfReport();
  } catch (error) {
    console.error('PDF generation failed:', error);
    alert('PDFの出力に失敗しました。');
  }
});

// ===== CSV エクスポート =====
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  document.getElementById('matchMenu').style.display = 'none';

  if (!matchState.actions || matchState.actions.length === 0) {
    alert('エクスポートするデータがありません。');
    return;
  }

  try {
    exportCsv();
  } catch (error) {
    console.error('CSV export failed:', error);
    alert('CSVの出力に失敗しました。');
  }
});

function exportCsv() {
  const headers = ['時間', '正確な時間', '前後半', 'チーム', 'チーム名', '背番号', 'フェーズ', 'アクション', 'ゾーン', 'コース', '結果', '備考', '自GK', '相手GK'];

  const rows = matchState.actions.map(a => {
    const teamName = a.team === 'Own' ? matchState.ownName : matchState.oppName;
    const halfLabel = a.half === 1 ? '前半' : '後半';
    return [
      a.time || '',
      a.exactTime || '',
      halfLabel,
      a.team || '',
      teamName,
      a.no != null ? a.no : '',
      a.phase || '',
      a.action || '',
      a.zone || '',
      a.course || '',
      a.result || '',
      a.memo || '',
      a.own_gk != null ? a.own_gk : '',
      a.opp_gk != null ? a.opp_gk : ''
    ];
  });

  // Excel用HTMLテーブル形式で.xlsファイルを生成
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let tableHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><style>td,th{mso-number-format:'\\@';}</style></head><body><table>`;

  // ヘッダー行
  tableHtml += '<tr>' + headers.map(h => `<th style="background:#2563eb;color:#fff;font-weight:bold;padding:6px 12px;border:1px solid #93c5fd;">${esc(h)}</th>`).join('') + '</tr>';

  // データ行
  rows.forEach((row, i) => {
    const bgColor = i % 2 === 0 ? '#f8fafc' : '#e2e8f0';
    tableHtml += '<tr>' + row.map(val => `<td style="padding:4px 10px;border:1px solid #cbd5e1;background:${bgColor};">${esc(val)}</td>`).join('') + '</tr>';
  });

  tableHtml += '</table></body></html>';

  // ダウンロード (.xls形式)
  const blob = new Blob([tableHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tournament = matchState.tournamentName ? `[${matchState.tournamentName}]_` : '';
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  a.href = url;
  a.download = `${tournament}${matchState.ownName}_vs_${matchState.oppName}_${dateStr}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ===== Excel インポート =====
document.getElementById('importExcelBtn').addEventListener('click', () => {
  document.getElementById('excelFileInput').click();
});

document.getElementById('excelFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      importExcelFile(evt.target.result, file.name);
    } catch (error) {
      console.error('Excel import failed:', error);
      alert('Excelの読み込みに失敗しました: ' + error.message);
    }
  };
  reader.readAsArrayBuffer(file);
  // 同じファイルを再選択できるようリセット
  e.target.value = '';
});

function importExcelFile(data, fileName) {
  const wb = XLSX.read(data, { type: 'array' });

  // 1. Dataシートを探す
  const dataSheetName = wb.SheetNames.find(n => n === 'Data') || wb.SheetNames[0];
  const ws = wb.Sheets[dataSheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  // ヘッダー行を探す (Time, Team, No., Phase, Action, Zone, Result...)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    if (row && row.some(v => v === 'Time') && row.some(v => v === 'Team')) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error('Dataシートにヘッダー行（Time, Team...）が見つかりません');
  }

  const headers = rows[headerRowIdx];
  const colIdx = {};
  headers.forEach((h, i) => { if (h) colIdx[String(h).trim()] = i; });

  // 必須カラム確認
  if (colIdx['Time'] === undefined || colIdx['Team'] === undefined) {
    throw new Error('必須カラム(Time, Team)が見つかりません');
  }

  // 2. アクションデータを変換
  const actions = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || (!row[colIdx['Time']] && !row[colIdx['Team']])) continue;

    const team = row[colIdx['Team']];
    if (team !== 'Own' && team !== 'Opp') continue;

    const timeRaw = String(row[colIdx['Time']] || '').replace(/～/g, '~');
    const no = row[colIdx['No.']] != null ? row[colIdx['No.']] : null;
    const phase = row[colIdx['Phase']] || 'SetOF';
    const action = row[colIdx['Action']] || '';
    const zone = row[colIdx['Zone']] || '';
    const result = row[colIdx['Result']] || '';
    const ownGk = row[colIdx['Own_GK']] != null ? row[colIdx['Own_GK']] : null;
    const oppGk = row[colIdx['Opp_GK']] != null ? row[colIdx['Opp_GK']] : null;

    // 前後半判定（時間帯から）
    let half = 1;
    const timeStart = parseInt(timeRaw);
    if (!isNaN(timeStart) && timeStart >= 30) half = 2;

    actions.push({
      time: timeRaw,
      exactTime: '',
      team: team,
      no: no,
      phase: phase,
      action: action,
      zone: zone,
      course: '',
      result: result,
      memo: '',
      half: half,
      own_gk: ownGk,
      opp_gk: oppGk
    });
  }

  if (actions.length === 0) {
    throw new Error('読み込めるアクションデータがありませんでした');
  }

  // 3. Personalシートからメンバー取得
  let ownMembers = [];
  let oppMembers = [];
  const personalSheet = wb.SheetNames.find(n => n === 'Personal');
  if (personalSheet) {
    const pws = wb.Sheets[personalSheet];
    const pRows = XLSX.utils.sheet_to_json(pws, { header: 1 });

    let section = null;
    for (let i = 0; i < pRows.length; i++) {
      const row = pRows[i];
      if (!row) continue;
      const firstCell = String(row[0] || '').trim();

      if (firstCell.includes('Own') || firstCell.includes('自チーム')) {
        section = 'own';
        continue;
      }
      if (firstCell.includes('Opp') || firstCell.includes('相手') || firstCell.includes('Opponent')) {
        section = 'opp';
        continue;
      }
      if (firstCell === 'No.' || firstCell === 'NO') continue;

      if (section && row[0] != null && typeof row[0] === 'number' && row[1]) {
        const member = { no: String(row[0]), name: String(row[1]) };
        if (section === 'own') ownMembers.push(member);
        else oppMembers.push(member);
      }
    }
  }

  // 4. ファイル名からチーム名推定（vs〇〇）
  let oppName = '相手チーム';
  const vsMatch = fileName.match(/vs\s*(.+?)[\s.]/i);
  if (vsMatch) oppName = vsMatch[1].trim();

  // 大会名推定
  let tournamentName = '';
  const tournMatch = fileName.match(/[\d.]+\s+(.+?)vs/i);
  if (tournMatch) tournamentName = tournMatch[1].trim();

  // 5. matchStateを構築
  matchState.ownName = matchState.ownName || '自チーム';
  matchState.oppName = oppName;
  matchState.tournamentName = tournamentName || matchState.tournamentName || '';
  matchState.actions = actions;
  if (ownMembers.length > 0) matchState.ownMembers = ownMembers;
  if (oppMembers.length > 0) matchState.oppMembers = oppMembers;

  // 統計を再計算
  matchState.stats = computeStats(actions);

  // 6. UIを分析タブに切替
  // 試合画面に遷移
  document.getElementById('homeScreen').style.display = 'none';
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('mainScreen').style.display = 'block';

  // 分析タブに切替
  document.querySelectorAll('.main-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === 'analysis');
  });
  document.getElementById('inputView').style.display = 'none';
  document.getElementById('inputView').classList.remove('active');
  document.getElementById('analysisView').style.display = '';
  document.getElementById('analysisView').classList.add('active');
  renderAnalysisDashboard();

  alert(`✅ Excel読込完了！\n${actions.length}件のアクションデータを読み込みました。\n${matchState.ownName} vs ${matchState.oppName}`);
}



async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generatePdfReport() {
  const overlay = document.getElementById('pdfLoadingOverlay');
  overlay.style.display = 'flex';

  const originalMode = document.body.className;
  document.body.classList.add('pdf-export-mode');

  // Ensure Analysis View is visible
  const analysisView = document.getElementById('analysisView');
  const wasHidden = analysisView.style.display === 'none';
  if (wasHidden) analysisView.style.display = 'block';

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Set first page background
  pdf.setFillColor(10, 14, 26);
  pdf.rect(0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), 'F');

  try {
    const dashboardContent = document.getElementById('dashboardContent');
    if (!dashboardContent) throw new Error("ダッシュボード要素が見つかりません");

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const contentWidth = pdfWidth - margin * 2;
    let currentY = margin;

    // ヘッダー情報追加
    const headerDiv = document.createElement('div');
    headerDiv.className = 'pdf-header';
    const tournament = matchState.tournamentName ? `[${matchState.tournamentName}] ` : '';
    const dateStrFormatted = new Date().toLocaleDateString('ja-JP');
    headerDiv.innerHTML = `
      <div class="pdf-title">リアルタイム分析レポート</div>
      <div class="pdf-subtitle">${tournament}${matchState.ownName} vs ${matchState.oppName} (${dateStrFormatted})</div>
      <div style="font-size:1.5rem; margin-top:10px; color:#fff; font-weight:bold;">Score: ${matchState.stats.own.total.goals} - ${matchState.stats.opp.total.goals}</div>
    `;
    dashboardContent.insertBefore(headerDiv, dashboardContent.firstChild);

    const captureAndAdd = async (el) => {
      // Chart.jsキャンバスを静的画像に変換（html2canvasがcanvasを正しく読めない問題の対策）
      const chartCanvases = el.querySelectorAll('canvas');
      const originals = [];
      chartCanvases.forEach(cvs => {
        try {
          const img = document.createElement('img');
          img.src = cvs.toDataURL('image/png');
          img.style.width = cvs.style.width || cvs.offsetWidth + 'px';
          img.style.height = cvs.style.height || cvs.offsetHeight + 'px';
          img.style.display = 'block';
          originals.push({ canvas: cvs, parent: cvs.parentNode, next: cvs.nextSibling });
          cvs.parentNode.replaceChild(img, cvs);
        } catch (e) {
          console.warn('Canvas to img conversion failed:', e);
        }
      });

      await wait(500);
      try {
        const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#0a0e1a', useCORS: true, logging: false });

        if (canvas.width === 0 || canvas.height === 0) {
          console.warn("Skipping 0x0 element:", el.className, el.id);
          // 復元
          originals.forEach(o => { if (o.next) o.parent.insertBefore(o.canvas, o.next); else o.parent.appendChild(o.canvas); });
          return;
        }

        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        if (imgData === 'data:,') {
          console.warn("Skipping empty imgData for element:", el.className, el.id);
          originals.forEach(o => { if (o.next) o.parent.insertBefore(o.canvas, o.next); else o.parent.appendChild(o.canvas); });
          return;
        }

        const imgProps = pdf.getImageProperties(imgData);
        const imgHeight = (imgProps.height * contentWidth) / imgProps.width;

        if (currentY + imgHeight > pdfHeight - margin && currentY > margin) {
          pdf.addPage();
          pdf.setFillColor(10, 14, 26);
          pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
          currentY = margin;
        }
        pdf.addImage(imgData, 'JPEG', margin, currentY, contentWidth, imgHeight);
        currentY += imgHeight + 8;
      } catch (e) {
        console.warn("html2canvas capture failed for element:", el, e);
      }

      // Chart.jsキャンバスを復元
      originals.forEach(o => {
        const img = o.next ? o.next.previousSibling : o.parent.lastChild;
        if (img && img.tagName === 'IMG') {
          o.parent.replaceChild(o.canvas, img);
        }
      });
    };

    const children = Array.from(dashboardContent.children);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (window.getComputedStyle(child).display === 'none') continue;

      // チーム比較タブがあるセクションの場合、タブ切り替えでキャプチャ
      const teamTabs = child.querySelector('#teamTabs');
      if (teamTabs) {
        const tabs = Array.from(teamTabs.querySelectorAll('.tab-btn'));
        const totalTab = tabs.find(t => t.dataset.tab === 'total');
        const firstTab = tabs.find(t => t.dataset.tab === 'first');
        const secondTab = tabs.find(t => t.dataset.tab === 'second');

        if (totalTab) { totalTab.click(); }
        await captureAndAdd(child);

        if (firstTab && matchState.actions.some(a => [1, 3, 5].includes(a.half))) {
          firstTab.click();
          await captureAndAdd(child);
        }

        if (secondTab && matchState.actions.some(a => [2, 4, 6].includes(a.half))) {
          secondTab.click();
          await captureAndAdd(child);
        }

        if (totalTab) totalTab.click(); // 復元
        continue;
      }

      // ヒートマップセクションの場合、全シュートタイプ × 自チーム・相手チーム
      if (child.querySelector('.heatmap-controls-top')) {
        const teamSelect = document.getElementById('heatmapTeamSelect');
        const tabContainer = document.getElementById('heatmapActionTabs');
        const actionTabs = tabContainer ? Array.from(tabContainer.querySelectorAll('.tab-btn')) : [];
        const shootActions = ['DS', 'LS', 'WS', 'BT', 'PS', 'PT'];
        const savedAction = currentHeatmapAction;

        for (const action of shootActions) {
          // アクションタブ切り替え
          currentHeatmapAction = action;
          actionTabs.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.action === action);
          });

          // 自チーム
          teamSelect.value = 'Own';
          teamSelect.dispatchEvent(new Event('change'));
          renderHeatmap();
          await captureAndAdd(child);

          // 相手チーム
          teamSelect.value = 'Opp';
          teamSelect.dispatchEvent(new Event('change'));
          renderHeatmap();
          await captureAndAdd(child);
        }

        // 復元
        currentHeatmapAction = savedAction;
        actionTabs.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.action === savedAction);
        });
        teamSelect.value = 'Own';
        teamSelect.dispatchEvent(new Event('change'));
        renderHeatmap();
        continue;
      }

      // アクションタイムラインセクション：独立DOMを生成してキャプチャ
      const timelineFiltersEl = child.querySelector('#timelineFilters');
      if (timelineFiltersEl) {
        const filterValues = ['全て', 'Own', 'Opp', 'Goal', 'TO'];
        const filterLabels = { '全て': '全て', 'Own': matchState.ownName, 'Opp': matchState.oppName, 'Goal': 'Goal', 'TO': 'TO' };

        for (const filterVal of filterValues) {
          // 各項目（全て、Own、Oppなど）は必ず新しいページから開始する
          if (currentY > margin + 5) {
            pdf.addPage();
            pdf.setFillColor(10, 14, 26);
            pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
            currentY = margin;
          }

          let actions = [...matchState.actions];
          if (filterVal === 'Own') actions = actions.filter(a => a.team === 'Own');
          else if (filterVal === 'Opp') actions = actions.filter(a => a.team === 'Opp');
          else if (filterVal === 'Goal') actions = actions.filter(a => a.result === 'Goal');
          else if (filterVal === 'TO') actions = actions.filter(a => a.action === 'TO');

          // フィルタータブHTML
          const tabsHtml = filterValues.map(f => {
            const isActive = f === filterVal;
            const label = filterLabels[f];
            const tabStyle = isActive
              ? 'padding:6px 16px;border-radius:20px;border:1px solid #3b82f6;background:rgba(59,130,246,0.2);color:#93c5fd;font-weight:700;font-size:0.85rem;cursor:pointer;'
              : 'padding:6px 16px;border-radius:20px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#94a3b8;font-weight:500;font-size:0.85rem;cursor:pointer;';
            return `<span style="${tabStyle}">${label}</span>`;
          }).join('');

          // チャンクに分割して複数ページに対応する
          const chunkSize = 25; // 1ページに収まる安全な行数
          const numChunks = Math.max(1, Math.ceil(actions.length / chunkSize));

          for (let i = 0; i < numChunks; i++) {
            const chunk = actions.slice(i * chunkSize, (i + 1) * chunkSize);

            // タイムライン行HTML生成
            let rowsHtml = '';
            if (chunk.length === 0 && i === 0 && actions.length === 0) {
              rowsHtml = '<div style="color:#64748b;padding:20px;text-align:center;">データなし</div>';
            } else if (chunk.length > 0) {
              rowsHtml = `<div style="display:flex;gap:8px;font-weight:700;font-size:0.75rem;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:10px;margin-bottom:8px;">
                <span style="min-width:44px">時間</span><span style="min-width:36px">チーム</span><span style="min-width:24px">No</span>
                <span style="min-width:48px">フェーズ</span><span style="min-width:28px">種別</span><span style="min-width:16px">Z</span><span>結果</span>
              </div>`;

              chunk.forEach(a => {
                const teamBg = a.team === 'Own' ? 'background:#2563eb;color:#fff;' : 'background:#dc2626;color:#fff;';
                const phaseColor = a.phase !== 'SetOF' ? 'color:#60a5fa;font-weight:700;' : 'color:#94a3b8;';
                let resultStyle = 'background:rgba(148,163,184,0.3);color:#e2e8f0;';
                if (a.result === 'Goal') resultStyle = 'background:rgba(16,185,129,0.4);color:#6ee7b7;';
                else if (a.result === 'Save') resultStyle = 'background:rgba(245,158,11,0.4);color:#fcd34d;';
                else if (a.result === 'Out' || a.result === 'Block') resultStyle = 'background:rgba(239,68,68,0.3);color:#fca5a5;';
                rowsHtml += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:0.8rem;border-bottom:1px solid rgba(255,255,255,0.08);">
                  <span style="font-family:monospace;color:#e2e8f0;font-size:0.72rem;min-width:44px;">${a.time}</span>
                  <span style="font-weight:700;min-width:36px;padding:2px 6px;border-radius:4px;text-align:center;font-size:0.7rem;${teamBg}">${a.team === 'Own' ? matchState.ownName.charAt(0) : matchState.oppName.charAt(0)}</span>
                  <span style="font-weight:700;font-family:monospace;min-width:24px;color:#f8fafc;">#${a.no}</span>
                  <span style="font-size:0.7rem;min-width:48px;${phaseColor}">${a.phase}</span>
                  <span style="font-weight:600;min-width:28px;color:#f8fafc;">${a.action}</span>
                  <span style="color:#94a3b8;min-width:16px;">${a.zone || ''}</span>
                  <span style="padding:2px 10px;border-radius:4px;font-weight:600;font-size:0.75rem;${resultStyle}">${a.result}</span>
                </div>`;
              });
            }

            if (rowsHtml || (i === 0 && actions.length === 0)) {
              // 独立したDOMノードを作成
              const standalone = document.createElement('div');
              standalone.style.cssText = 'position:absolute;left:0;top:0;width:1200px;background:#0a0e1a;padding:20px;z-index:99999;font-family:Inter,sans-serif;color:#f1f5f9;';

              let headerHtml = '';
              if (i === 0) {
                headerHtml = `
                  <div style="font-size:1.1rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px;color:#f1f5f9;">
                    <span style="font-size:1.2rem;">⏱️</span>アクションタイムライン
                  </div>
                  <div style="display:flex;gap:8px;margin-bottom:16px;">${tabsHtml}</div>
                `;
              } else {
                headerHtml = `
                  <div style="font-size:1.1rem;font-weight:700;margin-bottom:16px;display:flex;align-items:center;gap:8px;color:#f1f5f9;">
                    <span style="font-size:1.2rem;">⏱️</span>アクションタイムライン (${filterLabels[filterVal]} - 続き)
                  </div>
                `;
              }

              standalone.innerHTML = headerHtml + `
                <div style="padding:16px;background:#0f1629;border:1px solid rgba(255,255,255,0.2);border-radius:12px;">${rowsHtml}</div>
              `;

              document.body.appendChild(standalone);
              await captureAndAdd(standalone);
              standalone.remove();
            }
          }
        }

        // 元のUIのフィルター復元
        timelineFiltersEl.querySelectorAll('.timeline-filter-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.filter === '全て');
        });
        renderTimelineItems('全て');
        continue;
      }

      // 通常のセクションやヘッダー
      await captureAndAdd(child);
    }

    headerDiv.remove();

    // 保存
    const matchTitle = `${tournament}${matchState.ownName} vs ${matchState.oppName}`;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${matchTitle.replace(/ /g, '_')}_${dateStr}.pdf`;
    pdf.save(filename);

  } finally {
    // 復元処理
    document.body.classList.remove('pdf-export-mode');
    if (originalMode) document.body.className = originalMode;
    if (wasHidden) analysisView.style.display = 'none';

    overlay.style.display = 'none';
  }
}

