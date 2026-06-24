/* ===== Constants ===== */
const INTERVALS = [1, 2, 4, 7, 15, 30];

/* ===== State ===== */
let currentScreen = 'search';
let prevScreen = 'search';
let currentWord = null;
let ttsActive = false;
let cachedVoice = null;
let alphabetGroups = null;
let wordMap = null;

let reviewSession = {
  queue: [],
  currentIndex: 0,
  remembered: [],
  retry: []
};

let mcSession = { wordPool: null, fromFlow: false, total: 0, correct: 0, currentQ: null, wordQueue: null, wordQueueIdx: 0 };

let spellSession = { words: [], current: 0, results: [], total: 0, bothCorrect: 0, fromFlow: false };

let reverseSession = { recentWords: [], total: 0, recognised: 0, wordPool: null };

let studyFlowWordPool = null;
let studyFlowWordCount = 20;
let studyFlowPendingTTS = false;

let flashSession = {
  words: [],
  count: 20,
  round1Results: {},
  round2Words: [],
  round2Results: {},
  addedToQueue: [],
};

/* ===== Date Helpers ===== */
function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* ===== SR Data ===== */
function getSRData() {
  try {
    return JSON.parse(localStorage.getItem('ielts_sr_data') || '{}');
  } catch {
    return {};
  }
}

function saveSRData(data) {
  localStorage.setItem('ielts_sr_data', JSON.stringify(data));
}

function getWordSR(word) {
  return getSRData()[word] || null;
}

function addWordToReview(word) {
  const data = getSRData();
  if (data[word]) return;
  const today = getTodayStr();
  data[word] = {
    word,
    intervalIndex: 0,
    nextReview: addDaysToStr(today, 1),
    addedDate: today,
    reviewCount: 0
  };
  saveSRData(data);
}

function recordReview(word, remembered) {
  const data = getSRData();
  if (!data[word]) return;
  const item = data[word];
  item.reviewCount++;
  if (remembered) {
    item.intervalIndex = Math.min(item.intervalIndex + 1, INTERVALS.length - 1);
  } else {
    item.intervalIndex = 0;
  }
  item.nextReview = addDaysToStr(getTodayStr(), INTERVALS[item.intervalIndex]);
  saveSRData(data);
}

function getDueWords() {
  const data = getSRData();
  const today = getTodayStr();
  return Object.values(data)
    .filter(item => item.nextReview <= today)
    .map(item => item.word);
}

/* ===== TTS ===== */
function selectVoice(voices) {
  return voices.find(v => v.name.includes('Google') && v.lang.startsWith('en')) ||
    voices.find(v => v.name.includes('Samantha')) ||
    voices.find(v => v.lang.startsWith('en-US')) ||
    voices.find(v => v.lang.startsWith('en')) ||
    null;
}

function initVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) cachedVoice = selectVoice(voices);
}

function getVoice() {
  if (cachedVoice) return cachedVoice;
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  cachedVoice = selectVoice(voices);
  return cachedVoice;
}

function speakSequence(word, synonyms) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  ttsActive = true;

  const items = [word, ...synonyms];
  let index = 0;

  function speakNext() {
    if (!ttsActive || index >= items.length) {
      ttsActive = false;
      return;
    }

    const utt = new SpeechSynthesisUtterance(items[index]);
    utt.lang = 'en-US';
    utt.rate = 0.85;
    const voice = getVoice();
    if (voice) utt.voice = voice;

    utt.onend = () => {
      index++;
      if (index < items.length && ttsActive) {
        const pause = index === 1 ? 800 : 600;
        setTimeout(speakNext, pause);
      } else {
        ttsActive = false;
      }
    };

    utt.onerror = () => {
      index++;
      if (index < items.length && ttsActive) {
        setTimeout(speakNext, 600);
      } else {
        ttsActive = false;
      }
    };

    window.speechSynthesis.speak(utt);
  }

  speakNext();
}

function stopTTS() {
  ttsActive = false;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/* ===== Search ===== */
function fuzzyMatch(query, word) {
  const q = query.toLowerCase();
  const w = word.toLowerCase();
  if (w.startsWith(q)) return true;
  let qi = 0;
  for (let wi = 0; wi < w.length && qi < q.length; wi++) {
    if (w[wi] === q[qi]) qi++;
  }
  return qi === q.length;
}

function searchWords(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = SYNONYMS_DATA.filter(item => fuzzyMatch(q, item.word));
  results.sort((a, b) => {
    const al = a.word.toLowerCase();
    const bl = b.word.toLowerCase();
    const ap = al.startsWith(q);
    const bp = bl.startsWith(q);
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    if (ap && bp) return a.word.length - b.word.length;
    return a.word.length - b.word.length;
  });
  return results.slice(0, 8);
}

/* ===== Helpers ===== */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getWordMap() {
  if (!wordMap) wordMap = new Map(SYNONYMS_DATA.map(item => [item.word, item]));
  return wordMap;
}

function buildAlphaGroups() {
  const sorted = [...SYNONYMS_DATA].sort((a, b) =>
    a.word.toLowerCase().localeCompare(b.word.toLowerCase())
  );
  const groups = {};
  sorted.forEach(item => {
    const letter = item.word[0].toUpperCase();
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(item);
  });
  alphabetGroups = groups;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function renderDiff(input, correct) {
  const container = document.createElement('span');
  container.style.cssText = 'font-size:20px;font-family:monospace;letter-spacing:0.05em;display:inline-block';
  for (let i = 0; i < correct.length; i++) {
    const span = document.createElement('span');
    if (i < input.length && input[i] === correct[i]) {
      span.style.color = '#E8F4FF';
    } else {
      span.style.color = '#EF4444';
      span.style.textDecoration = 'underline';
    }
    span.textContent = correct[i];
    container.appendChild(span);
  }
  for (let i = correct.length; i < input.length; i++) {
    const span = document.createElement('span');
    span.style.color = '#EF4444';
    span.style.textDecoration = 'line-through';
    span.textContent = input[i];
    container.appendChild(span);
  }
  return container;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = [];
  for (let i = 0; i <= m; i++) { dp[i] = new Array(n + 1).fill(0); dp[i][0] = i; }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

/* ===== Navigation ===== */
function showScreen(screen) {
  stopTTS();
  document.body.classList.remove('detail-active');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screen}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === screen);
  });
  currentScreen = screen;

  if (screen === 'review') initReviewScreen();
  else if (screen === 'stats') renderStats();
  else if (screen === 'flash') initFlashScreen();
  else if (screen === 'practice') initPracticeScreen();
}

function showDetail(wordData) {
  prevScreen = currentScreen;
  currentWord = wordData;
  stopTTS();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-detail').classList.add('active');
  document.body.classList.add('detail-active');
  renderDetail(wordData);
  // TTS auto-play triggered by user tap (qualifying gesture for iOS)
  speakSequence(wordData.word, wordData.synonyms);
}

function goBack() {
  stopTTS();
  document.body.classList.remove('detail-active');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${prevScreen}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === prevScreen);
  });
  currentScreen = prevScreen;
}

/* ===== Search Screen ===== */
function initSearchScreen() {
  const input = document.getElementById('search-input');
  const resultsEl = document.getElementById('search-results');

  renderSearchResults([], '', resultsEl);

  input.addEventListener('input', () => {
    const matches = searchWords(input.value);
    renderSearchResults(matches, input.value, resultsEl);
  });
}

function renderSearchResults(results, query, container) {
  if (!query.trim()) {
    renderAlphaList(container);
    return;
  }
  if (results.length === 0) {
    container.innerHTML = '<div class="search-empty">未找到匹配词汇</div>';
    return;
  }

  const map = getWordMap();
  container.innerHTML = results.map(item =>
    `<div class="word-row" data-word="${escapeAttr(item.word)}">
      <span class="row-word">${escapeHtml(item.word)}</span>
      <span class="row-zh">${escapeHtml(item.zh)}</span>
    </div>`
  ).join('');

  container.querySelectorAll('.word-row').forEach(row => {
    row.addEventListener('click', () => {
      const wd = map.get(row.dataset.word);
      if (wd) showDetail(wd);
    });
  });
}

