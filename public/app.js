// ================= Nodig frontend =================
// Same UI and flows as the original prototype, but every action now talks to
// the shared backend API instead of localStorage.

// ----- App state -----
let currentUser = null;          // { kind:'org'|'donor', id, name, ... } | null
let authRole = 'org';            // which tab of the auth screen is active
let editingNeedId = null;        // need being edited in the post/edit modal
let claimingNeedId = null;       // need awaiting claim confirmation
let currentDetailNeedId = null;  // need shown on the detail view
let browseNeeds = [];            // cached list for client-side filtering
let chatPollTimer = null;        // interval id for live chat polling
let chatSignature = '';          // last rendered thread fingerprint

// ----- API helper -----
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'Something went wrong.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function initialsFor(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function badgeFor(need) {
  const cls = need.claimed ? 'claimed' : (need.urgency === 'Critical' ? 'critical' : need.urgency === 'High' ? 'high' : 'ok');
  const text = need.claimed ? 'Claimed' : need.urgency;
  return { cls, text };
}

// ================= Nav / top bar =================
function goHome() { showView('browse'); }

function renderTopActions() {
  const el = document.getElementById('topActions');
  if (currentUser && currentUser.kind === 'org') {
    el.innerHTML = `<div class="user-chip" onclick="showView('dashboard')"><span class="dot">${escapeHtml(currentUser.initials)}</span>${escapeHtml(currentUser.name)}</div><button class="btn btn-sm" onclick="signOut()">Sign out</button>`;
  } else if (currentUser && currentUser.kind === 'donor') {
    el.innerHTML = `<div class="user-chip" onclick="showView('donor-dashboard')"><span class="dot">${escapeHtml(currentUser.initials)}</span>${escapeHtml(currentUser.name)}</div><button class="btn btn-sm" onclick="signOut()">Sign out</button>`;
  } else {
    el.innerHTML = `<button class="btn btn-sm" onclick="setAuthRole('donor'); showView('auth')">Donor login</button><button class="btn btn-primary btn-sm" onclick="setAuthRole('org'); showView('auth')">Organization login</button>`;
  }
}

function showView(name) {
  // Leaving the detail view stops the live chat poll.
  if (name !== 'detail') stopChatPoll();
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'donor-dashboard') renderDonorDashboard();
  if (name === 'browse') renderBrowse();
  if (name === 'detail') renderDetail();
  renderTopActions();
}

// ================= Browse (public) =================
async function populateCityFilter() {
  const sel = document.getElementById('cityFilter');
  const current = sel.value;
  try {
    const { cities } = await api('/api/cities');
    sel.innerHTML = '<option value="all">All cities</option>';
    cities.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      sel.appendChild(opt);
    });
    sel.value = [...sel.options].some(o => o.value === current) ? current : 'all';
  } catch { /* leave existing options */ }
}

async function renderBrowse() {
  const grid = document.getElementById('needsGrid');
  try {
    const { needs } = await api('/api/needs');
    browseNeeds = needs;
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>Couldn't load needs</h3><p>${escapeHtml(e.message)}</p></div>`;
    return;
  }
  applyBrowseFilters();
}

