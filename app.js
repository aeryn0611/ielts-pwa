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

let quizSession = { total: 0, correct: 0 };
let currentQuestion = null;
let quizSkipWired = false;

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
  else if (screen === 'test') initTestScreen();
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

/* ===== Test (测试) ===== */
function initTestScreen() {
  if (!quizSkipWired) {
    document.getElementById('quiz-skip-btn').addEventListener('click', renderQuestion);
    quizSkipWired = true;
  }
  renderQuestion();
}

function generateQuestion() {
  const eligible = SYNONYMS_DATA.filter(w => w.synonyms.length >= 1);
  const wordData = eligible[Math.floor(Math.random() * eligible.length)];
  const maxCorrect = Math.min(2, wordData.synonyms.length);
  const numCorrect = Math.min(Math.random() < 0.7 ? 1 : 2, maxCorrect);
  const correctSynonyms = shuffleArray([...wordData.synonyms]).slice(0, numCorrect);
  const correctSet = new Set(correctSynonyms);
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
    ...correctSynonyms.map(s => ({ text: s, correct: true })),
    ...distractors.map(s => ({ text: s, correct: false })),
  ]);
  return { wordData, correctSet, allOptions, numCorrect };
}

function renderQuestion() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  currentQuestion = generateQuestion();
  currentQuestion.selected = new Set();
  currentQuestion.confirmed = false;
  const hint = currentQuestion.numCorrect > 1 ? '选出所有正确的同义词' : '选出正确的同义词';
  document.getElementById('test-content').innerHTML = `
    <div class="quiz-card">
      <div class="quiz-word">${escapeHtml(currentQuestion.wordData.word)}</div>
      <div class="quiz-zh">${escapeHtml(currentQuestion.wordData.zh)}</div>
      <div class="quiz-hint">${hint}</div>
      <div class="quiz-options">
        ${currentQuestion.allOptions.map((o, i) => `
          <button class="quiz-option" data-idx="${i}" data-correct="${o.correct}">
            <span>${escapeHtml(o.text)}</span>
            <span class="quiz-option-icon"></span>
          </button>`).join('')}
      </div>
    </div>
    <div class="quiz-footer">
      <div class="quiz-result" id="quiz-result" style="display:none"></div>
      <button class="btn btn--primary btn--large" id="quiz-confirm-btn" style="display:none">确认</button>
      <div id="quiz-next-wrap" style="display:none">
        <button class="btn btn--secondary btn--large" id="quiz-next-btn">下一题</button>
      </div>
    </div>`;
  updateQuizStats();
  document.querySelectorAll('.quiz-option').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentQuestion.confirmed) return;
      const optText = currentQuestion.allOptions[parseInt(btn.dataset.idx)].text;
      if (currentQuestion.selected.has(optText)) {
        currentQuestion.selected.delete(optText);
        btn.classList.remove('selected');
      } else {
        currentQuestion.selected.add(optText);
        btn.classList.add('selected');
      }
      document.getElementById('quiz-confirm-btn').style.display =
        currentQuestion.selected.size > 0 ? 'flex' : 'none';
    });
  });
  document.getElementById('quiz-confirm-btn').addEventListener('click', confirmAnswer);
}

function confirmAnswer() {
  if (!currentQuestion || currentQuestion.confirmed) return;
  currentQuestion.confirmed = true;
  const { selected, correctSet, allOptions } = currentQuestion;
  const isCorrect = selected.size === correctSet.size && [...selected].every(s => correctSet.has(s));
  quizSession.total++;
  if (isCorrect) quizSession.correct++;
  updateQuizStats();
  document.querySelectorAll('.quiz-option').forEach(btn => {
    btn.disabled = true;
    const opt = allOptions[parseInt(btn.dataset.idx)];
    const icon = btn.querySelector('.quiz-option-icon');
    if (opt.correct) {
      btn.classList.remove('selected');
      btn.classList.add('correct');
      icon.textContent = '✓';
    } else if (selected.has(opt.text)) {
      btn.classList.remove('selected');
      btn.classList.add('wrong');
      icon.textContent = '✗';
    }
  });
  document.getElementById('quiz-confirm-btn').style.display = 'none';
  const resultEl = document.getElementById('quiz-result');
  resultEl.style.display = 'block';
  if (isCorrect) {
    resultEl.textContent = '正确 ✓';
    resultEl.className = 'quiz-result success';
    setTimeout(renderQuestion, 1200);
  } else {
    resultEl.textContent = '正确答案已显示，已加入复习队列';
    resultEl.className = 'quiz-result failure';
    addWordAtInterval(currentQuestion.wordData.word, 0);
    document.getElementById('quiz-next-wrap').style.display = 'block';
    document.getElementById('quiz-next-btn').addEventListener('click', renderQuestion);
  }
}

function updateQuizStats() {
  const el = document.getElementById('quiz-stats');
  if (el) el.textContent = `本次: ${quizSession.total}题 / ${quizSession.correct}正确`;
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