function renderAlphaList(container) {
  if (!alphabetGroups) buildAlphaGroups();
  const map = getWordMap();
  const letters = Object.keys(alphabetGroups).sort();
  let html = '';
  letters.forEach(letter => {
    html += `<div class="section-header">${letter}</div>`;
    alphabetGroups[letter].forEach(item => {
      html += `<div class="word-row" data-word="${escapeAttr(item.word)}">
        <span class="row-word">${escapeHtml(item.word)}</span>
        <span class="row-zh">${escapeHtml(item.zh)}</span>
      </div>`;
    });
  });
  container.innerHTML = html;
  container.querySelectorAll('.word-row').forEach(row => {
    row.addEventListener('click', () => {
      const wd = map.get(row.dataset.word);
      if (wd) showDetail(wd);
    });
  });
}

/* ===== Detail Screen ===== */
function renderDetail(wordData) {
  const content = document.getElementById('detail-content');
  const sr = getWordSR(wordData.word);

  const sourceLabelMap = { liu: 'Liu', new: 'New', both: 'Both' };
  const sourceLabel = sourceLabelMap[wordData.source] || wordData.source;

  const actionHtml = sr
    ? `<div class="next-review">已加入复习 · 下次复习: ${sr.nextReview}</div>`
    : `<button class="btn btn--primary" id="add-review-btn">加入复习队列 +</button>`;

  const synonymChips = wordData.synonyms.length > 0
    ? wordData.synonyms.map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('')
    : '<span class="no-synonyms">暂无同义词</span>';

  content.innerHTML = `
    <div class="detail-header">
      <div class="detail-word-row">
        <h1 class="detail-word">${escapeHtml(wordData.word)}</h1>
        <button class="replay-btn" id="replay-tts" title="重新播放">🔊</button>
      </div>
      <div class="detail-zh">${escapeHtml(wordData.zh)}</div>
      <span class="source-badge badge--${wordData.source}">${sourceLabel}</span>
    </div>
    <div class="detail-synonyms">
      <h3 class="synonyms-label">同义词 · ${wordData.synonyms.length} 个</h3>
      <div class="chips">${synonymChips}</div>
    </div>
    <div class="detail-action">${actionHtml}</div>
  `;

  document.getElementById('replay-tts').addEventListener('click', () => {
    speakSequence(wordData.word, wordData.synonyms);
  });

  const addBtn = document.getElementById('add-review-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addWordToReview(wordData.word);
      const srNow = getWordSR(wordData.word);
      const newEl = document.createElement('div');
      newEl.className = 'next-review';
      newEl.textContent = `已加入复习 · 下次复习: ${srNow.nextReview}`;
      addBtn.replaceWith(newEl);
    });
  }
}

/* ===== Review Screen ===== */
function initReviewScreen() {
  const dueWords = getDueWords();
  const header = document.getElementById('review-header');
  const content = document.getElementById('review-content');

  if (dueWords.length === 0) {
    const data = getSRData();
    const entries = Object.values(data);
    let nextMsg = '暂无复习计划';
    if (entries.length > 0) {
      const nextDate = entries.map(e => e.nextReview).sort()[0];
      nextMsg = `下次复习: ${nextDate}`;
    }
    header.innerHTML = '<h2 class="review-title">复习</h2>';
    content.innerHTML = `
      <div class="review-empty">
        <div style="font-size:48px;margin-bottom:8px">🎉</div>
        <div class="congrats">今天没有需要复习的词汇！</div>
        <div class="next-info">${nextMsg}</div>
        ${entries.length === 0 ? '<div class="next-info" style="margin-top:8px">先去查词，把词汇加入复习队列吧</div>' : ''}
      </div>`;
    return;
  }

  reviewSession.queue = dueWords
    .map(w => SYNONYMS_DATA.find(item => item.word === w))
    .filter(Boolean);
  reviewSession.currentIndex = 0;
  reviewSession.remembered = [];
  reviewSession.retry = [];

  renderReviewCard();
}

function renderReviewCard() {
  const total = reviewSession.queue.length;
  const idx = reviewSession.currentIndex;
  const content = document.getElementById('review-content');
  const header = document.getElementById('review-header');

  if (idx >= total) {
    renderReviewSummary();
    return;
  }

  const wordData = reviewSession.queue[idx];
  if (!wordData) {
    reviewSession.currentIndex++;
    renderReviewCard();
    return;
  }

  const progress = Math.round((idx / total) * 100);

  header.innerHTML = `
    <div class="review-progress-bar">
      <div class="review-progress-fill" style="width:${progress}%"></div>
    </div>
    <div class="review-count">今天需要复习 ${total} 个词 &nbsp;·&nbsp; 已完成 ${idx}/${total}</div>
  `;

  content.innerHTML = `
    <div class="review-card">
      <div class="review-word">${escapeHtml(wordData.word)}</div>
      <div class="review-zh">${escapeHtml(wordData.zh)}</div>
      <div id="review-synonyms" class="review-synonyms hidden"></div>
      <div class="review-actions">
        <button class="btn btn--secondary btn--large" id="show-answer-btn">显示答案</button>
      </div>
    </div>`;

  document.getElementById('show-answer-btn').addEventListener('click', () => {
    showReviewAnswer(wordData);
  });
}

function showReviewAnswer(wordData) {
  const synonymsDiv = document.getElementById('review-synonyms');
  const actionsDiv = document.querySelector('.review-actions');

  synonymsDiv.classList.remove('hidden');
  const chips = wordData.synonyms.length > 0
    ? wordData.synonyms.map(s => `<span class="chip">${escapeHtml(s)}</span>`).join('')
    : '<span class="no-synonyms">暂无同义词</span>';
  synonymsDiv.innerHTML = `
    <h3 class="synonyms-label">同义词</h3>
    <div class="chips">${chips}</div>`;

  actionsDiv.innerHTML = `
    <button class="btn btn--success btn--large" id="remembered-btn">记住了 ✓</button>
    <button class="btn btn--danger btn--large" id="retry-btn">再来一次 ↩</button>`;

  // TTS triggered by tapping "显示答案" — user gesture, iOS-safe
  speakSequence(wordData.word, wordData.synonyms);

  document.getElementById('remembered-btn').addEventListener('click', () => {
    stopTTS();
    recordReview(wordData.word, true);
    reviewSession.remembered.push(wordData.word);
    reviewSession.currentIndex++;
    renderReviewCard();
  });

  document.getElementById('retry-btn').addEventListener('click', () => {
    stopTTS();
    recordReview(wordData.word, false);
    reviewSession.retry.push(wordData.word);
    reviewSession.currentIndex++;
    renderReviewCard();
  });
}

function renderReviewSummary() {
  const content = document.getElementById('review-content');
  const header = document.getElementById('review-header');

  const rem = reviewSession.remembered.length;
  const ret = reviewSession.retry.length;

  const sessions = parseInt(localStorage.getItem('ielts_sessions') || '0') + 1;
  localStorage.setItem('ielts_sessions', String(sessions));

  header.innerHTML = '<h2 class="review-title">复习完成</h2>';

  content.innerHTML = `
    <div class="review-summary">
      <div class="summary-stat summary-stat--good">
        <div class="summary-num">${rem}</div>
        <div class="summary-label">已记住</div>
      </div>
      <div class="summary-stat summary-stat--bad">
        <div class="summary-num">${ret}</div>
        <div class="summary-label">需再复习</div>
      </div>
    </div>
    <div style="padding:0 20px">
      <button class="btn btn--primary" onclick="showScreen('search')">返回查词</button>
    </div>`;
}