function applyBrowseFilters() {
  const city = document.getElementById('cityFilter').value;
  const cat = document.getElementById('catFilter').value;
  const urgency = document.getElementById('urgencyFilter').value;
  const grid = document.getElementById('needsGrid');
  grid.innerHTML = '';

  const filtered = browseNeeds.filter(n =>
    (city === 'all' || n.org.city === city) &&
    (cat === 'all' || n.type === cat) &&
    (urgency === 'all' || n.urgency === urgency)
  );

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><h3>No needs match those filters</h3><p>Try widening your search.</p></div>';
    return;
  }

  filtered.forEach(n => {
    const { cls, text } = badgeFor(n);
    const icon = n.type === 'item' ? '📦' : '🤝';
    const card = document.createElement('div');
    card.className = 'need-card';
    card.onclick = () => openDetail(n.id);
    card.innerHTML = `
      <div class="need-top">
        <div class="org-tag">${icon} ${escapeHtml(n.org.name)}</div>
        <span class="badge ${cls}">${text}</span>
      </div>
      <div class="need-title">${escapeHtml(n.title)}</div>
      <div class="need-desc">${escapeHtml(n.description)}</div>
      <div class="need-foot">
        <span>📍 ${escapeHtml(n.org.city)}</span>
        <span style="color:var(--moss); font-weight:600;">View details &rarr;</span>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ================= Need detail + chat =================
function openDetail(needId) {
  currentDetailNeedId = needId;
  showView('detail');
}

async function renderDetail() {
  let need;
  try {
    const data = await api('/api/needs/' + currentDetailNeedId);
    need = data.need;
  } catch {
    showView('browse');
    return;
  }

  const { cls, text } = badgeFor(need);
  document.getElementById('detailTitle').textContent = need.title;
  document.getElementById('detailOrg').textContent = need.org.name;
  document.getElementById('detailBadge').className = 'badge ' + cls;
  document.getElementById('detailBadge').textContent = text;
  document.getElementById('detailDesc').textContent = need.description;
  document.getElementById('detailCity').textContent = '📍 ' + need.org.city;
  document.getElementById('detailType').textContent = need.type === 'item' ? '📦 Item needed' : '🤝 Volunteering';

  const actionsEl = document.getElementById('detailActions');
  if (currentUser && currentUser.kind === 'org' && currentUser.id === need.org.id) {
    actionsEl.innerHTML = `<button class="btn btn-sm" onclick="editNeed(${need.id}); showView('dashboard')">Edit this need</button>`;
  } else if (need.claimed) {
    actionsEl.innerHTML = need.claimedByMe
      ? `<button class="btn btn-sm btn-danger" onclick="releaseClaimFromDetail(${need.id})">Release your claim</button>`
      : `<span style="font-size:13.5px; color:var(--ink-soft);">Already claimed by another donor.</span>`;
  } else {
    actionsEl.innerHTML = `<button class="btn btn-primary" onclick="openClaimModal(${need.id})">${need.type === 'item' ? 'Claim this' : 'I can help'}</button>`;
  }

  renderChatInput(need);
  chatSignature = '';
  await loadMessages(need.id, { scroll: true });
  startChatPoll();
}

function renderChatInput(need) {
  const inputArea = document.getElementById('chatInputArea');
  if (currentUser && currentUser.kind === 'org' && currentUser.id === need.org.id) {
    inputArea.innerHTML = `<div class="chat-input-row"><input type="text" id="chatInput" placeholder="Reply as ${escapeHtml(currentUser.name)}"><button class="btn btn-primary" onclick="sendMessage('org')">Send</button></div>`;
  } else if (currentUser && currentUser.kind === 'donor') {
    inputArea.innerHTML = `<div class="chat-input-row"><input type="text" id="chatInput" placeholder="Ask a question..."><button class="btn btn-primary" onclick="sendMessage('donor')">Send</button></div>`;
  } else {
    inputArea.innerHTML = `<div class="chat-locked">Sign in as a donor to ask a question &mdash; <a onclick="setAuthRole('donor'); setAuthMode('signin'); showView('auth')">sign in</a></div>`;
  }
  const input = document.getElementById('chatInput');
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.querySelector('.chat-input-row .btn-primary').click();
  });
}

async function loadMessages(needId, { scroll = false } = {}) {
  let list;
  try {
    const data = await api('/api/needs/' + needId + '/messages');
    list = data.messages;
  } catch { return; }
  if (needId !== currentDetailNeedId) return; // view changed while fetching

  // Only re-render the thread when it actually changed (keeps scroll stable).
  const signature = list.map(m => m.id).join(',') + ':' + list.length;
  if (signature === chatSignature && !scroll) return;
  const changed = signature !== chatSignature;
  chatSignature = signature;

  const thread = document.getElementById('chatThread');
  thread.innerHTML = '';
  if (list.length === 0) {
    thread.innerHTML = '<div class="chat-empty">No messages yet. Ask a question to get started.</div>';
    return;
  }
  list.forEach(m => {
    const div = document.createElement('div');
    div.className = 'chat-msg from-' + m.from;
    div.innerHTML = `${escapeHtml(m.text)}<div class="meta">${escapeHtml(m.senderName)}</div>`;
    thread.appendChild(div);
  });
  if (scroll || changed) {
    setTimeout(() => { thread.scrollTop = thread.scrollHeight; }, 0);
  }
}

function startChatPoll() {
  stopChatPoll();
  chatPollTimer = setInterval(() => {
    if (currentDetailNeedId != null) loadMessages(currentDetailNeedId, { scroll: false });
  }, 4000);
}
function stopChatPoll() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
}

async function sendMessage(fromRole) {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  try {
    await api('/api/needs/' + currentDetailNeedId + '/messages', { method: 'POST', body: { text } });
    input.value = '';
    chatSignature = '';
    await loadMessages(currentDetailNeedId, { scroll: true });
  } catch (e) {
    toast(e.message);
  }
}

// ================= Auth =================
function setAuthRole(role) {
  authRole = role;
  document.getElementById('roleOrgBtn').classList.toggle('active', role === 'org');
  document.getElementById('roleDonorBtn').classList.toggle('active', role === 'donor');
  document.getElementById('authTitle').textContent = role === 'org' ? 'Organization sign in' : 'Donor sign in';
  document.getElementById('authSub').textContent = role === 'org' ? 'Manage the needs you\'ve posted.' : 'Sign in to claim and track items.';
  document.getElementById('signupTitle').textContent = role === 'org' ? 'Create an organization account' : 'Create a donor account';
  document.getElementById('signupSub').textContent = role === 'org' ? 'Post needs so donors nearby can help.' : 'Claim items and keep track of what you\'ve pledged.';
  document.getElementById('suNameLabel').textContent = role === 'org' ? 'Organization name' : 'Your name';
  document.getElementById('suName').placeholder = role === 'org' ? 'e.g. Foyer Saint-Jean' : 'e.g. Alex Peeters';
  document.getElementById('suCityField').style.display = role === 'org' ? 'block' : 'none';
  document.getElementById('authError').style.display = 'none';
  document.getElementById('signupError').style.display = 'none';
}

function setAuthMode(mode) {
  document.getElementById('authModeSignin').style.display = mode === 'signin' ? 'block' : 'none';
  document.getElementById('authModeSignup').style.display = mode === 'signup' ? 'block' : 'none';
}

async function handleSignin() {
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  const pw = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { role: authRole, email, password: pw } });
    currentUser = user;
    errEl.style.display = 'none';
    document.getElementById('authPassword').value = '';
    if (user.kind === 'org') {
      toast(`Welcome back, ${user.name}`);
      showView('dashboard');
    } else {
      toast(`Welcome back, ${user.name}`);
      showView('donor-dashboard');
    }
    renderTopActions();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

async function handleSignup() {
  const name = document.getElementById('suName').value.trim();
  const email = document.getElementById('suEmail').value.trim();
  const pw = document.getElementById('suPassword').value;
  const errEl = document.getElementById('signupError');
  const body = { role: authRole, name, email, password: pw };
  if (authRole === 'org') body.city = document.getElementById('suCity').value;

  if (!name || !email || !pw) {
    errEl.textContent = 'Fill in every field before continuing.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const { user } = await api('/api/auth/signup', { method: 'POST', body });
    currentUser = user;
    errEl.style.display = 'none';
    if (user.kind === 'org') {
      toast(`Account created — pending approval`);
      await populateCityFilter();
      showView('dashboard');
    } else {
      toast(`Welcome, ${user.name}`);
      showView('donor-dashboard');
    }
    renderTopActions();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

async function signOut() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  currentUser = null;
  showView('browse');
}

// ================= Claim flow =================
function openClaimModal(needId) {
  if (!currentUser || currentUser.kind !== 'donor') {
    toast('Sign in as a donor to claim this');
    setAuthRole('donor'); setAuthMode('signin');
    showView('auth');
    return;
  }
  claimingNeedId = needId;
  const n = browseNeeds.find(x => x.id === needId);
  document.getElementById('claimNeedTitle').textContent = n ? n.title : '';
  document.getElementById('claimModalOverlay').classList.add('open');
}
function closeClaimModal() {
  document.getElementById('claimModalOverlay').classList.remove('open');
  claimingNeedId = null;
}
async function confirmClaim() {
  const id = claimingNeedId;
  try {
    await api('/api/needs/' + id + '/claim', { method: 'POST' });
    closeClaimModal();
    toast('Claimed — thank you');
    if (document.getElementById('view-detail').classList.contains('active')) {
      await renderDetail();
    } else {
      await renderBrowse();
    }
  } catch (e) {
    closeClaimModal();
    toast(e.message);
    if (document.getElementById('view-detail').classList.contains('active')) renderDetail();
    else renderBrowse();
  }
}

async function releaseClaimFromDetail(id) {
  try {
    await api('/api/needs/' + id + '/release', { method: 'POST' });
    toast('Claim released');
    await renderDetail();
  } catch (e) { toast(e.message); }
}

// ================= Org dashboard =================
async function renderDashboard() {
  if (!currentUser || currentUser.kind !== 'org') { showView('browse'); return; }
  document.getElementById('dashOrgName').textContent = currentUser.name;
  document.getElementById('dashAvatar').textContent = currentUser.initials;
  document.getElementById('pendingBanner').style.display = currentUser.approved ? 'none' : 'block';

  const list = document.getElementById('myNeedsList');
  let mine;
  try {
    const data = await api('/api/my/needs');
    mine = data.needs;
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><h3>Couldn't load your needs</h3><p>${escapeHtml(e.message)}</p></div>`;
    return;
  }

  list.innerHTML = '';
  if (mine.length === 0) {
    list.innerHTML = '<div class="empty-state"><h3>No needs posted yet</h3><p>Post your first need so donors can see it.</p></div>';
    return;
  }
  mine.forEach(n => {
    const { cls, text } = badgeFor(n);
    const row = document.createElement('div');
    row.className = 'my-need-row';
    row.innerHTML = `
      <div class="info">
        <b>${escapeHtml(n.title)}</b>
        <span class="badge ${cls}" style="width:fit-content;">${text}</span>
      </div>
      <div class="actions">
        <button class="btn btn-sm" onclick="editNeed(${n.id})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteNeed(${n.id})">Delete</button>
      </div>
    `;
    list.appendChild(row);
  });
}