/* ===== Stats Screen ===== */
function renderStats() {
  const data = getSRData();
  const entries = Object.values(data);
  const today = getTodayStr();
  const weekEnd = addDaysToStr(today, 7);

  const total = entries.length;
  const dueToday = entries.filter(e => e.nextReview <= today).length;
  const dueWeek = entries.filter(e => e.nextReview > today && e.nextReview <= weekEnd).length;
  const sessions = parseInt(localStorage.getItem('ielts_sessions') || '0');

  const newWords = entries.filter(e => e.intervalIndex === 0).length;
  const learning = entries.filter(e => e.intervalIndex >= 1 && e.intervalIndex <= 3).length;
  const mature = entries.filter(e => e.intervalIndex >= 4).length;

  const maxBar = Math.max(newWords, learning, mature, 1);
  const toH = n => Math.max(4, Math.round((n / maxBar) * 110));

  const content = document.getElementById('stats-content');
  content.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-num">${total}</div>
        <div class="stat-label">词库总量</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="color:var(--danger)">${dueToday}</div>
        <div class="stat-label">今日待复习</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="color:var(--warning)">${dueWeek}</div>
        <div class="stat-label">本周待复习</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" style="color:var(--success)">${sessions}</div>
        <div class="stat-label">累计复习次数</div>
      </div>
    </div>
    <div class="mastery-chart">
      <h3 class="chart-title">掌握程度分布</h3>
      <div class="chart-bars">
        <div class="chart-bar-group">
          <div class="chart-bar-wrap">
            <div class="chart-bar chart-bar--new" style="height:${toH(newWords)}px"></div>
          </div>
          <div class="chart-bar-label">新词</div>
          <div class="chart-bar-num">${newWords}</div>
        </div>
        <div class="chart-bar-group">
          <div class="chart-bar-wrap">
            <div class="chart-bar chart-bar--learning" style="height:${toH(learning)}px"></div>
          </div>
          <div class="chart-bar-label">学习中</div>
          <div class="chart-bar-num">${learning}</div>
        </div>
        <div class="chart-bar-group">
          <div class="chart-bar-wrap">
            <div class="chart-bar chart-bar--mature" style="height:${toH(mature)}px"></div>
          </div>
          <div class="chart-bar-label">已掌握</div>
          <div class="chart-bar-num">${mature}</div>
        </div>
      </div>
    </div>
    ${total === 0 ? '<div class="search-empty">还没有加入任何词汇<br><small style="opacity:0.6;font-size:12px;display:block;margin-top:4px">去查词页搜索并加入复习队列</small></div>' : ''}
  `;
}

/* ===== Practice (练习) ===== */

function getPracticeStats(key) {
  try { return JSON.parse(sessionStorage.getItem(key)) || null; } catch { return null; }
}

function setPracticeStats(key, stats) {
  sessionStorage.setItem(key, JSON.stringify(stats));
}

function initPracticeScreen() {
  renderPracticeLanding();
}

function renderPracticeLanding() {
  stopTTS();
  const content = document.getElementById('practice-content');
  content.style.overflowY = '';
  content.style.display = '';
  content.style.flexDirection = '';
  studyFlowWordPool = null;
  document.getElementById('practice-header').innerHTML = '<h2 class="app-title">练习</h2>';
  const mc = getPracticeStats('practice_mc') || { total: 0, correct: 0 };
  const spell = getPracticeStats('practice_spell') || { total: 0, both_correct: 0 };
  const rev = getPracticeStats('practice_reverse') || { total: 0, recognised: 0 };
  content.innerHTML = `
    <div class="practice-landing">
      <div class="prac-flow-card" id="prac-flow-card">
        <div class="prac-flow-tag">完整学习流程</div>
        <div class="prac-flow-title">从头学这批词</div>
        <div class="prac-flow-desc">先过词 · 再专项练习</div>
        <button class="prac-flow-btn" id="prac-flow-start-btn">开始 →</button>
      </div>
      <div class="prac-divider">— 或直接进入练习（随机全库）—</div>
      <div class="prac-mode-card" id="prac-mc-card">
        <div class="prac-mode-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </div>
        <div class="prac-mode-body">
          <div class="prac-mode-title">选择题</div>
          <div class="prac-mode-desc">看词选出正确同义词</div>
          <div class="prac-mode-stat">今日: ${mc.total}题 / ${mc.correct}正确</div>
        </div>
        <svg class="prac-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      <div class="prac-mode-card" id="prac-spell-card">
        <div class="prac-mode-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
          </svg>
        </div>
        <div class="prac-mode-body">
          <div class="prac-mode-title">拼写</div>
          <div class="prac-mode-desc">看中文拼出单词和一个同义词</div>
          <div class="prac-mode-stat">今日: ${spell.total}题 / ${spell.both_correct}全对</div>
        </div>
        <svg class="prac-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      <div class="prac-mode-card" id="prac-rev-card">
        <div class="prac-mode-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="5 4 3 6 5 8"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <polyline points="19 16 21 18 19 20"/>
            <line x1="21" y1="18" x2="3" y2="18"/>
          </svg>
        </div>
        <div class="prac-mode-body">
          <div class="prac-mode-title">反向认知</div>
          <div class="prac-mode-desc">看同义词认出所属词组</div>
          <div class="prac-mode-stat">今日: ${rev.total}词 / ${rev.recognised}认出</div>
        </div>
        <svg class="prac-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>`;
  document.getElementById('prac-flow-start-btn').addEventListener('click', renderFlowSelectCount);
  document.getElementById('prac-mc-card').addEventListener('click', () => startMCMode(null));
  document.getElementById('prac-spell-card').addEventListener('click', startSpellMode);
  document.getElementById('prac-rev-card').addEventListener('click', startReverseMode);
}

function startMCMode(wordPool = null) {
  mcSession.wordPool = wordPool;
  mcSession.fromFlow = wordPool !== null;
  mcSession.wordQueue = wordPool ? shuffleArray(wordPool.filter(w => w.synonyms.length >= 1)) : null;
  mcSession.wordQueueIdx = 0;
  mcSession.total = 0;
  mcSession.correct = 0;
  mcSession.currentQ = null;
  document.getElementById('practice-header').innerHTML = `
    <div class="quiz-header-row">
      <h2 class="quiz-title">选择题</h2>
      <button class="quiz-skip-btn" id="prac-skip-btn">新题 →</button>
    </div>
    <div class="quiz-stats-bar" id="prac-stats-bar">本次: 0题 / 0正确</div>`;
  document.getElementById('prac-skip-btn').addEventListener('click', renderMCQuestion);
  renderMCQuestion();
}

function generateMCQuestion() {
  let wordData;
  if (mcSession.wordQueue) {
    wordData = mcSession.wordQueue[mcSession.wordQueueIdx++];
  } else {
    const pool = (mcSession.wordPool && mcSession.wordPool.length)
      ? mcSession.wordPool.filter(w => w.synonyms.length >= 1)
      : SYNONYMS_DATA.filter(w => w.synonyms.length >= 1);
    wordData = pool[Math.floor(Math.random() * pool.length)];
  }
  const numCorrect = (wordData.synonyms.length < 2 || Math.random() < 0.7) ? 1 : 2;
  const corrects = shuffleArray([...wordData.synonyms]).slice(0, numCorrect);
  const correctSet = new Set(corrects);
  const numDistractors = 4 - numCorrect;
  const distractors = [];
  const usedTerms = new Set([...wordData.synonyms, wordData.word]);
  for (const w of shuffleArray(SYNONYMS_DATA.filter(w => w.word !== wordData.word))) {
    if (distractors.length >= numDistractors) break;
    for (const s of shuffleArray([...w.synonyms])) {
      if (!usedTerms.has(s)) { distractors.push(s); usedTerms.add(s); break; }
    }
  }
  const allOptions = shuffleArray([
    ...corrects.map(s => ({ text: s, correct: true })),
    ...distractors.map(s => ({ text: s, correct: false })),
  ]);
  return { wordData, correctSet, allOptions, numCorrect };
}

function renderMCQuestion() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (mcSession.wordQueue && mcSession.wordQueueIdx >= mcSession.wordQueue.length) {
    renderStudyFlowComplete('选择题');
    return;
  }
  const q = generateMCQuestion();
  mcSession.currentQ = { ...q, selected: new Set(), confirmed: false };
  const hint = q.numCorrect > 1 ? '选出所有正确的同义词' : '选出正确的同义词';
  document.getElementById('practice-content').innerHTML = `
    <div class="quiz-card">
      <div class="quiz-word">${escapeHtml(q.wordData.word)}</div>
      <div class="quiz-zh">${escapeHtml(q.wordData.zh)}</div>
      <div class="quiz-hint">${hint}</div>
      <div class="quiz-options">
        ${q.allOptions.map((o, i) => `
          <button class="quiz-option" data-idx="${i}">
            <span>${escapeHtml(o.text)}</span>
            <span class="quiz-option-icon"></span>
          </button>`).join('')}
      </div>
    </div>
    <div class="quiz-footer">
      <div class="quiz-result" id="prac-result" style="display:none"></div>
      <button class="btn btn--primary btn--large" id="prac-confirm-btn" style="display:none">确认</button>
      <div id="prac-next-wrap" style="display:none">
        <button class="btn btn--secondary btn--large" id="prac-next-btn">下一题 →</button>
      </div>
    </div>`;
  updateMCStats();
  document.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const cq = mcSession.currentQ;
      if (cq.confirmed) return;
      const optText = cq.allOptions[parseInt(btn.dataset.idx)].text;
      if (cq.selected.has(optText)) {
        cq.selected.delete(optText);
        btn.classList.remove('selected');
      } else {
        cq.selected.add(optText);
        btn.classList.add('selected');
      }
      document.getElementById('prac-confirm-btn').style.display =
        cq.selected.size > 0 ? 'flex' : 'none';
    });
  });
  document.getElementById('prac-confirm-btn').addEventListener('click', confirmMCAnswer);
}

function confirmMCAnswer() {
  const cq = mcSession.currentQ;
  if (!cq || cq.confirmed) return;
  cq.confirmed = true;
  const { selected, correctSet, allOptions } = cq;
  const isCorrect = selected.size === correctSet.size && [...selected].every(s => correctSet.has(s));
  mcSession.total++;
  if (isCorrect) mcSession.correct++;
  const stats = getPracticeStats('practice_mc') || { total: 0, correct: 0 };
  stats.total++;
  if (isCorrect) stats.correct++;
  setPracticeStats('practice_mc', stats);
  updateMCStats();
  document.querySelectorAll('.quiz-option').forEach(btn => {
    btn.disabled = true;
    const opt = allOptions[parseInt(btn.dataset.idx)];
    const icon = btn.querySelector('.quiz-option-icon');
    if (selected.has(opt.text) && opt.correct) {
      btn.classList.remove('selected');
      btn.classList.add('correct');
      icon.textContent = '✓';
    } else if (selected.has(opt.text) && !opt.correct) {
      btn.classList.remove('selected');
      btn.classList.add('wrong');
      icon.textContent = '✗';
    } else if (!selected.has(opt.text) && opt.correct) {
      btn.classList.add('revealed');
    }
  });
  document.getElementById('prac-confirm-btn').style.display = 'none';
  const resultEl = document.getElementById('prac-result');
  resultEl.style.display = 'block';
  if (isCorrect) {
    resultEl.textContent = '正确 ✓';
    resultEl.className = 'quiz-result success';
    addWordAtInterval(cq.wordData.word, 1);
    setTimeout(renderMCQuestion, 1200);
  } else {
    resultEl.textContent = '正确答案已显示，已加入复习队列';
    resultEl.className = 'quiz-result failure';
    addWordAtInterval(cq.wordData.word, 0);
    document.getElementById('prac-next-wrap').style.display = 'block';
    document.getElementById('prac-next-btn').addEventListener('click', renderMCQuestion);
  }
}

function updateMCStats() {
  const el = document.getElementById('prac-stats-bar');
  if (el) el.textContent = `本次: ${mcSession.total}题 / ${mcSession.correct}正确`;
}

/* ===== Spell Mode (拼写) ===== */

function startSpellMode(wordPool = null) {
  spellSession.fromFlow = wordPool !== null;
  spellSession.words = shuffleArray(
    (wordPool || SYNONYMS_DATA).filter(w => w.synonyms.length >= 1)
  );
  if (!wordPool) spellSession.words = spellSession.words.slice(0, 20);
  spellSession.current = 0;
  spellSession.results = [];
  spellSession.total = 0;
  spellSession.bothCorrect = 0;
  document.getElementById('practice-header').innerHTML = `
    <div class="quiz-header-row">
      <h2 class="quiz-title">拼写</h2>
      <span class="spell-session-stat" id="spell-session-stat">本次: 0题 / 0全对</span>
    </div>`;
  renderSpellQuestion(0);
}

function updateSpellSessionStat() {
  const el = document.getElementById('spell-session-stat');
  if (el) el.textContent = `本次: ${spellSession.total}题 / ${spellSession.bothCorrect}全对`;
}

function renderSpellQuestion(index) {
  if (index >= spellSession.words.length) { renderSpellComplete(); return; }
  spellSession.current = index;
  const wordData = spellSession.words[index];
  const total = spellSession.words.length;
  const pct = Math.round((index / total) * 100);
  const content = document.getElementById('practice-content');
  content.innerHTML = `
    <div class="spell-progress-wrap">
      <div class="spell-progress-bar"><div class="spell-progress-fill" style="width:${pct}%"></div></div>
      <div class="spell-progress-label">${index + 1} / ${total}</div>
    </div>
    <div class="spell-card">
      <div class="spell-step-label">第1步 · 拼出单词</div>
      <div class="spell-zh-main">${escapeHtml(wordData.zh)}</div>
      <input type="text" class="spell-input" id="spell-input" placeholder="输入英文单词..."
        autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
      <div class="spell-feedback" id="spell-feedback" style="display:none"></div>
      <div class="spell-confirm-row">
        <button class="spell-tts-btn" id="spell-tts-btn">🔊 听发音</button>
        <button class="btn btn--primary spell-confirm-btn" id="spell-confirm-btn">确认</button>
      </div>
      <div id="spell-next-wrap" style="display:none">
        <button class="btn btn--secondary" id="spell-next-btn">下一题 →</button>
      </div>
    </div>`;
  document.getElementById('spell-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('spell-confirm-btn').click();
  });
  document.getElementById('spell-tts-btn').addEventListener('click', () => speakSingle(wordData.word));
  document.getElementById('spell-confirm-btn').addEventListener('click', () => evaluateSpellStep1(wordData));
}

function evaluateSpellStep1(wordData) {
  const inputEl = document.getElementById('spell-input');
  if (!inputEl) return;
  const userInput = inputEl.value.trim().toLowerCase();
  if (!userInput) return;
  const correct = wordData.word.toLowerCase();
  const feedbackEl = document.getElementById('spell-feedback');
  inputEl.disabled = true;
  document.getElementById('spell-confirm-btn').disabled = true;
  document.getElementById('spell-tts-btn').disabled = true;
  feedbackEl.style.display = 'block';
  if (userInput === correct) {
    inputEl.style.borderColor = '#22C55E';
    feedbackEl.innerHTML = `<span style="color:#22C55E;font-size:18px;font-weight:700">✓  ${escapeHtml(wordData.word)}</span>`;
    speakSingle(wordData.word);
    setTimeout(() => renderSpellStep2(wordData), 800);
  } else {
    inputEl.style.borderColor = '#EF4444';
    const userLabelEl = document.createElement('div');
    userLabelEl.style.cssText = 'font-size:12px;color:#7FA8C9;margin-bottom:4px';
    userLabelEl.textContent = `你输入的：${userInput}`;
    feedbackEl.innerHTML = '';
    feedbackEl.appendChild(userLabelEl);
    feedbackEl.appendChild(renderDiff(userInput, correct));
    addWordAtInterval(wordData.word, 0);
    const stats = getPracticeStats('practice_spell') || { total: 0, both_correct: 0 };
    stats.total++;
    setPracticeStats('practice_spell', stats);
    spellSession.total++;
    spellSession.results[spellSession.current] = 'step1_wrong';
    updateSpellSessionStat();
    document.getElementById('spell-next-wrap').style.display = 'block';
    document.getElementById('spell-next-btn').addEventListener('click', () => renderSpellQuestion(spellSession.current + 1));
  }
}