function openModal() {
  editingNeedId = null;
  document.getElementById('modalTitle').textContent = 'Post a need';
  document.getElementById('mTitle').value = '';
  document.getElementById('mType').value = 'item';
  document.getElementById('mUrgency').value = 'High';
  document.getElementById('mDesc').value = '';
  document.getElementById('modalOverlay').classList.add('open');
}
async function editNeed(id) {
  let n = (browseNeeds.find(x => x.id === id));
  if (!n) {
    try { n = (await api('/api/needs/' + id)).need; } catch (e) { toast(e.message); return; }
  }
  editingNeedId = id;
  document.getElementById('modalTitle').textContent = 'Edit need';
  document.getElementById('mTitle').value = n.title;
  document.getElementById('mType').value = n.type;
  document.getElementById('mUrgency').value = n.urgency;
  document.getElementById('mDesc').value = n.description === 'No further details provided.' ? '' : n.description;
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }

async function saveNeed() {
  const title = document.getElementById('mTitle').value.trim();
  if (!title) { alert('Give the need a title.'); return; }
  const body = {
    title,
    type: document.getElementById('mType').value,
    urgency: document.getElementById('mUrgency').value,
    description: document.getElementById('mDesc').value.trim() || 'No further details provided.',
  };
  try {
    if (editingNeedId) {
      await api('/api/needs/' + editingNeedId, { method: 'PUT', body });
      toast('Need updated');
    } else {
      await api('/api/needs', { method: 'POST', body });
      toast('Need posted');
    }
    closeModal();
    renderDashboard();
  } catch (e) { toast(e.message); }
}