function renderSpellStep2(wordData) {
  const total = spellSession.words.length;
  const index = spellSession.current;
  const pct = Math.round((index / total) * 100);
  const content = document.getElementById('practice-content');
  content.innerHTML = `
    <div class="spell-progress-wrap">
      <div class="spell-progress-bar"><div class="spell-progress-fill" style="width:${pct}%"></div></div>
      <div class="spell-progress-label">${index + 1} / ${total}</div>
    </div>
    <div class="spell-card">
      <div class="spell-step-label">第2步 · 拼出一个同义词</div>
      <div class="spell-word-revealed">${escapeHtml(wordData.word)}</div>
      <div class="spell-zh-sub">${escapeHtml(wordData.zh)}</div>
      <div class="spell-hint">共 ${wordData.synonyms.length} 个同义词，拼出任意一个</div>
      <input type="text" class="spell-input" id="spell-input" placeholder="输入任意一个同义词..."
        autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
      <div class="spell-feedback" id="spell-feedback" style="display:none"></div>
      <div class="spell-confirm-row">
        <button class="spell-tts-btn" id="spell-tts-btn">🔊 听发音</button>
        <button class="btn btn--primary spell-confirm-btn" id="spell-confirm-btn">确认</button>
      </div>
      <div id="spell-next-wrap" style="display:none">
        <button class="btn btn--secondary" id="spell-next-btn">下一题 →</button>
      </div>
    </div>`;
  document.getElementById('spell-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('spell-confirm-btn').click();
  });
  document.getElementById('spell-tts-btn').addEventListener('click', () => speakSingle(wordData.word));
  document.getElementById('spell-confirm-btn').addEventListener('click', () => evaluateSpellStep2(wordData));
}

function evaluateSpellStep2(wordData) {
  const inputEl = document.getElementById('spell-input');
  if (!inputEl) return;
  const userInput = inputEl.value.trim().toLowerCase();
  if (!userInput) return;
  const synonymsLower = wordData.synonyms.map(s => s.toLowerCase());
  const feedbackEl = document.getElementById('spell-feedback');
  inputEl.disabled = true;
  document.getElementById('spell-confirm-btn').disabled = true;
  document.getElementById('spell-tts-btn').disabled = true;
  feedbackEl.style.display = 'block';
  const matchIdx = synonymsLower.indexOf(userInput);
  if (matchIdx !== -1) {
    const typedSynonym = wordData.synonyms[matchIdx];
    inputEl.style.borderColor = '#22C55E';
    feedbackEl.innerHTML = `<span style="color:#22C55E;font-size:18px;font-weight:700">✓  ${escapeHtml(typedSynonym)}</span>`;
    speakSingle(typedSynonym);
    addWordAtInterval(wordData.word, 1);
    const stats = getPracticeStats('practice_spell') || { total: 0, both_correct: 0 };
    stats.total++;
    stats.both_correct++;
    setPracticeStats('practice_spell', stats);
    spellSession.total++;
    spellSession.bothCorrect++;
    spellSession.results[spellSession.current] = 'both_correct';
    updateSpellSessionStat();
    setTimeout(() => {
      const fb = document.getElementById('spell-feedback');
      if (!fb) return;
      const chipsHtml = wordData.synonyms.map(s => {
        const hl = s.toLowerCase() === userInput ? 'border-color:#22C55E' : '';
        return `<span class="spell-chip" style="${hl}">${escapeHtml(s)}</span>`;
      }).join('');
      fb.innerHTML += `<div class="spell-chips" style="margin-top:8px">${chipsHtml}</div>`;
    }, 600);
    setTimeout(() => renderSpellQuestion(spellSession.current + 1), 1200);
  } else {
    let closest = wordData.synonyms[0];
    let minDist = Infinity;
    for (const syn of wordData.synonyms) {
      const dist = levenshtein(userInput, syn.toLowerCase());
      if (dist < minDist || (dist === minDist && syn.length < closest.length)) {
        minDist = dist;
        closest = syn;
      }
    }
    inputEl.style.borderColor = '#EF4444';
    const userLabelEl = document.createElement('div');
    userLabelEl.style.cssText = 'font-size:12px;color:#7FA8C9;margin-bottom:4px';
    userLabelEl.textContent = `你输入的：${userInput}`;
    const diffEl = renderDiff(userInput, closest.toLowerCase());
    const answerLabelEl = document.createElement('div');
    answerLabelEl.style.cssText = 'font-size:12px;color:#7FA8C9;margin-top:8px;margin-bottom:4px';
    answerLabelEl.textContent = '正确答案（任意一个均可）：';
    const chipsEl = document.createElement('div');
    chipsEl.className = 'spell-chips';
    chipsEl.innerHTML = wordData.synonyms.map(s => `<span class="spell-chip">${escapeHtml(s)}</span>`).join('');
    feedbackEl.innerHTML = '';
    feedbackEl.appendChild(userLabelEl);
    feedbackEl.appendChild(diffEl);
    feedbackEl.appendChild(answerLabelEl);
    feedbackEl.appendChild(chipsEl);
    addWordAtInterval(wordData.word, 1);
    const stats = getPracticeStats('practice_spell') || { total: 0, both_correct: 0 };
    stats.total++;
    setPracticeStats('practice_spell', stats);
    spellSession.total++;
    spellSession.results[spellSession.current] = 'step2_wrong';
    updateSpellSessionStat();
    document.getElementById('spell-next-wrap').style.display = 'block';
    document.getElementById('spell-next-btn').addEventListener('click', () => renderSpellQuestion(spellSession.current + 1));
  }
}

function renderSpellComplete() {
  if (spellSession.fromFlow) { renderStudyFlowComplete('拼写'); return; }
  document.getElementById('practice-header').innerHTML = '<h2 class="app-title">拼写练习完成</h2>';
  const content = document.getElementById('practice-content');
  const results = spellSession.results;
  const bothCorrect = results.filter(r => r === 'both_correct').length;
  const step2Wrong = results.filter(r => r === 'step2_wrong').length;
  const step1Wrong = results.filter(r => r === 'step1_wrong').length;
  const total = results.length;
  const accuracy = total > 0 ? Math.round((bothCorrect / total) * 100) : 0;
  content.innerHTML = `
    <div class="spell-complete">
      <div class="spell-complete-icon">✓</div>
      <div class="spell-complete-title">拼写练习完成</div>
      <div class="spell-complete-stats">
        <div class="spell-stat-row" style="color:#22C55E">
          <span>两步全对</span><span>${bothCorrect} 题</span>
        </div>
        <div class="spell-stat-row" style="color:#F59E0B">
          <span>单词拼对/同义词有误</span><span>${step2Wrong} 题</span>
        </div>
        <div class="spell-stat-row" style="color:#EF4444">
          <span>单词拼错</span><span>${step1Wrong} 题</span>
        </div>
      </div>
      <div class="spell-accuracy">正确率 ${accuracy}%</div>
      <button class="btn btn--primary" id="spell-back-btn">返回练习</button>
    </div>`;
  document.getElementById('spell-back-btn').addEventListener('click', renderPracticeLanding);
}

/* ===== Reverse Mode (反向认知) ===== */

function startReverseMode(wordPool = null) {
  reverseSession.wordPool = wordPool;
  reverseSession.recentWords = [];
  reverseSession.total = 0;
  reverseSession.recognised = 0;
  const rightBtnHtml = wordPool
    ? `<button class="quiz-done-btn" id="rev-done-btn">完成 ✓</button>`
    : `<button class="quiz-skip-btn" id="rev-skip-btn">跳过 →</button>`;
  document.getElementById('practice-header').innerHTML = `
    <div class="quiz-header-row">
      <h2 class="quiz-title">反向认知</h2>
      ${rightBtnHtml}
    </div>
    <div class="quiz-stats-bar" id="rev-stats-bar">本次: 0词 / 0认出</div>`;
  if (wordPool) {
    document.getElementById('rev-done-btn').addEventListener('click', () => {
      stopTTS();
      renderStudyFlowComplete('反向认知');
    });
  } else {
    document.getElementById('rev-skip-btn').addEventListener('click', () => { stopTTS(); renderReverseCard(); });
  }
  renderReverseCard();
}

function generateReverseQuestion() {
  const basePool = (reverseSession.wordPool && reverseSession.wordPool.length > 0)
    ? reverseSession.wordPool.filter(w => w.synonyms.length >= 2)
    : SYNONYMS_DATA.filter(w => w.synonyms.length >= 2);
  const effectivePool = basePool.length > 0 ? basePool : SYNONYMS_DATA.filter(w => w.synonyms.length >= 2);
  const recentSet = new Set(reverseSession.recentWords.map(w => w.word));
  let candidates = effectivePool.filter(w => !recentSet.has(w.word));
  if (candidates.length === 0) candidates = effectivePool;
  const wordData = candidates[Math.floor(Math.random() * candidates.length)];
  const synonym = wordData.synonyms[Math.floor(Math.random() * wordData.synonyms.length)];
  return { wordData, synonym };
}

function renderReverseCard() {
  const { wordData, synonym } = generateReverseQuestion();
  reverseSession.recentWords.push(wordData);
  if (reverseSession.recentWords.length > 5) reverseSession.recentWords.shift();
  document.getElementById('practice-content').innerHTML = `
    <div class="rev-card-wrap">
      <div class="rev-card card-enter" id="rev-card">
        <div class="rev-q-label">这个词属于哪个词组？</div>
        <div class="rev-syn-word">${escapeHtml(synonym)}</div>
        <button class="rev-tts-btn" id="rev-tts-btn">🔊 听发音</button>
        <div class="rev-answer-area" id="rev-answer-area" style="display:none"></div>
        <div class="rev-action-area" id="rev-action-area">
          <button class="btn btn--muted" id="rev-show-btn">显示答案</button>
        </div>
      </div>
    </div>`;
  document.getElementById('rev-tts-btn').addEventListener('click', () => speakSingle(synonym));
  document.getElementById('rev-show-btn').addEventListener('click', () => revealReverseAnswer(wordData, synonym));
}

function revealReverseAnswer(wordData, synonym) {
  speakSingle(wordData.word);
  const answerArea = document.getElementById('rev-answer-area');
  const actionArea = document.getElementById('rev-action-area');
  const chipsHtml = wordData.synonyms.map(s =>
    s === synonym
      ? `<span class="rev-chip rev-chip--hl">${escapeHtml(s)}<span class="rev-chip-tag"> ← 这个</span></span>`
      : `<span class="rev-chip">${escapeHtml(s)}</span>`
  ).join('');
  answerArea.innerHTML = `
    <div class="rev-divider"></div>
    <div class="rev-section-label">所属词组：</div>
    <div class="rev-headword">${escapeHtml(wordData.word)}</div>
    <div class="rev-headword-zh">${escapeHtml(wordData.zh)}</div>
    <div class="rev-divider"></div>
    <div class="rev-section-label">该组全部同义词：</div>
    <div class="rev-chips">${chipsHtml}</div>`;
  answerArea.style.display = 'block';
  actionArea.innerHTML = `
    <div class="rev-result-btns">
      <button class="rev-recognised-btn" id="rev-recognised-btn">认出了 ✓</button>
      <button class="rev-missed-btn" id="rev-missed-btn">没认出 ↩</button>
    </div>`;
  document.getElementById('rev-recognised-btn').addEventListener('click', () => {
    addWordAtInterval(wordData.word, 1);
    const stats = getPracticeStats('practice_reverse') || { total: 0, recognised: 0 };
    stats.total++; stats.recognised++;
    setPracticeStats('practice_reverse', stats);
    reverseSession.total++; reverseSession.recognised++;
    updateReverseSessionStat();
    exitAndNextReverseCard();
  });
  document.getElementById('rev-missed-btn').addEventListener('click', () => {
    addWordAtInterval(wordData.word, 0);
    const stats = getPracticeStats('practice_reverse') || { total: 0, recognised: 0 };
    stats.total++;
    setPracticeStats('practice_reverse', stats);
    reverseSession.total++;
    updateReverseSessionStat();
    exitAndNextReverseCard();
  });
}

function exitAndNextReverseCard() {
  stopTTS();
  const card = document.getElementById('rev-card');
  if (!card) { renderReverseCard(); return; }
  card.classList.remove('card-enter');
  card.classList.add('card-exit');
  setTimeout(renderReverseCard, 200);
}

function updateReverseSessionStat() {
  const el = document.getElementById('rev-stats-bar');
  if (el) el.textContent = `本次: ${reverseSession.total}词 / ${reverseSession.recognised}认出`;
}

/* ===== Study Flow (学习流程) ===== */

function renderFlowSelectCount() {
  stopTTS();
  const content = document.getElementById('practice-content');
  content.style.overflowY = 'hidden';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  document.getElementById('practice-header').innerHTML = `
    <div class="quiz-header-row">
      <h2 class="quiz-title">选词数</h2>
      <button class="quiz-skip-btn" id="flow-back-btn">返回</button>
    </div>`;
  document.getElementById('flow-back-btn').addEventListener('click', renderPracticeLanding);
  const counts = [10, 20, 30, 50];
  content.innerHTML = `
    <div class="flow-screen">
      <div class="flow-count-label">本次学习词数</div>
      <div class="segmented-control" id="flow-count-ctrl">
        ${counts.map(c => `<button class="segment-btn${c === studyFlowWordCount ? ' active' : ''}" data-count="${c}">${c}</button>`).join('')}
      </div>
      <div class="flow-count-hint">优先选未掌握的词，其次补充未见过的词</div>
    </div>
    <div class="flow-fixed-btn">
      <button class="btn flow-cta-btn" id="flow-start-btn">开始过词 →</button>
    </div>`;
  document.querySelectorAll('#flow-count-ctrl .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#flow-count-ctrl .segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      studyFlowWordCount = parseInt(btn.dataset.count);
    });
  });
  document.getElementById('flow-start-btn').addEventListener('click', () => {
    studyFlowWordPool = buildStudyFlowPool(studyFlowWordCount);
    studyFlowPendingTTS = true;
    renderFlowExposure(0);
  });
}

function buildStudyFlowPool(n) {
  const srData = getSRData();
  const p1 = [], p2 = [], p3 = [];
  SYNONYMS_DATA.forEach(w => {
    if (srData[w.word] && srData[w.word].intervalIndex === 0) {
      p1.push(w);
    } else if (!srData[w.word]) {
      p2.push(w);
    } else {
      p3.push(w);
    }
  });
  return [...shuffleArray(p1), ...shuffleArray(p2), ...shuffleArray(p3)].slice(0, n);
}