async function deleteNeed(id) {
  if (!confirm('Remove this need?')) return;
  try {
    await api('/api/needs/' + id, { method: 'DELETE' });
    toast('Need removed');
    renderDashboard();
  } catch (e) { toast(e.message); }
}

// ================= Donor dashboard =================
async function renderDonorDashboard() {
  if (!currentUser || currentUser.kind !== 'donor') { showView('browse'); return; }
  document.getElementById('donorName').textContent = currentUser.name;
  document.getElementById('donorAvatar').textContent = currentUser.initials;

  const list = document.getElementById('claimsList');
  let mine;
  try {
    const data = await api('/api/my/claims');
    mine = data.needs;
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><h3>Couldn't load your claims</h3><p>${escapeHtml(e.message)}</p></div>`;
    return;
  }

  list.innerHTML = '';
  if (mine.length === 0) {
    list.innerHTML = '<div class="empty-state"><h3>No claims yet</h3><p>Browse needs and claim something to help with.</p></div>';
    return;
  }
  mine.forEach(n => {
    const row = document.createElement('div');
    row.className = 'claim-row';
    row.innerHTML = `
      <div class="info">
        <b>${escapeHtml(n.title)}</b>
        <div style="font-size:12.5px; color:var(--ink-soft);">${escapeHtml(n.org.name)} · ${escapeHtml(n.org.city)}</div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="releaseClaim(${n.id})">Release claim</button>
    `;
    list.appendChild(row);
  });
}

async function releaseClaim(id) {
  try {
    await api('/api/needs/' + id + '/release', { method: 'POST' });
    toast('Claim released');
    renderDonorDashboard();
  } catch (e) { toast(e.message); }
}

// ================= Init =================
document.getElementById('cityFilter').addEventListener('change', applyBrowseFilters);
document.getElementById('catFilter').addEventListener('change', applyBrowseFilters);
document.getElementById('urgencyFilter').addEventListener('change', applyBrowseFilters);

// Expose handlers used by inline onclick attributes.
Object.assign(window, {
  goHome, showView, setAuthRole, setAuthMode, handleSignin, handleSignup, signOut,
  openDetail, sendMessage, releaseClaimFromDetail, openClaimModal, closeClaimModal,
  confirmClaim, openModal, editNeed, closeModal, saveNeed, deleteNeed, releaseClaim,
});

(async function init() {
  try {
    const { user } = await api('/api/me');
    currentUser = user;
  } catch { currentUser = null; }
  await populateCityFilter();
  await renderBrowse();
  renderTopActions();
})();