function renderFlowExposure(index) {
  const words = studyFlowWordPool;
  const n = words.length;
  const wordData = words[index];
  const pct = Math.round(((index + 1) / n) * 100);
  const isLast = index === n - 1;
  const content = document.getElementById('practice-content');
  content.style.overflowY = 'hidden';
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  const chipsHtml = wordData.synonyms.length > 0
    ? wordData.synonyms.map(s => `<span class="flow-chip">${escapeHtml(s)}</span>`).join('')
    : `<span style="color:#3D5A78;font-size:13px">暂无同义词</span>`;
  document.getElementById('practice-header').innerHTML = `
    <div class="quiz-header-row">
      <h2 class="quiz-title">过词</h2>
      <button class="quiz-skip-btn" id="flow-exp-back">返回</button>
    </div>`;
  document.getElementById('flow-exp-back').addEventListener('click', () => {
    if (confirm('退出后进度不保存，确认退出？')) {
      studyFlowWordPool = null;
      stopTTS();
      renderPracticeLanding();
    }
  });
  content.innerHTML = `
    <div class="flow-exp-wrap">
      <div class="flow-exp-progress">
        <div class="flow-exp-bar"><div class="flow-exp-fill" style="width:${pct}%"></div></div>
        <div class="flow-exp-label">${index + 1} / ${n}</div>
      </div>
      <div class="flow-exp-card" id="flow-exp-card">
        <div class="flow-exp-word">${escapeHtml(wordData.word)}</div>
        <div class="flow-exp-zh">${escapeHtml(wordData.zh)}</div>
        <div class="flow-exp-divider"></div>
        <div class="flow-exp-syn-label">同义替换词</div>
        <div class="flow-chips">${chipsHtml}</div>
        <button class="flow-replay-btn" id="flow-replay-btn">🔊</button>
      </div>
    </div>
    <div class="flow-fixed-btn">
      ${isLast
        ? `<button class="btn flow-cta-btn" id="flow-nav-btn">开始练习 →</button>`
        : `<button class="btn flow-next-btn" id="flow-nav-btn">下一个 →</button>`}
    </div>`;
  document.getElementById('flow-replay-btn').addEventListener('click', () => speakSingle(wordData.word));
  if (studyFlowPendingTTS) {
    speakSingle(wordData.word);
    studyFlowPendingTTS = false;
  }
  if (isLast) {
    document.getElementById('flow-nav-btn').addEventListener('click', () => {
      stopTTS();
      renderFlowChooseMode();
    });
  } else {
    document.getElementById('flow-nav-btn').addEventListener('click', () => {
      speakSingle(words[index + 1].word);
      renderFlowExposure(index + 1);
    });
  }
}

function renderFlowChooseMode() {
  stopTTS();
  const content = document.getElementById('practice-content');
  content.style.overflowY = '';
  content.style.display = '';
  content.style.flexDirection = '';
  document.getElementById('practice-header').innerHTML = `
    <div class="quiz-header-row">
      <h2 class="quiz-title">选择练习方式</h2>
    </div>`;
  const n = studyFlowWordPool.length;
  content.innerHTML = `
    <div class="flow-choose-wrap">
      <div class="flow-choose-subtitle">已过 ${n} 个词，选一种方式练习这批词</div>
      <div class="flow-choose-btns">
        <button class="flow-mode-btn" id="flow-mc-btn">✦ 选择题</button>
        <button class="flow-mode-btn" id="flow-spell-btn">✎ 拼写</button>
        <button class="flow-mode-btn" id="flow-rev-btn">⇄ 反向认知</button>
      </div>
      <div class="flow-choose-hint">练习完成后可返回选择其他方式，词池不变</div>
    </div>`;
  document.getElementById('flow-mc-btn').addEventListener('click', () => startMCMode(studyFlowWordPool));
  document.getElementById('flow-spell-btn').addEventListener('click', () => startSpellMode(studyFlowWordPool));
  document.getElementById('flow-rev-btn').addEventListener('click', () => startReverseMode(studyFlowWordPool));
}

function renderStudyFlowComplete(modeName) {
  stopTTS();
  const content = document.getElementById('practice-content');
  content.style.overflowY = '';
  content.style.display = '';
  content.style.flexDirection = '';
  document.getElementById('practice-header').innerHTML = '<h2 class="app-title">学习完成</h2>';
  const n = studyFlowWordPool ? studyFlowWordPool.length : studyFlowWordCount;
  content.innerHTML = `
    <div class="flow-complete-wrap">
      <div class="flow-complete-icon">✓</div>
      <div class="flow-complete-title">本轮学习完成</div>
      <div class="flow-complete-stat">过词 ${n} 个 · ${escapeHtml(modeName)} 练习完成</div>
      <div class="flow-complete-btns">
        <button class="flow-complete-btn flow-complete-btn--accent" id="flow-again-btn">再练这批词</button>
        <button class="flow-complete-btn" id="flow-newbatch-btn">换一批词</button>
        <button class="flow-complete-btn" id="flow-return-btn">返回练习</button>
      </div>
    </div>`;
  document.getElementById('flow-again-btn').addEventListener('click', renderFlowChooseMode);
  document.getElementById('flow-newbatch-btn').addEventListener('click', () => {
    studyFlowWordPool = null;
    renderFlowSelectCount();
  });
  document.getElementById('flow-return-btn').addEventListener('click', () => {
    studyFlowWordPool = null;
    renderPracticeLanding();
  });
}

/* ===== Flash (速记) ===== */
function speakSingle(word) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(word);
  utt.lang = 'en-US';
  utt.rate = 0.85;
  const voice = getVoice();
  if (voice) utt.voice = voice;
  window.speechSynthesis.speak(utt);
}

function addWordAtInterval(word, intervalIndex) {
  const data = getSRData();
  const today = getTodayStr();
  if (data[word]) {
    data[word].intervalIndex = intervalIndex;
    data[word].nextReview = addDaysToStr(today, INTERVALS[intervalIndex]);
  } else {
    data[word] = { word, intervalIndex, nextReview: addDaysToStr(today, INTERVALS[intervalIndex]), addedDate: today, reviewCount: 0 };
  }
  saveSRData(data);
  if (!flashSession.addedToQueue.includes(word)) flashSession.addedToQueue.push(word);
}

function pickFlashWords(count) {
  const srData = getSRData();
  const inQueue = new Set(Object.keys(srData));
  const brandNew = shuffleArray(SYNONYMS_DATA.filter(w => !inQueue.has(w.word)));
  const struggling = shuffleArray(SYNONYMS_DATA.filter(w => inQueue.has(w.word) && srData[w.word].intervalIndex === 0));
  const result = [];
  const used = new Set();
  for (const w of [...brandNew, ...struggling]) {
    if (result.length >= count) break;
    result.push(w); used.add(w.word);
  }
  if (result.length < count) {
    for (const w of shuffleArray(SYNONYMS_DATA.filter(w => !used.has(w.word)))) {
      if (result.length >= count) break;
      result.push(w);
    }
  }
  return result;
}

function getDistractor(wordData) {
  const excluded = new Set([...wordData.synonyms, wordData.word]);
  for (const w of shuffleArray(SYNONYMS_DATA.filter(w => w.word !== wordData.word && w.synonyms.length > 0))) {
    const valid = w.synonyms.filter(s => !excluded.has(s));
    if (valid.length > 0) return valid[Math.floor(Math.random() * valid.length)];
  }
  const fallback = SYNONYMS_DATA.find(w => w.word !== wordData.word && w.synonyms.length > 0);
  return fallback ? fallback.synonyms[0] : '—';
}

function initFlashScreen() {
  renderFlashLanding();
}

function renderFlashLanding() {
  document.getElementById('flash-header').innerHTML = '<h2 class="app-title">速记</h2>';
  const content = document.getElementById('flash-content');
  content.style.overflowY = 'auto';
  const counts = [10, 20, 30, 50];
  content.innerHTML = `
    <div class="flash-landing">
      <div>
        <div class="flash-section-label">本次学习词数</div>
        <div class="segmented-control" id="flash-count-ctrl">
          ${counts.map(c => `<button class="segment-btn${c === flashSession.count ? ' active' : ''}" data-count="${c}">${c}</button>`).join('')}
        </div>
      </div>
      <button class="btn btn--primary btn--large" id="flash-start-btn">开始速记</button>
      <div class="flash-tip">第一轮：认识所有词 · 第二轮：巩固没把握的词</div>
    </div>`;
  document.querySelectorAll('#flash-count-ctrl .segment-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#flash-count-ctrl .segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      flashSession.count = parseInt(btn.dataset.count);
    });
  });
  document.getElementById('flash-start-btn').addEventListener('click', () => {
    flashSession.words = pickFlashWords(flashSession.count);
    flashSession.round1Results = {};
    flashSession.round2Words = [];
    flashSession.round2Results = {};
    flashSession.addedToQueue = [];
    content.style.overflowY = 'hidden';
    renderRound1Card(0);
  });
}

function renderRound1Card(index) {
  const words = flashSession.words;
  const total = words.length;
  if (index >= total) { finishRound1(); return; }
  const wordData = words[index];
  const pct = Math.round((index / total) * 100);
  const chipsHtml = wordData.synonyms.length > 0
    ? wordData.synonyms.map(s => `<span class="flash-chip">${escapeHtml(s)}</span>`).join('')
    : '<span class="no-synonyms">暂无同义词</span>';
  document.getElementById('flash-content').innerHTML = `
    <div class="flash-round-view">
      <div class="flash-progress-wrap">
        <div class="flash-progress-bar"><div class="flash-progress-fill" style="width:${pct}%"></div></div>
        <div class="flash-round-label">第一轮 &nbsp;${index + 1} / ${total}</div>
      </div>
      <div class="flash-card-wrap">
        <div class="flash-card card-enter" id="flash-card-el">
          <div class="flash-card-word">${escapeHtml(wordData.word)}</div>
          <div class="flash-card-zh">${escapeHtml(wordData.zh)}</div>
          <div class="flash-card-divider"></div>
          <div class="flash-synonyms-label">同义替换词</div>
          <div class="flash-chips">${chipsHtml}</div>
          <button class="flash-replay-btn" id="flash-replay-btn">🔊</button>
        </div>
      </div>
      <div class="flash-actions">
        <button class="btn btn--success btn--large" id="flash-known-btn">认识 ✓</button>
        <button class="btn btn--muted btn--large" id="flash-unsure-btn">没把握 →</button>
      </div>
    </div>`;
  speakSingle(wordData.word);
  document.getElementById('flash-replay-btn').addEventListener('click', () => speakSingle(wordData.word));
  document.getElementById('flash-known-btn').addEventListener('click', () => {
    flashSession.round1Results[wordData.word] = 'known';
    if (index + 1 < words.length) speakSingle(words[index + 1].word);
    advanceCard(() => renderRound1Card(index + 1));
  });
  document.getElementById('flash-unsure-btn').addEventListener('click', () => {
    flashSession.round1Results[wordData.word] = 'unsure';
    if (index + 1 < words.length) speakSingle(words[index + 1].word);
    advanceCard(() => renderRound1Card(index + 1));
  });
}

function advanceCard(next) {
  const card = document.getElementById('flash-card-el');
  if (!card) { next(); return; }
  card.classList.remove('card-enter');
  card.classList.add('card-exit');
  setTimeout(next, 200);
}

function finishRound1() {
  const knownWords = flashSession.words.filter(w => flashSession.round1Results[w.word] === 'known');
  const unsureWords = flashSession.words.filter(w => flashSession.round1Results[w.word] !== 'known');
  knownWords.forEach(w => addWordAtInterval(w.word, 1));
  flashSession.round2Words = unsureWords;
  renderRound1Summary(knownWords.length, unsureWords.length);
}

function renderRound1Summary(knownCount, unsureCount) {
  const content = document.getElementById('flash-content');
  content.style.overflowY = 'auto';
  if (unsureCount === 0) {
    content.innerHTML = `
      <div class="flash-summary">
        <div style="font-size:40px">🎉</div>
        <div class="flash-summary-title">第一轮完成 ✓</div>
        <div class="flash-summary-nums">认识 ${knownCount} 词 · 没把握 0 词</div>
        <div class="flash-summary-msg">全部认识！已将 ${knownCount} 词加入复习队列</div>
        <div style="width:100%"><button class="btn btn--primary btn--large" id="flash-done-btn">完成</button></div>
      </div>`;
    document.getElementById('flash-done-btn').addEventListener('click', renderFlashComplete);
  } else {
    content.innerHTML = `
      <div class="flash-summary">
        <div style="font-size:40px">📖</div>
        <div class="flash-summary-title">第一轮完成 ✓</div>
        <div class="flash-summary-nums">认识 ${knownCount} 词 · 没把握 ${unsureCount} 词</div>
        <div class="flash-summary-msg">认识的词已加入复习队列，继续第二轮巩固</div>
        <div style="width:100%"><button class="btn btn--primary btn--large" id="flash-r2-btn">开始第二轮，巩固 ${unsureCount} 个词</button></div>
      </div>`;
    document.getElementById('flash-r2-btn').addEventListener('click', () => {
      document.getElementById('flash-content').style.overflowY = 'hidden';
      renderRound2Card(0);
    });
  }
}

function renderRound2Card(index) {
  const words = flashSession.round2Words;
  const total = words.length;
  if (index >= total) { renderFlashComplete(); return; }
  const wordData = words[index];
  const pct = Math.round((index / total) * 100);
  const correctSyn = wordData.synonyms.length > 0
    ? wordData.synonyms[Math.floor(Math.random() * wordData.synonyms.length)]
    : wordData.word;
  const distractor = getDistractor(wordData);
  const options = shuffleArray([{ text: correctSyn, correct: true }, { text: distractor, correct: false }]);
  document.getElementById('flash-content').innerHTML = `
    <div class="flash-round-view">
      <div class="flash-progress-wrap">
        <div class="flash-progress-bar"><div class="flash-progress-fill" style="width:${pct}%"></div></div>
        <div class="flash-round-label">第二轮 &nbsp;${index + 1} / ${total}</div>
      </div>
      <div class="flash-card-wrap">
        <div class="flash-card card-enter" id="flash-card-el">
          <div class="flash-card-word" style="font-size:24px">${escapeHtml(wordData.word)}</div>
          <div class="flash-card-zh" style="font-size:14px">${escapeHtml(wordData.zh)}</div>
          <div class="flash-card-divider"></div>
          <div class="flash-synonyms-label" style="margin-bottom:12px">选出一个正确的同义词</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${options.map((o, i) => `<button class="flash-option-btn" data-idx="${i}" data-correct="${o.correct}">${escapeHtml(o.text)}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="flash-actions" id="flash-r2-actions"></div>
    </div>`;
  document.querySelectorAll('.flash-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.flash-option-btn').forEach(b => b.disabled = true);
      if (btn.dataset.correct === 'true') {
        btn.classList.add('correct');
        addWordAtInterval(wordData.word, 1);
        flashSession.round2Results[wordData.word] = 'correct';
        setTimeout(() => renderRound2Card(index + 1), 800);
      } else {
        btn.classList.add('wrong');
        document.querySelectorAll('.flash-option-btn').forEach(b => {
          if (b.dataset.correct === 'true') b.classList.add('correct');
        });
        addWordAtInterval(wordData.word, 0);
        flashSession.round2Results[wordData.word] = 'wrong';
        document.getElementById('flash-r2-actions').innerHTML =
          '<button class="btn btn--secondary btn--large" id="flash-next-btn">下一题</button>';
        document.getElementById('flash-next-btn').addEventListener('click', () => renderRound2Card(index + 1));
      }
    });
  });
}

function renderFlashComplete() {
  const content = document.getElementById('flash-content');
  content.style.overflowY = 'auto';
  const totalWords = flashSession.words.length;
  const addedCount = flashSession.addedToQueue.length;
  content.innerHTML = `
    <div class="flash-complete">
      <div class="flash-complete-icon">✓</div>
      <div class="flash-complete-title">速记完成！</div>
      <div class="flash-complete-stats">本次学习 ${totalWords} 词<br>已加入复习队列 ${addedCount} 词</div>
      <div style="width:100%;display:flex;flex-direction:column;gap:10px">
        <button class="btn btn--secondary btn--large" id="flash-again-btn">再来一轮</button>
        <button class="btn btn--primary btn--large" id="flash-go-review-btn">去复习</button>
      </div>
    </div>`;
  document.getElementById('flash-again-btn').addEventListener('click', renderFlashLanding);
  document.getElementById('flash-go-review-btn').addEventListener('click', () => showScreen('review'));
}

/* ===== Init ===== */
function init() {
  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Voices
  if ('speechSynthesis' in window) {
    window.speechSynthesis.addEventListener('voiceschanged', initVoices);
    initVoices();
  }

  // Pre-build alpha groups and word lookup map
  buildAlphaGroups();
  getWordMap();

  // Search
  initSearchScreen();

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  // Back button
  document.getElementById('back-btn').addEventListener('click', goBack);
}

document.addEventListener('DOMContentLoaded', init);
