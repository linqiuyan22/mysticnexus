// ============ 全局变量与用户系统 ============
const VALID_USERS = {
    'HUAXU': { pass:'hx1234', name:'系统管理员', isAdmin:true },
    'QYXH-GUEST': { pass:'visitor', name:'临时访客', isAdmin:false },
    'L-09-01-S': { pass:'fengyu', name:'苏晚眠', isAdmin:false },
    'L-09-03-S': { pass:'lingxiu', name:'沈绛离', isAdmin:false },
    'L-09-02-X': { pass:'tianji', name:'谢逢虚', isAdmin:false },
    'L-09-04-W': { pass:'luoyu', name:'温泣语', isAdmin:false },
    'L-09-05-L': { pass:'kuanggu', name:'陆烬弦', isAdmin:false }
};

const ARCHIVE_DATA_VERSION = 'xuju-archive-v50';

window.currentUser = null;
purgeLegacySiteStorage();
let archiveData = [];
let userFavorites = safeGetJSON('xuju_favorites', {});
// 迁移旧 bundle 里的 userFavorites（旧数组格式在 favGroups() 中自动转分组）
try { const _b = JSON.parse(localStorage.getItem('site_local_data_bundle') || 'null'); if (_b && _b.userFavorites) { for (const k in _b.userFavorites) { if (!userFavorites[k]) userFavorites[k] = _b.userFavorites[k]; } } } catch (e) {}
let userHistory = {};
let userLoginCounts = {};
let currentPanel = 'home';
let activeCategory = 'all';
let activeSubCategory = 'all';
let currentBoard = 'all';
let currentPostPage = 1;
const POST_PAGE_SIZE = 8;
let activeContainmentType = 'all';
let currentChannel = 'main';
let terminalInited = false;
let editingId = null;
let currentInternalPostId = null; 

// 匿名 id 拟人化：夜行客_3b9 风格（同一游客固定不变）
const _NICK_A = ['夜行客','雾中客','纸灯人','烛火客','檐下人','巷口客','旧伞客','星辉客','无眠客','潮声客','槐下客','墨夜客','拾影人','望月人','叩门人','提灯客','枕风客','听雨人','守夜人','引路人'];
function _genNick() { return _NICK_A[Math.floor(Math.random()*_NICK_A.length)] + '_' + Math.floor(Math.random()*0xfff).toString(16); }
let forumNickname = localStorage.getItem('darkalley_nickname');
if (!forumNickname) { forumNickname = _genNick(); localStorage.setItem('darkalley_nickname', forumNickname); }
// 论坛发言身份：游客用匿名；已登录用「账号专属匿名 id」（隐藏实名，发帖/评论只显示匿名）
function currentIdentityName() { return window.currentUser ? window.currentUser.name : forumNickname; }
// 每个账号绑定一个固定匿名 id（发帖/评论显示，不显示实名）
// 优先用云端账号 nickname（跨用户共享），没有则本地生成兜底
function accountNick(username) {
    if (!username) return forumNickname;
    // 云端用户列表里有该账号的 nickname（已登录用户发帖/评论/在线都用它）
    const cloudU = (typeof cloudUsers !== 'undefined' && cloudUsers) ? cloudUsers.find(u => u.username === username) : null;
    if (cloudU && cloudU.nickname) return cloudU.nickname;
    const map = safeGetJSON('darkalley_user_nicks', {});
    if (!map[username]) {
        map[username] = _genNick();
        safeSet('darkalley_user_nicks', map);
    }
    return map[username];
}
function currentPostAuthor() { return window.currentUser ? accountNick(window.currentUser.username) : forumNickname; }
// 渲染帖子作者名：优先用账号匿名 id（按 author_username 从 cloudUsers 映射），否则用帖子存的 author
function displayAuthor(post) {
    if (!post) return '';
    if (post.author_username) {
        const n = accountNick(post.author_username);
        if (n) return n;
    }
    return post.author || '匿名';
}
// 渲染评论作者名：优先用账号匿名 id（按 username 从 cloudUsers 映射）
function displayCommentUser(c) {
    if (!c) return '匿名';
    if (c.username) {
        const n = accountNick(c.username);
        if (n) return n;
    }
    return c.user || '匿名';
}
// 当前用户头像（dataURL/emoji），用于发帖/评论时存进帖子
function currentUserAvatar() {
    if (!window.currentUser) return null;
    const av = window.currentUser.avatar;
    return av && /^(data:|https?:|\/)/.test(av) ? av : (av || null);
}
// 渲染作者头像：有图片显示图片，否则显示 emoji/首字
function authorAvatarHtml(avatar, fallback, cls) {
    const c = cls || 'thread-avatar tone-a';
    if (avatar && /^(data:|https?:|\/)/.test(avatar)) {
        return `<img src="${avatar}" alt="" class="${c} author-avatar-img" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`;
    }
    return `<div class="${c}">${(avatar && avatar.trim()) ? avatar : (fallback || '☽')}</div>`;
}
// 帖子作者头像：优先帖子自带 author_avatar，否则从云端用户列表按 author_username 匹配（老帖/朋友帖也能显示头像）
function postAuthorAvatar(p) {
    if (p && p.author_avatar) return p.author_avatar;
    if (p && p.author_username) {
        const u = (cloudUsers || []).find(x => x.username === p.author_username);
        if (u && u.avatar) return u.avatar;
    }
    return null;
}
// 评论头像：优先评论自带 avatar，否则从云端用户列表按 username 匹配
function commentAuthorAvatar(c) {
    if (c && c.avatar) return c.avatar;
    if (c && c.username) {
        const u = (cloudUsers || []).find(x => x.username === c.username);
        if (u && u.avatar) return u.avatar;
    }
    return null;
}
let forumFriends = safeGetJSON('darkalley_friends', []);
let forumMessages = safeGetJSON('darkalley_messages', []);
// 频道预置消息带版本号：改 DEFAULT_CHANNELS 时升级，旧缓存自动重置为新通知（避免用户看不到清空后的消息）
let lingshiMessages = (() => {
    const LINGSHI_VER = 'xuju-lingshi-v3';
    if (localStorage.getItem('xuju_lingshi_ver') !== LINGSHI_VER) {
        const fresh = JSON.parse(JSON.stringify(DEFAULT_CHANNELS));
        safeSet('xuju_lingshi', fresh);
        localStorage.setItem('xuju_lingshi_ver', LINGSHI_VER);
        return fresh;
    }
    return safeGetJSON('xuju_lingshi', JSON.parse(JSON.stringify(DEFAULT_CHANNELS)));
})();
let internalPosts = safeGetJSON('xuju_internal_posts', JSON.parse(JSON.stringify(DEFAULT_INTERNAL_POSTS)));
let missions = safeGetJSON('xuju_missions', JSON.parse(JSON.stringify(DEFAULT_MISSIONS)));
let checkinState = safeGetJSON('darkalley_checkin', { streak: 0, total: 0, points: 0, lastDate: null, dates: [] });

function safeGetJSON(key, fallback) {
    try { const raw = localStorage.getItem(key); if (raw === null || raw === 'null' || raw === undefined) return fallback; return JSON.parse(raw); } catch(e) { return fallback; }
}
function safeSet(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {} }
function purgeLegacySiteStorage() {
    const legacyKeys = [
        'darkalley_posts', 'darkalley_featured', 'xuju_archive', 'xuju_lingshi',
        'xuju_internal_posts', 'xuju_missions', 'xuju_logincounts', 'xuju_history',
        'darkalley_friends', 'darkalley_messages', 'site_local_data_bundle', 'xuju_daily_fortune',
        'xuju_archive_version', 'xuju_rule_flags'
    ];
    const archiveSaved = safeGetJSON('xuju_archive', []);
    const postsSaved = safeGetJSON('darkalley_posts', []);
    const archiveVersion = localStorage.getItem('xuju_archive_version');
    const validCategories = new Set(['华墟管理档案', '华墟地理', '威胁评估档案', '人物档案', '事件记录', '收容物分支']);
    const legacyTextPattern = /档案条例|总则条例|目录分支|正文内容|\.docx|整篇长文|利用文档|整理自|旧版档案/i;
    const archiveLooksLegacy = Array.isArray(archiveSaved) && (
        archiveSaved.length < 10 ||
        archiveSaved.some(item => {
            const text = `${item?.title || ''} ${item?.summary || ''} ${item?.content || ''}`;
            const category = String(item?.category || '');
            const isOldLabel = legacyTextPattern.test(`${category} ${text}`);
            const isUnknownCategory = !!category && !validCategories.has(category) && !/^(人物档案|威胁评估档案|华墟管理档案|华墟地理|事件记录|收容物分支)$/.test(category);
            return isOldLabel || isUnknownCategory;
        }) ||
        archiveVersion !== ARCHIVE_DATA_VERSION
    );
    const postsLooksLegacy = Array.isArray(postsSaved) && postsSaved.some(post => {
        const text = `${post?.title || ''} ${post?.content || ''}`;
        return /正文内容|档案条例|总则条例|整篇长文|目录分支|旧版档案/i.test(text);
    });
    if (archiveLooksLegacy || postsLooksLegacy || archiveVersion !== ARCHIVE_DATA_VERSION) {
        legacyKeys.forEach(key => localStorage.removeItem(key));
        localStorage.setItem('xuju_archive_version', ARCHIVE_DATA_VERSION);
        console.log('已清理旧版缓存，恢复为分支式档案结构。');
    } else if (!archiveVersion) {
        localStorage.setItem('xuju_archive_version', ARCHIVE_DATA_VERSION);
    }
}
function safePrompt(message) {
    try {
        if (typeof window.prompt === 'function') return window.prompt(message);
    } catch (e) {}
    return '';
}

function getDailyFortune() {
    const today = new Date().toDateString();
    const saved = safeGetJSON('xuju_daily_fortune', null);
    if (saved && saved.date === today) return saved.fortune;
    const fortune = DAILY_FORTUNES[Math.floor(Math.random() * DAILY_FORTUNES.length)];
    safeSet('xuju_daily_fortune', { date: today, fortune });
    return fortune;
}

// ============ 🔥【终极防呆修复】先强制清除本地坏缓存 ============
let forumPosts = safeGetJSON('darkalley_posts', null);
if (!forumPosts || !Array.isArray(forumPosts) || forumPosts.length === 0 || forumPosts.length < DEFAULT_POSTS.length) {
    localStorage.removeItem('darkalley_posts');
    forumPosts = JSON.parse(JSON.stringify(DEFAULT_POSTS));
    safeSet('darkalley_posts', forumPosts);
    console.log("检测到帖子数据异常，已强制重置为完整默认数据");
}

let featuredPosts = safeGetJSON('darkalley_featured', null);
if (!featuredPosts || !Array.isArray(featuredPosts) || featuredPosts.length === 0 || featuredPosts.length < FEATURED_POSTS.length) {
    featuredPosts = JSON.parse(JSON.stringify(FEATURED_POSTS));
    safeSet('darkalley_featured', featuredPosts);
} else {
    featuredPosts = featuredPosts.map(item => ({
        ...item,
        postId: item.postId || item.id || 'p1',
        image: item.image || 'images/feature1.jpg'
    }));
    safeSet('darkalley_featured', featuredPosts);
}
function savePosts() { safeSet('darkalley_posts', forumPosts); }

// ============ ☁️ 云端帖子（多用户共享） ============
let cloudPosts = [];
let cloudOnline = false;
// 初始化时先同步云端帖子（登录后也会触发）
// 设计：默认世界观帖（DEFAULT_POSTS，p1-p22）保留在本地每个用户浏览器（精华/合集/收藏关联不破坏）；
// 云端 posts 表只存用户自己发的帖子（多用户共享），渲染时按 id 合并去重
async function loadCloudPosts() {
    if (!cloudApiBase()) return;
    const r = await cloudRequest('/api/posts');
    if (r.ok && Array.isArray(r.data.posts)) {
        cloudOnline = true;
        cloudPosts = r.data.posts;
        // 规范化 comments（云端 JSONB 可能读出为字符串）
        const norm = (p) => { if (p && typeof p.comments === 'string') { try { p.comments = JSON.parse(p.comments); } catch (e) { p.comments = []; } } if (p && !Array.isArray(p.comments)) p.comments = []; return p; };
        cloudPosts = (cloudPosts || []).map(norm);
        // 补充头像：老帖子没有 author_avatar 时，按 author_username 从 cloudUsers 匹配
        const avatarMap = {};
        (cloudUsers || []).forEach(u => { if (u.username) avatarMap[u.username] = u.avatar || null; });
        cloudPosts = cloudPosts.map(p => { if (!p.author_avatar && p.author_username && avatarMap[p.author_username]) p.author_avatar = avatarMap[p.author_username]; return p; });
        // 合并：云端用户帖 + 本地默认帖（云端优先，避免 id 冲突）
        const cloudIds = new Set(cloudPosts.map(p => p.id));
        const merged = cloudPosts.slice();
        DEFAULT_POSTS.forEach(p => { if (!cloudIds.has(p.id)) merged.push(norm(JSON.parse(JSON.stringify(p)))); });
        forumPosts = merged;
        safeSet('darkalley_posts', forumPosts);
        renderPostList();
        if (typeof renderForumProfile === 'function') renderForumProfile();
        if (typeof renderFeaturedPosts === 'function') renderFeaturedPosts();
        if (typeof renderCheckin === 'function') renderCheckin();
    } else {
        cloudOnline = false; // 连不上 → 保持本地兜底
    }
}
function isCloudPost(id) { return cloudPosts.some(p => p.id === id); }

// ============ ☁️ 云端档案（多用户共享：员工可编辑/新增，所有登录用户可见） ============
let cloudArchives = [];
async function loadCloudArchives() {
    if (!cloudApiBase()) return;
    const r = await cloudRequest('/api/archives');
    if (r.ok && Array.isArray(r.data.archives)) {
        cloudArchives = r.data.archives.map(a => {
            if (a && typeof a.tags === 'string') { try { a.tags = JSON.parse(a.tags); } catch (e) { a.tags = []; } }
            if (a && !Array.isArray(a.tags)) a.tags = [];
            return a;
        });
        mergeCloudArchives();
    }
}
function mergeCloudArchives() {
    if (!cloudArchives.length) return;
    const base = JSON.parse(JSON.stringify(DEFAULT_ARCHIVES));
    const byId = {};
    base.forEach(a => { if (a && a.id) byId[a.id] = a; });
    cloudArchives.forEach(c => { if (c && c.id) byId[c.id] = c; });
    archiveData = Object.keys(byId).map(k => byId[k]);
    archiveData.forEach(item => {
        if (!item) return;
        const inferredImage = inferArchiveImage(item.title, item.category);
        const inferredSub = inferArchiveSubCategory(item.title, item.category);
        const inferredSubtitle = inferArchiveSubtitle(item.title, item.category, item.content || '');
        item.image = item.image || inferredImage;
        item.subCategory = item.subCategory || inferredSub;
        item.subtitle = item.subtitle || inferredSubtitle;
        if (item.category === '人物档案') item.image = inferredImage || '';
    });
    safeSet('xuju_archive', archiveData);
    if (typeof renderArchiveList === 'function') renderArchiveList();
}
function isCloudArchive(id) { return cloudArchives.some(a => a.id === id); }
function triggerDataFileDownload(fileName, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
function saveLocalDataBundle() {
    const payload = {
        exportedAt: new Date().toISOString(),
        forumPosts,
        featuredPosts,
        archiveData,
        lingshiMessages,
        internalPosts,
        missions,
        userFavorites,
        userHistory,
        forumFriends,
        forumMessages
    };
    safeSet('darkalley_posts', forumPosts);
    safeSet('darkalley_featured', featuredPosts);
    safeSet('xuju_archive', archiveData);
    safeSet('xuju_lingshi', lingshiMessages);
    safeSet('xuju_internal_posts', internalPosts);
    safeSet('xuju_missions', missions);
    safeSet('xuju_logincounts', userLoginCounts);
    safeSet('xuju_history', userHistory);
    safeSet('darkalley_friends', forumFriends);
    safeSet('darkalley_messages', forumMessages);
    safeSet('site_local_data_bundle', payload);
    return payload;
}
function exportLocalDataBundle() {
    const payload = saveLocalDataBundle();
    triggerDataFileDownload('site-local-data.json', payload);
    return payload;
}
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ============ 🌟 论坛星星/数据流粒子特效 ============
let starAnimId = null;
function startStars() {
    const canvas = document.getElementById('starCanvas');
    if (!canvas) return;
    if(starAnimId) { cancelAnimationFrame(starAnimId); }
    const ctx = canvas.getContext('2d');
    function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    window.removeEventListener('resize', resizeCanvas); window.addEventListener('resize', resizeCanvas); resizeCanvas();
    const stars = Array.from({length:56}, ()=>({
        x: Math.random()*canvas.width, y: Math.random()*canvas.height,
        radius: 0.5 + Math.random()*1.3, speed: 0.2 + Math.random()*0.4,
        opacity: 0.25 + Math.random()*0.35
    }));
    let t = 0;
    let meteor = null, meteorTick = 0;
    function spawnMeteor() {
        meteor = { x: Math.random() * canvas.width * 0.5 + 20, y: Math.random() * canvas.height * 0.3 + 10, vx: 5 + Math.random() * 5, vy: 2 + Math.random() * 2.5, life: 50 };
    }
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        stars.forEach(s => {
            s.y += s.speed;
            if(s.y > canvas.height + 10) { s.y = -10; s.x = Math.random()*canvas.width; }
            const alpha = s.opacity * (0.6 + 0.4 * Math.sin(t + s.x));
            ctx.beginPath(); ctx.arc(s.x, s.y, s.radius, 0, Math.PI*2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.fill();
        });
        // 流星（偶尔划过）
        if (!meteor) { if (++meteorTick > 700 + Math.random() * 700) { spawnMeteor(); meteorTick = 0; } }
        if (meteor) {
            ctx.beginPath(); ctx.moveTo(meteor.x, meteor.y); ctx.lineTo(meteor.x - meteor.vx * 10, meteor.y - meteor.vy * 10);
            ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.3; ctx.stroke();
            meteor.x += meteor.vx; meteor.y += meteor.vy; meteor.life--;
            if (meteor.life <= 0 || meteor.x > canvas.width + 40 || meteor.y > canvas.height + 40) meteor = null;
        }
        t += 0.05;
        starAnimId = requestAnimationFrame(draw);
    }
    draw();
}

// ============ 双音乐播放器系统 ============
let forumTrackIdx = 0;
// 统一的迷你播放器实现：论坛播放器与终端播放器共用这一套逻辑，
// 以后修播放器功能只需要改这一处，不用两边分别改。
function setupMiniPlayerGeneric(cfg) {
    const { audio, sourceEl, btn, prevBtn, nextBtn, statusText, actionText, disc, playerContainer, volSlider, volToggle, volKey, ncmPrefix, ncmPresetKey, getIdx, setIdx } = cfg;
    if (!audio || !sourceEl || !btn) return;
    if (!LOCAL_TRACKS || !LOCAL_TRACKS.length) { if (playerContainer) playerContainer.style.opacity = '0.4'; return; }
    const setTrack = (i) => {
        if (!LOCAL_TRACKS.length) return;
        const idx = ((i % LOCAL_TRACKS.length) + LOCAL_TRACKS.length) % LOCAL_TRACKS.length;
        setIdx(idx);
        const t = LOCAL_TRACKS[idx];
        sourceEl.src = t.file;
        if (disc) disc.src = t.cover || disc.src;
        if (statusText) { statusText.textContent = t.title; statusText.title = t.title + (t.artist ? ' · ' + t.artist : '') + (t.album ? ' · 《' + t.album + '》' : ''); }
        audio.load();
        if (!audio.paused) audio.play().catch(() => {});
    };
    setTrack(0);
    audio.volume = 0.3;
    bindPlayerVolume(audio, volSlider, volToggle, volKey);
    btn.addEventListener('click', () => {
        if (audio.paused) {
            audio.play().then(() => { playerContainer.classList.add('playing'); if (actionText) actionText.textContent = '[ 播放中 ]'; btn.textContent = '⏸'; }).catch(() => {});
        } else {
            audio.pause(); playerContainer.classList.remove('playing'); if (actionText) actionText.textContent = '[ 暂停 ]'; btn.textContent = '▶';
        }
    });
    if (prevBtn) prevBtn.addEventListener('click', () => setTrack(getIdx() - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => setTrack(getIdx() + 1));
    if (ncmPresetKey) bindNcmPlayer(ncmPrefix, ncmPresetKey); else bindNcmPlayer(ncmPrefix);
    setupPlayerMinimizeAndDrag();
}

function setupForumMiniPlayer() {
    setupMiniPlayerGeneric({
        audio: document.getElementById('forumAudio'),
        sourceEl: document.getElementById('forumAudioSource'),
        btn: document.getElementById('forumMiniPlayBtn'),
        prevBtn: document.getElementById('forumPrevBtn'),
        nextBtn: document.getElementById('forumNextBtn'),
        statusText: document.getElementById('forumStatusText'),
        actionText: document.getElementById('forumActionText'),
        disc: document.getElementById('forumVinylDisc'),
        playerContainer: document.getElementById('forumVinylPlayer'),
        volSlider: document.getElementById('forumVolSlider'),
        volToggle: document.getElementById('forumVolToggle'),
        volKey: 'darkalley_volume_forum',
        ncmPrefix: 'forum',
        getIdx: () => forumTrackIdx,
        setIdx: (v) => { forumTrackIdx = v; }
    });
}

let terminalTrackIdx = 0;
function setupMiniTerminalPlayer() {
    setupMiniPlayerGeneric({
        audio: document.getElementById('bgAudio'),
        sourceEl: document.getElementById('audioSource'),
        btn: document.getElementById('miniPlayBtn'),
        prevBtn: document.getElementById('miniPrevBtn'),
        nextBtn: document.getElementById('miniNextBtn'),
        statusText: document.getElementById('statusText'),
        actionText: document.getElementById('actionText'),
        disc: document.getElementById('vinylDisc'),
        playerContainer: document.getElementById('vinylPlayer'),
        volSlider: document.getElementById('miniVolSlider'),
        volToggle: document.getElementById('miniVolToggle'),
        volKey: 'darkalley_volume_terminal',
        ncmPrefix: 'mini',
        ncmPresetKey: 'terminal',
        getIdx: () => terminalTrackIdx,
        setIdx: (v) => { terminalTrackIdx = v; }
    });
}

// ============ 🎛 播放器：收起 / 展开 / 拖拽移动 ============
// 手机端、桌面通用：点「—」收起成小圆片（再点圆片展开），按住播放器可拖到任意位置（记忆位置）
function setupPlayerMinimizeAndDrag() {
    if (window.__playerUIInited) return;
    window.__playerUIInited = true;
    const cfg = [
        { el: document.getElementById('forumVinylPlayer'), minBtn: document.getElementById('forumPlayerMin'), key: 'darkalley_player_pos_forum', z: 9999, id: 'forum' },
        { el: document.getElementById('vinylPlayer'), minBtn: document.getElementById('miniPlayerMin'), key: 'darkalley_player_pos_terminal', z: 120, id: 'terminal' }
    ];
    let minState = {};
    try { minState = JSON.parse(localStorage.getItem('darkalley_player_min') || '{}') || {}; } catch (e) { minState = {}; }
    const saveMin = () => {
        try {
            localStorage.setItem('darkalley_player_min', JSON.stringify({
                forum: cfg[0].el.classList.contains('minimized'),
                terminal: cfg[1].el.classList.contains('minimized')
            }));
        } catch (e) {}
    };
    cfg.forEach((c) => {
        const { el, minBtn, key, z, id } = c;
        if (!el || !minBtn) return;
        // 恢复收起状态与拖拽位置
        if (minState[id]) el.classList.add('minimized');
        try {
            const p = JSON.parse(localStorage.getItem(key) || 'null');
            if (p && typeof p.left === 'number' && typeof p.top === 'number') {
                el.style.left = p.left + 'px';
                el.style.top = p.top + 'px';
                el.style.right = 'auto';
                el.style.transform = 'none';
            }
        } catch (e) {}
        // 收起 / 展开（拖拽判定在下方独立 click 处理）
        minBtn.addEventListener('click', (e) => { e.stopPropagation(); el.classList.toggle('minimized'); saveMin(); });
        // 拖拽（收缩后也可移动）
        let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0, suppressClick = false;
        el.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button, .ncm-pop, a, select, input, iframe')) return;
            dragging = true;
            suppressClick = false;
            const r = el.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY;
            origLeft = r.left; origTop = r.top;
            el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
            el.style.right = 'auto'; el.style.transform = 'none'; el.style.transition = 'none';
            el.style.zIndex = '10000'; el.classList.add('dragging');
            if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
            e.preventDefault();
        });
        const onMove = (e) => {
            if (!dragging) return;
            let nx = origLeft + (e.clientX - startX);
            let ny = origTop + (e.clientY - startY);
            const r = el.getBoundingClientRect();
            nx = Math.max(4, Math.min(window.innerWidth - r.width - 4, nx));
            ny = Math.max(4, Math.min(window.innerHeight - r.height - 4, ny));
            el.style.left = nx + 'px'; el.style.top = ny + 'px';
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            const r = el.getBoundingClientRect();
            if (Math.abs(r.left - origLeft) < 5 && Math.abs(r.top - origTop) < 5) suppressClick = false;
            else suppressClick = true;
            el.style.transition = ''; el.classList.remove('dragging'); el.style.zIndex = z;
            try { localStorage.setItem(key, JSON.stringify({ left: r.left, top: r.top })); } catch (err) {}
        };
        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerup', onUp);
        el.addEventListener('pointercancel', onUp);
        // 点击展开：拖拽后不触发
        const origClick = el.onclick || null;
        el.addEventListener('click', (e) => {
            if (suppressClick) { suppressClick = false; e.stopPropagation(); return; }
            if (el.classList.contains('minimized')) { el.classList.remove('minimized'); saveMin(); }
        });
    });
}

// ============ ☁ 网易云外链播放器 ============
function ncmFrame(type, id) {
    const t = type === 'playlist' ? 0 : 2;
    const h = type === 'playlist' ? 340 : 66;
    return 'https://music.163.com/outchain/player?type=' + t + '&id=' + encodeURIComponent(id) + '&auto=0&height=' + h;
}
function bindNcmPlayer(prefix, presetKey) {
    const pop = document.getElementById(prefix + 'NcmPop');
    const btn = document.getElementById(prefix + 'NcmBtn');
    const closeBtn = document.getElementById(prefix + 'NcmClose');
    const input = document.getElementById(prefix + 'NcmId');
    const typeSel = document.getElementById(prefix + 'NcmType');
    const goBtn = document.getElementById(prefix + 'NcmGo');
    const frame = document.getElementById(prefix + 'NcmFrame');
    const list = document.getElementById(prefix + 'NcmList');
    const nowTitle = document.getElementById(prefix + 'NcmNowTitle');
    const nowLink = document.getElementById(prefix + 'NcmNowLink');
    if (!pop || !btn) return;
    // 播放单曲 / 歌单
    const playSong = (id, name) => {
        if (frame) { frame.removeAttribute('loading'); frame.src = ncmFrame('song', id); frame.style.display = 'block'; }
        if (nowTitle) nowTitle.textContent = '正在播放：' + (name || '网易云单曲');
        if (nowLink) { nowLink.href = 'https://music.163.com/#/song?id=' + id; nowLink.style.display = 'inline'; }
        const m = safeGetJSON('darkalley_ncm', {}); m[prefix] = id; m[prefix + '_type'] = 'song'; safeSet('darkalley_ncm', m);
        if (input) input.value = id;
        if (typeSel) typeSel.value = 'song';
    };
    const playPlaylist = (id) => {
        if (frame) { frame.removeAttribute('loading'); frame.src = ncmFrame('playlist', id); frame.style.display = 'block'; }
        if (nowTitle) nowTitle.textContent = '正在播放歌单 #' + id;
        if (nowLink) { nowLink.href = 'https://music.163.com/#/playlist?id=' + id; nowLink.style.display = 'inline'; }
        const m = safeGetJSON('darkalley_ncm', {}); m[prefix] = id; m[prefix + '_type'] = 'playlist'; safeSet('darkalley_ncm', m);
        if (input) input.value = id;
        if (typeSel) typeSel.value = 'playlist';
    };
    // 预置鹰角歌曲列表（可点击播放）
    if (list && NCM_PRESET_TRACKS && NCM_PRESET_TRACKS.length) {
        list.innerHTML = NCM_PRESET_TRACKS.map((t, i) => `<button class="ncm-track" data-id="${t.id}" data-name="${t.name}" type="button">${i + 1}. ${t.name}</button>`).join('');
        list.querySelectorAll('.ncm-track').forEach(b => b.addEventListener('click', () => playSong(b.dataset.id, b.dataset.name)));
    }
    // 打开浮层时才恢复上次/预置播放（避免页面加载即请求网易云，且不依赖 lazy）
    const pre = (NCM_PRESETS && NCM_PRESETS[presetKey || prefix]) || { type: 'song', id: '' };
    const ncmMem = safeGetJSON('darkalley_ncm', {});
    const saved = ncmMem[prefix] || pre.id;
    const savedType = ncmMem[prefix + '_type'] || pre.type;
    if (input) input.value = saved;
    if (typeSel) typeSel.value = savedType;
    let restored = false;
    const restore = () => {
        if (restored || !saved) return;
        restored = true;
        if (savedType === 'playlist') playPlaylist(saved); else playSong(saved);
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('open'); if (pop.classList.contains('open')) restore(); });
    if (closeBtn) closeBtn.addEventListener('click', () => pop.classList.remove('open'));
    const go = () => {
        const id = (input ? input.value : '').trim();
        const type = typeSel ? typeSel.value : 'song';
        if (!id) return;
        restored = true;
        if (type === 'playlist') playPlaylist(id); else playSong(id);
    };
    if (goBtn) goBtn.addEventListener('click', go);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ============ 论坛渲染 ============
function renderFeaturedPosts() {
    const slider = document.getElementById('featuredSlider');
    if (!slider) return;

    const validFeatured = featuredPosts.filter(item => item && (item.postId || item.id));
    slider.innerHTML = validFeatured.map(item => {
        const targetId = item.postId || item.id;
        const match = forumPosts.find(post => post.id === targetId);
        const title = match ? match.title : (item.title || '专题');
        const imagePath = item.image || 'images/feature1.jpg';
        return `
            <div class="featured-post-card featured-link" data-id="${targetId}" style="background-color:#222; background-image:url('${imagePath}')">
                <span class="featured-post-badge">${item.badge || '专题'}</span>
                <div class="featured-post-title">${title}</div>
            </div>
        `;
    }).join('');

    document.querySelectorAll('.featured-link').forEach(el => {
        el.addEventListener('click', function() {
            const targetId = this.dataset.id;
            if (!targetId) return;
            const target = forumPosts.find(post => post.id === targetId);
            if (target) {
                showPostDetail(targetId);
            }
        });
    });
}

let forumSearchKw = '';
function renderPostList() {
    const list = document.getElementById('postList');
    if (!list) return;
    let filtered = forumPosts;
    if (forumSearchKw) {
        const kw = forumSearchKw.toLowerCase();
        filtered = filtered.filter(p => (p.title + ' ' + p.content + ' ' + (p.author || '') + ' ' + (p.board || '')).toLowerCase().includes(kw));
    } else if (currentBoard !== 'all') {
        filtered = filtered.filter(p => p.board === currentBoard);
    }
    const total = (filtered || []).length;
    const totalPages = Math.max(1, Math.ceil(total / POST_PAGE_SIZE));
    if (currentPostPage > totalPages) currentPostPage = totalPages;
    if (currentPostPage < 1) currentPostPage = 1;
    // 置顶帖（标题含【置顶】）始终排在列表最前，不被新增帖子顶下去；其余按时间倒序（新增在前）
    const sorted = (filtered || []).slice().sort((a, b) => {
        const pa = /【置顶】|\[置顶\]/.test(a.title || '') ? 1 : 0;
        const pb = /【置顶】|\[置顶\]/.test(b.title || '') ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    });
    const pageItems = sorted.slice((currentPostPage - 1) * POST_PAGE_SIZE, currentPostPage * POST_PAGE_SIZE);
    if (total === 0) {
        list.innerHTML = `<div class="post-item" style="text-align:center;color:var(--text-muted);pointer-events:none;border-color:transparent;">该板块还没有帖子，快来发布第一篇讨论吧。</div>`;
    } else {
        list.innerHTML = pageItems.map(p => {
            const cover = p.image && String(p.image).trim() ? String(p.image).trim() : 'images/feature1.jpg';
            return `
            <div class="post-item" data-id="${p.id}">
                ${p.image ? `<img class="post-cover" src="${cover}" alt="" loading="lazy" decoding="async">` : ''}
                <div class="post-content">
                    <div class="post-header">
                        <div class="post-author">${authorAvatarHtml(postAuthorAvatar(p), (displayAuthor(p)||'匿').slice(-2).slice(0,1), 'thread-avatar tone-a')}<span class="post-author-name">${displayAuthor(p)}</span></div>
                        <div class="post-meta">
                            <span class="post-board-tag">${p.board || '综合'}</span>
                            <span class="post-time">${p.timestamp}</span>
                        </div>
                    </div>
                    <div class="post-title">${p.title}</div>
                    <div class="post-content-preview">${p.content}</div>
                </div>
            </div>
        `}).join('');
    }
    document.querySelectorAll('.post-item[data-id]').forEach(el => {
        el.addEventListener('click', () => showPostDetail(el.dataset.id));
    });
    renderPagination(totalPages);
    document.getElementById('totalPosts').textContent = forumPosts.length;
    renderCheckin();
}

function renderPagination(totalPages) {
    const wrap = document.getElementById('postPagination');
    if (!wrap) return;
    if (totalPages <= 1) { wrap.innerHTML = ''; return; }
    const parts = [];
    parts.push(`<button class="page-btn" data-page="${currentPostPage - 1}" ${currentPostPage === 1 ? 'disabled' : ''}>‹ 上一页</button>`);
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - currentPostPage) <= 1) {
            if (pages[pages.length - 1] !== p) pages.push(p);
        }
    }
    let last = 0;
    pages.forEach(p => {
        if (last && p - last > 1) parts.push('<span class="page-ellipsis">…</span>');
        parts.push(`<button class="page-btn${p === currentPostPage ? ' active' : ''}" data-page="${p}">${p}</button>`);
        last = p;
    });
    parts.push(`<button class="page-btn" data-page="${currentPostPage + 1}" ${currentPostPage === totalPages ? 'disabled' : ''}>下一页 ›</button>`);
    wrap.innerHTML = parts.join('');
    wrap.querySelectorAll('.page-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = parseInt(btn.dataset.page, 10);
            if (isNaN(p) || p < 1 || p > totalPages) return;
            currentPostPage = p;
            renderPostList();
        });
    });
}

// ============  论坛动态（模拟实时活跃度） ============
let cloudUsers = []; // 云端用户（在线实况）
async function loadCloudUsers() {
    if (!cloudApiBase()) return;
    // 优先从 /api/users 拿完整用户列表；云函数未更新时用云端帖子作者 + 聊天室用户兜底（也是真实数据）
    const r = await cloudRequest('/api/users');
    if (r.ok && Array.isArray(r.data.users) && r.data.users.length) {
        cloudUsers = r.data.users;
    } else {
        const map = {};
        (cloudPosts || []).forEach(p => { if (p.author && p.author !== '系统管理员') map[p.author] = { username: p.author_username || p.author, roleName: p.author, nickname: accountNick(p.author_username || p.author) }; });
        (cloudChatMessages || []).forEach(m => { const nm = m.name || m.username; if (nm && nm !== '系统管理员') map[nm] = { username: m.username, roleName: m.name || m.username, nickname: accountNick(m.username) }; });
        cloudUsers = Object.values(map);
    }
    if (typeof updateForumStatus === 'function') updateForumStatus();
    // 云端 nickname 就绪后重绘帖子列表（作者名用云端匿名 id）
    if (typeof renderPostList === 'function') renderPostList();
}
function updateForumStatus() {
    // 在线人数：真实注册用户数 + 匿名游客基数（随用户规模实况增长）
    const online = Math.max(40, (cloudUsers.length || 0) + 42 + Math.floor(Math.random() * 6));
    const today = todayStr();
    // 今日新帖：真实统计（timestamp 含今天的帖子）
    const todayKey = today.replace(/-/g, '/').replace(/\//g, '') + '';
    const newPosts = (forumPosts || []).filter(p => {
        const t = String(p.timestamp || '');
        return t.includes(today.replace(/-/g, '/')) || t.includes(today);
    }).length;
    ['onlineCount', 'onlineCountDetail'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = online;
    });
    const npe = document.getElementById('todayNewPosts');
    if (npe) npe.textContent = newPosts;
    // 最热话题：当前回复数最多的帖子
    const hot = (forumPosts || []).slice().sort((a, b) => (b.comments || []).length - (a.comments || []).length)[0];
    const hte = document.getElementById('hotTopic');
    if (hte) {
        if (hot) {
            hte.innerHTML = `<a href="#" class="hot-link" data-id="${hot.id}" title="查看帖子">${hot.title}</a>`;
            const hl = hte.querySelector('.hot-link');
            if (hl) hl.addEventListener('click', (e) => { e.preventDefault(); if (forumPosts.find(p => p.id === hl.dataset.id)) showPostDetail(hl.dataset.id); });
        } else {
            hte.textContent = '暂无话题';
        }
    }
    // 在线用户列表：云端真实用户（匿名 id）+ 帖子作者（匿名 id）+ 当前身份（匿名 id，置顶）
    const ue = document.getElementById('onlineUsers');
    if (ue) {
        const poolMap = {};
        (cloudUsers || []).forEach(u => { const nm = u.nickname || u.roleName || u.username; if (nm && nm !== '系统管理员') poolMap[nm] = true; });
        (forumPosts || []).forEach(p => { if (p.author && p.author !== '系统管理员') poolMap[displayAuthor(p)] = true; });
        // 当前身份（登录用户或游客匿名 id）纳入并置顶
        const myName = window.currentUser ? currentPostAuthor() : forumNickname;
        if (myName && myName !== '系统管理员') poolMap[myName] = true;
        const names = Object.keys(poolMap);
        if (!names.length) { ue.innerHTML = '<li class="online-empty">—</li>'; }
        else {
            const sorted = names.slice();
            if (myName) sorted.sort((a, b) => (a === myName ? -1 : b === myName ? 1 : 0));
            const show = sorted.slice(0, 10);
            ue.innerHTML = show.map(n => `<li class="${n === myName ? 'online-user-item self' : ''}"><span class="online-dot"></span>${n}${n === myName ? ' <small style="color:#ff7b7b">· 我</small>' : ''}</li>`).join('');
        }
    }
}

// ============ 每日签到 ============
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function yesterdayStr() {
    const d = new Date(); d.setDate(d.getDate()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function renderCheckin() {
    const btn = document.getElementById('checkinBtn');
    if (!btn) return;
    const today = todayStr();
    const checkedToday = checkinState.lastDate === today;
    btn.textContent = checkedToday ? '✅ 今日已签到' : '☾ 今日签到';
    btn.disabled = checkedToday;
    btn.classList.toggle('done', checkedToday);
    document.getElementById('checkinStreak').textContent = `连签 ${checkinState.streak} 天`;
    document.getElementById('checkinPoints').textContent = checkinState.points;
    const level = Math.min(10, Math.floor(checkinState.total / 5) + 1);
    document.getElementById('checkinLevel').textContent = `Lv.${level}`;
    document.getElementById('checkinTip').textContent = checkedToday
        ? '明天再来，连续签到奖励更多'
        : (checkinState.lastDate === yesterdayStr() ? '昨天已签，今天续上可保持连签' : '签到可得积分，连续签到奖励更多');
}
async function doCheckin() {
    const today = todayStr();
    const yst = yesterdayStr();
    if (checkinState.lastDate === today) { renderCheckin(); return; }
    // —— 云端优先（账号级签到，跨设备同步）——
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/checkin', {});
        if (r.ok && r.data && r.data.checkin) {
            const ck = r.data.checkin;
            checkinState.streak = ck.streak || 0;
            checkinState.total = ck.total || 0;
            checkinState.points = ck.points || 0;
            checkinState.lastDate = ck.lastDate || today;
            checkinState.dates = ck.dates || [];
            safeSet('darkalley_checkin', checkinState);
            // 同步云端积分到本地积分系统
            if (r.data.points !== undefined) { const uid = window.currentUser ? window.currentUser.id : 'guest'; const m = safeGetJSON('darkalley_points_map', {}) || {}; m[uid] = r.data.points; safeSet('darkalley_points_map', m); }
            renderCheckin(); renderForumProfile && renderForumProfile();
            addExp(15);
            alert(`☾ 签到成功！\n连签 ${checkinState.streak} 天\n积分 +${r.data.gained || 0}（当前总积分 ${getPoints()}）`);
            return;
        }
        if (r.status !== 0) { alert(r.data.error || '[!] 签到失败'); renderCheckin(); return; }
        // status 0 = 云端连不上 → 本地兜底
    }
    if (checkinState.lastDate === today) { renderCheckin(); return; }
    if (checkinState.lastDate === yst) {
        checkinState.streak += 1;
    } else {
        checkinState.streak = 1;
    }
    checkinState.total += 1;
    checkinState.points += 10 + Math.min(20, (checkinState.streak - 1) * 2);
    checkinState.lastDate = today;
    checkinState.dates = checkinState.dates || [];
    checkinState.dates.push(today);
    safeSet('darkalley_checkin', checkinState);
    renderCheckin();
    const gained = 10 + Math.min(20, (checkinState.streak - 1) * 2);
    addPoints(gained); addExp(15);
    alert(`☾ 签到成功！\n连签 ${checkinState.streak} 天\n积分 +${gained}（当前总积分 ${getPoints()}）`);
}
if (document.getElementById('checkinBtn')) {
    document.getElementById('checkinBtn').addEventListener('click', doCheckin);
}

// 登录后从云端同步签到状态 + 积分（跨设备）
async function loadCloudProfile() {
    if (!cloudApiBase() || !window.currentUser) return;
    const r = await cloudRequest('/api/profile');
    if (r.ok && r.data) {
        if (r.data.checkin) {
            const ck = r.data.checkin;
            checkinState.streak = ck.streak || 0;
            checkinState.total = ck.total || 0;
            checkinState.points = ck.points || 0;
            checkinState.lastDate = ck.lastDate || null;
            checkinState.dates = ck.dates || [];
            safeSet('darkalley_checkin', checkinState);
        }
        if (r.data.points !== undefined) {
            const uid = window.currentUser ? window.currentUser.id : 'guest';
            const m = safeGetJSON('darkalley_points_map', {}) || {};
            m[uid] = r.data.points;
            safeSet('darkalley_points_map', m);
        }
        renderCheckin && renderCheckin();
        renderForumProfile && renderForumProfile();
    }
}

window.showPostDetail = function(id) {
    const post = forumPosts.find(p => p.id === id);
    if (!post) {
        console.warn('未找到帖子：', id);
        return;
    }
    markRead('post|' + id);
    setForumView('postDetailView');
    const detail = document.getElementById('postDetailView');
    detail.dataset.currentId = id;

    const bodyHtml = post.content
        .split('\n\n')
        .map(paragraph => paragraph.trim())
        .filter(Boolean)
        .map(p => {
            const isList = p.startsWith('1.') || p.startsWith('2.') || p.startsWith('3.') || p.startsWith('4.') || p.startsWith('5.') || p.startsWith('·');
            if (isList) {
                const items = p
                    .split(/\n/)
                    .map(item => item.trim())
                    .filter(Boolean)
                    .map(item => `<li>${item.replace(/^\d+\.?\s*|^·\s*/, '')}</li>`)
                    .join('');
                return `<ul class="detail-list">${items}</ul>`;
            }
            return `<p>${p}</p>`;
        })
        .join('');

    const detailCover = post.image && String(post.image).trim() ? String(post.image).trim() : '';
    const commentCount = (post.comments||[]).length;
    const canManage = window.currentUser && (window.currentUser.isAdmin || (post.author_username && post.author_username === window.currentUser.username) || (!post.author_username && post.author === currentPostAuthor()));
    document.getElementById('postDetailContent').innerHTML = `
        ${detailCover ? `<div class="post-detail-cover" style="background-image:url('${detailCover}')"></div>` : ''}
        <div class="post-detail-header">
            <div class="post-author-bar">
                ${authorAvatarHtml(postAuthorAvatar(post), (displayAuthor(post)||'匿').slice(-2).slice(0,1), 'thread-avatar op tone-a')}
                <div>
                    <div class="post-author-name">${displayAuthor(post)}<span class="op-badge">楼主</span></div>
                    <div class="post-detail-meta">
                        <span>${post.timestamp}</span>
                        <span class="post-board-tag">${post.board || '综合'}</span>
                        <span class="post-stat">👁 ${(post.views||0)} 浏览 · 💬 ${commentCount} 回复 · <button class="post-like-btn" type="button">♡ ${post.likes || 0}</button></span>
                    </div>
                </div>
            </div>
            <h2>${post.title}</h2>
            <div class="post-detail-actions">${favBtnHtml(post.id, post.title)}${canManage ? `<button class="post-manage-btn" onclick="editMyPost('${post.id}')">✎ 编辑</button><button class="post-manage-btn danger" onclick="deleteMyPost('${post.id}')">🗑 删除</button>` : ''}</div>
        </div>
        <div class="post-detail-body">
            ${bodyHtml}
        </div>`;
    bindFavBtn(document.getElementById('postDetailContent'));
    const likeBtn = document.querySelector('.post-like-btn');
    if (likeBtn) likeBtn.addEventListener('click', () => {
        post.likes = (post.likes || 0) + 1;
        savePosts();
        likeBtn.textContent = '❤ ' + post.likes;
        likeBtn.classList.add('liked');
    });
    renderComments(post);
}

function renderComments(post) {
    const opName = displayAuthor(post);
    const listEl = document.getElementById('commentList');
    const comments = post.comments || [];
    const likedSet = safeGetJSON('darkalley_liked', {});
    if (!comments.length) { listEl.innerHTML = '<div style="color:var(--text-muted);padding:12px 0;">还没有回复，来抢个沙发？</div>'; return; }
    listEl.innerHTML = comments.map((c, idx) => {
        const cUser = displayCommentUser(c);
        const floor = idx + 2;
        const isOP = !!c.isOP || cUser === opName;
        const opBadge = isOP ? '<span class="op-badge">楼主</span>' : '';
        const avatarTone = isOP ? 'op' : (idx % 3 === 0 ? 'tone-a' : idx % 3 === 1 ? 'tone-b' : 'tone-c');
        const quoteHtml = c.replyTo ? `<div class="quote-block"><span class="quote-arrow">↩</span>回复 <b>${displayCommentUser(c.replyTo)}</b>：${c.replyTo.text}</div>` : '';
        const likeKey = post.id + '|' + idx;
        const liked = !!likedSet[likeKey];
        return `
        <div class="thread-card${isOP ? ' op-comment' : ''}">
            ${authorAvatarHtml(commentAuthorAvatar(c), (cUser||'匿').slice(-2).slice(0,1), 'thread-avatar ' + avatarTone)}
            <div class="thread-main">
                <div class="thread-card-header">
                    <strong>${cUser}</strong>${opBadge}
                    <small>${c.time} · ${floor}楼</small>
                </div>
                ${quoteHtml}
                <p>${c.text}</p>
                <div class="thread-actions">
                    <button class="cmt-btn quote-btn" data-idx="${idx}" type="button">↩ 引用</button>
                    <button class="cmt-btn like-btn ${liked ? 'liked' : ''}" data-idx="${idx}" type="button">${liked ? '❤' : '♡'} ${c.likes || 0}</button>
                </div>
            </div>
        </div>`;
    }).join('');
    listEl.querySelectorAll('.quote-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = comments[+btn.dataset.idx]; if (!c) return;
            let chain = c.text.slice(0, 50) + (c.text.length > 50 ? '…' : '');
            // 楼中楼：若被引用的评论本身也是引用，把引用链一并带上，更真实
            if (c.replyTo) chain = '↩ ' + c.replyTo.user + '：' + (String(c.replyTo.text || '').slice(0, 30) || '…') + ' ｜ ' + chain;
            window.pendingReply = { user: c.user, text: chain, floor: (+btn.dataset.idx) + 2 };
            const hint = document.getElementById('commentReplyHint');
            if (hint) { hint.style.display = 'flex'; document.getElementById('replyHintText').textContent = `@${c.user}（${(+btn.dataset.idx)+2}楼）`; }
            const input = document.getElementById('commentInput');
            input.placeholder = `回复 @${c.user}…`; input.value = ''; input.focus();
        });
    });
    listEl.querySelectorAll('.like-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const c = comments[+btn.dataset.idx]; if (!c) return;
            const key = post.id + '|' + btn.dataset.idx;
            if (likedSet[key]) return;
            likedSet[key] = true;
            c.likes = (c.likes || 0) + 1;
            savePosts(); safeSet('darkalley_liked', likedSet);
            renderComments(post);
        });
    });
}

function backToList() {
    setForumView('postListView');
    renderPostList();
}

// ============ 论坛事件绑定 ============
document.querySelectorAll('.board-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        if (!tab.dataset.board) return;
        document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentBoard = tab.dataset.board;
        currentPostPage = 1;
        setForumView('postListView');
        renderPostList();
    });
});
const forumSearchInput = document.getElementById('forumSearchInput');
if (forumSearchInput) forumSearchInput.addEventListener('input', () => {
    forumSearchKw = forumSearchInput.value.trim();
    currentPostPage = 1;
    renderPostList();
});
// —— 发帖图片上传（压缩到长边 1200，base64 存帖）——
const newPostImgBtn = document.getElementById('newPostImgBtn');
const newPostImageFile = document.getElementById('newPostImageFile');
const newPostImagePreview = document.getElementById('newPostImagePreview');
const newPostImagePreviewImg = document.getElementById('newPostImagePreviewImg');
const newPostImageRemove = document.getElementById('newPostImageRemove');
let __newPostImage = null;
function compressImage(dataUrl, maxSide, quality, cb) {
    const img = new Image();
    img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        w = Math.round(w * scale); h = Math.round(h * scale);
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = dataUrl;
}
if (newPostImgBtn && newPostImageFile) newPostImgBtn.addEventListener('click', () => newPostImageFile.click());
if (newPostImageFile) newPostImageFile.addEventListener('change', () => {
    const file = newPostImageFile.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); newPostImageFile.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { alert('图片需小于 5MB'); newPostImageFile.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (e) => compressImage(e.target.result, 1200, 0.82, (out) => {
        __newPostImage = out;
        if (newPostImagePreviewImg) newPostImagePreviewImg.src = out;
        if (newPostImagePreview) newPostImagePreview.style.display = 'inline-flex';
        newPostImageFile.value = '';
    });
    reader.readAsDataURL(file);
});
if (newPostImageRemove) newPostImageRemove.addEventListener('click', () => {
    __newPostImage = null;
    if (newPostImagePreview) newPostImagePreview.style.display = 'none';
    if (newPostImagePreviewImg) newPostImagePreviewImg.src = '';
});
document.getElementById('submitNewPostBtn').addEventListener('click', async () => {
    if (!window.currentUser) { alert('请先登录再发帖'); openAwakenModal(); return; }
    const title = document.getElementById('newPostTitle').value.trim();
    const content = document.getElementById('newPostContent').value.trim();
    const board = document.getElementById('newPostBoard').value;
    const image = __newPostImage || null;
    if (!title || !content) return alert('请填写标题和内容');
    // —— 云端优先（多用户共享，发帖所有人可见）——
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/posts', { title, content, board, image, author: currentPostAuthor(), author_avatar: currentUserAvatar() });
        if (r.ok && r.data && r.data.post) {
            if (typeof r.data.post.comments === 'string') { try { r.data.post.comments = JSON.parse(r.data.post.comments); } catch (e) { r.data.post.comments = []; } }
            if (!Array.isArray(r.data.post.comments)) r.data.post.comments = [];
            forumPosts.push(r.data.post);
            cloudPosts.push(r.data.post);
            safeSet('darkalley_posts', forumPosts);
            currentPostPage = 1;
            addPoints(10); addExp(10); backToList();
            document.getElementById('newPostTitle').value = '';
            document.getElementById('newPostContent').value = '';
            __newPostImage = null;
            if (newPostImagePreview) newPostImagePreview.style.display = 'none';
            if (newPostImagePreviewImg) newPostImagePreviewImg.src = '';
            return;
        }
        if (r.status !== 0) { alert(r.data.error || '[!] 发帖失败'); return; }
        // status 0 = 云端连不上 → 本地兜底
    }
    forumPosts.push({ id:'p'+Date.now(), title, content, board, image, author: currentPostAuthor(), author_username: window.currentUser ? window.currentUser.username : undefined, author_avatar: currentUserAvatar(), timestamp:new Date().toLocaleString('zh-CN'), comments:[] });
    currentPostPage = 1;
    addPoints(10); addExp(10); savePosts(); backToList();
    __newPostImage = null;
    if (newPostImagePreview) newPostImagePreview.style.display = 'none';
    if (newPostImagePreviewImg) newPostImagePreviewImg.src = '';
});
document.getElementById('submitCommentBtn').addEventListener('click', async () => {
    if (!window.currentUser) { alert('请先登录再回复'); openAwakenModal(); return; }
    const text = document.getElementById('commentInput').value.trim();
    if (!text) return;
    const postId = document.getElementById('postDetailView').dataset.currentId;
    const post = forumPosts.find(p => p.id === postId);
    if (!post) return;
    const replyTo = window.pendingReply || null;
    window.pendingReply = null;
    const hint = document.getElementById('commentReplyHint'); if (hint) hint.style.display = 'none';
    document.getElementById('commentInput').placeholder = '说点什么吧...';
    // —— 云端帖子的评论走云端（多用户共享）——
    if (cloudApiBase() && window.currentUser && (cloudPosts.some(cp => cp.id === postId) || post.author_username)) {
        const r = await cloudRequest('/api/posts/comment', { postId, text, replyTo, user: currentPostAuthor(), avatar: currentUserAvatar() });
        if (r.ok && Array.isArray(r.data.comments)) {
            post.comments = r.data.comments;
            savePosts(); renderComments(post); document.getElementById('commentInput').value = '';
            addPoints(5); addExp(5); return;
        }
        if (r.status !== 0) { alert(r.data.error || '[!] 回复失败'); return; }
        // status 0 → 本地兜底
    }
    post.comments = post.comments || [];
    post.comments.push({ user: currentPostAuthor(), username: window.currentUser ? window.currentUser.username : undefined, avatar: currentUserAvatar(), text, time:new Date().toLocaleString('zh-CN'), likes: 0, replyTo });
    addPoints(5); addExp(5); savePosts(); renderComments(post); document.getElementById('commentInput').value = '';
});
document.getElementById('cancelReplyBtn').addEventListener('click', () => {
    window.pendingReply = null;
    document.getElementById('commentReplyHint').style.display = 'none';
    document.getElementById('commentInput').placeholder = '说点什么吧...';
});
document.getElementById('backToListBottom').addEventListener('click', backToList);
['forumHomeLink','backToListBtn','cancelNewPostBtn','profileBackBtn'].forEach(id => {
    const el = document.getElementById(id); if(el) el.addEventListener('click', (e) => { if(e) e.preventDefault(); backToList(); });
});
document.getElementById('forumNewPostLink').addEventListener('click', e => { e.preventDefault();
    document.getElementById('postListView').style.display = 'none';
    document.getElementById('postDetailView').style.display = 'none';
    document.getElementById('forumProfileView').style.display = 'none';
    document.getElementById('newPostForm').style.display = 'block';
});

// ============ 论坛个人中心与登录系统 ============
document.getElementById('forumProfileLink').addEventListener('click', e => { e.preventDefault(); backToProfile(); });
function backToProfile() {
    document.getElementById('postListView').style.display = 'none';
    document.getElementById('postDetailView').style.display = 'none';
    document.getElementById('newPostForm').style.display = 'none';
    document.getElementById('forumProfileView').style.display = 'block';
    renderForumProfile();
}
// —— 成就勋章 ——
const BADGES = [
    { id:'b1', name:'初入暗巷', icon:'🌙', desc:'完成首次签到', cond:s => s.checkin >= 1 },
    { id:'b2', name:'守夜新人', icon:'📜', desc:'发出第一篇帖子', cond:s => s.posts >= 1 },
    { id:'b3', name:'热心巷友', icon:'💬', desc:'回复 5 条', cond:s => s.comments >= 5 },
    { id:'b4', name:'签到达人', icon:'🗓️', desc:'累计签到 7 天', cond:s => s.checkin >= 7 },
    { id:'b5', name:'连载作者', icon:'✍️', desc:'发帖 5 篇', cond:s => s.posts >= 5 },
    { id:'b6', name:'杂货收藏家', icon:'🛒', desc:'拥有 5 件商城物品', cond:s => s.owned >= 5 },
    { id:'b7', name:'积分新贵', icon:'✨', desc:'积分达到 100', cond:s => s.points >= 100 },
    { id:'b8', name:'老巷客', icon:'🕯️', desc:'累计签到 30 天', cond:s => s.checkin >= 30 }
];
function badgeStats() {
    const me = window.currentUser ? window.currentUser.username : null;
    const myPosts = forumPosts.filter(p => (p.author_username && me && p.author_username === me) || (!p.author_username && p.author === currentPostAuthor()));
    let comments = 0;
    (forumPosts || []).forEach(p => (p.comments || []).forEach(c => { if ((c.username && me && c.username === me) || (!c.username && c.user === currentPostAuthor())) comments++; }));
    return { checkin: checkinState.total || 0, posts: myPosts.length, comments, owned: getOwned().length, points: getPoints() };
}
function earnedBadges() { const st = badgeStats(); return BADGES.filter(b => b.cond(st)).map(b => b.id); }
function renderBadges() {
    const wall = document.getElementById('badgeWall');
    if (!wall) return;
    const earned = new Set(earnedBadges());
    wall.innerHTML = BADGES.map(b => earned.has(b.id)
        ? `<div class="badge-item" title="${b.name}：${b.desc}"><span class="badge-ico">${b.icon}</span><span class="badge-name">${b.name}</span></div>`
        : `<div class="badge-item badge-locked" title="${b.name}：${b.desc}（未获得）"><span class="badge-ico">🔒</span><span class="badge-name">${b.name}</span></div>`).join('');
}
function renderForumProfile() {
    document.getElementById('forumProfileName').textContent = currentIdentityName();
    const level = userLevel(getExp());
    document.getElementById('forumProfileSub').textContent = `已签到 ${checkinState.total} 天 · Lv.${level}`;
    renderBadges();
    // 头像（云端保存的 emoji 或上传图片）
    const avImg = document.getElementById('forumProfileAvatarImg');
    const av = window.currentUser ? window.currentUser.avatar : null;
    if (avImg) { applyAvatarFrame(avImg); if (av && /^(data:|https?:|\/)/.test(av)) { avImg.src = av; } else { avImg.src = 'images/user-icon.png'; } avImg.style.display = ''; }
    // 概览（我的帖子：按 author_username 或匿名 id 匹配）
    const myAuth = window.currentUser ? window.currentUser.username : null;
    const mine = forumPosts.filter(p => (p.author_username && myAuth && p.author_username === myAuth) || (!p.author_username && p.author === currentPostAuthor()));
    document.getElementById('ovPosts').textContent = mine.length;
    document.getElementById('ovCheckin').textContent = checkinState.total;
    document.getElementById('ovStreak').textContent = checkinState.streak;
    document.getElementById('ovPoints').textContent = checkinState.points;
    // 我的帖子（可管理：删除 / 编辑）
    document.getElementById('mypostsList').innerHTML = mine.length ? mine.map(p => `
        <div class="my-post-item">
            <span class="my-post-board">${p.board || '综合'}</span>
            <span class="my-post-title" onclick="showPostDetail('${p.id}')">${p.title}</span>
            <small>${(p.comments||[]).length} 回复 · ${p.timestamp}</small>
            <span class="my-post-actions">
                <button onclick="editMyPost('${p.id}')">✎ 编辑</button>
                <button onclick="deleteMyPost('${p.id}')">🗑 删除</button>
            </span>
        </div>`).join('') : '<div style="color:var(--text-muted);padding:10px 0;">你还没有发过帖子</div>';
    // 签到记录
    const history = (checkinState.dates || []).slice().reverse();
    document.getElementById('checkinHistory').innerHTML = history.length ? history.map(d => `<div class="checkin-day"><span>☾</span><span>${d}</span><span class="checkin-day-ok">已签到</span></div>`).join('') : '<div style="color:var(--text-muted);padding:10px 0;">还没有签到记录</div>';
    // 好友（云端同步，带小头像，点击进论坛私信）
    const friendsEl = document.getElementById('friendsList');
    if (friendsEl) friendsEl.innerHTML = forumFriends.length ? forumFriends.map(f => {
        const av = friendAvatarOf(f);
        const nm = friendDisplayOf(f);
        const avHtml = av ? `<img src="${av}" class="friend-avatar-img" alt="">` : `<span class="friend-avatar">${(nm || '友').slice(-1)}</span>`;
        return `<div class="friend-item" onclick="openForumChat('${f.replace(/'/g, '')}')"><span class="friend-avatar-wrap">${avHtml}</span><span class="friend-item-main"><span class="friend-item-name">${nm}</span><small>${f}</small></span><button onclick="event.stopPropagation();removeFriend('${f.replace(/'/g, '')}')" style="color:var(--accent-red);">删除</button></div>`;
    }).join('') : '暂无好友';
    // 私信（对话式，云端）
    renderMessageChat();
}
// ============ ☁️ 云端社交（好友 / 私信，论坛与终端通用） ============
let msgRecipient = null; // 当前私信对话对象（用户名）
let cloudChatMessages = []; // 云端聊天室消息
async function loadCloudSocial() {
    if (!cloudApiBase() || !window.currentUser) return;
    const f = await cloudRequest('/api/friends');
    if (f.ok && Array.isArray(f.data.friends)) {
        forumFriends = f.data.friends; safeSet('darkalley_friends', forumFriends);
        if (f.data.notes) { friendNotes = f.data.notes || {}; safeSet('darkalley_friend_notes', friendNotes); }
    }
    const m = await cloudRequest('/api/messages');
    if (m.ok && Array.isArray(m.data.messages)) { forumMessages = m.data.messages; safeSet('darkalley_messages', forumMessages); }
    refreshUnread();
    if (typeof loadFriendRequests === 'function') loadFriendRequests();
    if (typeof renderSocialPanel === 'function') renderSocialPanel();
    if (typeof renderForumProfile === 'function') renderForumProfile();
}
async function loadCloudChat() {
    if (!cloudApiBase()) return;
    const r = await cloudRequest('/api/chat');
    if (r.ok && Array.isArray(r.data.messages)) { cloudChatMessages = r.data.messages; if (currentChannel === 'cloud') { renderLingshi(); } refreshUnread(); }
}
// ============ 🔴 未读红点 / 👥 好友申请 / 🏷 好友备注 ============
let friendRequests = safeGetJSON('darkalley_friend_requests', []); // {from_user,to_user,status}
let friendNotes = safeGetJSON('darkalley_friend_notes', {}); // { friend: 备注 }
let unreadMap = safeGetJSON('darkalley_unread', {});
function saveUnread() { safeSet('darkalley_unread', unreadMap); }
function unreadOf(key) { return unreadMap[key] || 0; }
function totalUnread() { return Object.values(unreadMap).reduce((a, b) => a + b, 0); }
function clearUnread(key) { if (unreadMap[key]) { delete unreadMap[key]; saveUnread(); renderUnreadBadges(); } }
function markConvRead(key) {
    const read = safeGetJSON('darkalley_msg_read', {});
    const me = (window.currentUser || {}).username;
    const meName = (window.currentUser || {}).name;
    if (key && key.indexOf('u_') === 0) { const p = key.slice(2); read[key] = forumMessages.filter(m => m.from_user === p && m.to_user === me).length; }
    else if (key && key.indexOf('g_') === 0) { const g = key.slice(2); read[key] = (cloudGroupMessages[g] || groupChats[g] || []).filter(m => m.username !== me && m.user !== meName).length; }
    else if (key) { read[key] = 1; }
    safeSet('darkalley_msg_read', read);
    clearUnread(key);
}
function refreshUnread() {
    const me = (window.currentUser || {}).username;
    const meName = (window.currentUser || {}).name;
    const read = safeGetJSON('darkalley_msg_read', {});
    const nm = {};
    forumFriends.forEach(f => { const k = 'u_' + f; const t = forumMessages.filter(m => m.from_user === f && m.to_user === me).length; const n = Math.max(0, t - (read[k] || 0)); if (n) nm[k] = n; });
    Object.keys(cloudGroupMessages).forEach(g => { const k = 'g_' + g; const t = (cloudGroupMessages[g] || []).filter(m => m.username !== me && m.user !== meName).length; const n = Math.max(0, t - (read[k] || 0)); if (n) nm[k] = n; });
    if (cloudChatMessages.length) { const t = cloudChatMessages.filter(m => m.username !== me && m.user !== meName).length; const n = Math.max(0, t - (read['cloud'] || 0)); if (n) nm['cloud'] = n; }
    unreadMap = nm; saveUnread(); renderUnreadBadges();
}
function renderUnreadBadges() {
    document.querySelectorAll('#lingshiChannels .channel-btn').forEach(b => {
        const k = b.dataset.channel; if (!k) return;
        const n = unreadOf(k);
        let badge = b.querySelector('.ch-badge');
        if (n) { if (!badge) { badge = document.createElement('span'); badge.className = 'ch-badge'; b.appendChild(badge); } badge.textContent = n > 99 ? '99+' : n; }
        else if (badge) badge.remove();
    });
    const sb = document.getElementById('socialReqBadge');
    const reqN = friendRequests.filter(r => r.status === 'pending' && r.to_user === (window.currentUser || {}).username).length;
    if (sb) { sb.style.display = reqN ? '' : 'none'; sb.textContent = reqN > 99 ? '99+' : reqN; }
    const mb = document.getElementById('forumMailBadge');
    const mailN = unreadMailCount();
    if (mb) { mb.style.display = mailN ? '' : 'none'; mb.textContent = mailN > 99 ? '99+' : mailN; }
}
// 论坛私信未读数（对方发来未读）
function unreadMailCount() {
    const me = (window.currentUser || {}).username; if (!me) return 0;
    const read = safeGetJSON('darkalley_msg_read', {});
    let n = 0;
    forumMessages.forEach(m => { if (m.to_user === me) { const k = 'u_' + m.from_user; if ((read[k] || 0) < forumMessages.filter(x => x.from_user === m.from_user && x.to_user === me).length) n++; } });
    return n;
}
// 终端好友实名 / 备注（论坛保持匿名，终端用实名）
function friendNameInTerminal(f) {
    if (friendNotes[f]) return friendNotes[f];
    const u = (cloudUsers || []).find(x => x.username === f);
    return (u && (u.roleName || u.username)) || f;
}
window.editFriendNote = async function (f, note) {
    friendNotes[f] = note || ''; safeSet('darkalley_friend_notes', friendNotes);
    if (cloudApiBase() && window.currentUser) await cloudRequest('/api/friends/note', { friend: f, note: note || '' });
    if (typeof renderSocialPanel === 'function') renderSocialPanel();
    if (typeof renderLingshiChannels === 'function') renderLingshiChannels();
};
window.sendFriendRequest = async function (name) {
    if (!window.currentUser) return alert('请先登录');
    const n = (name || '').trim(); if (!n) return;
    if (n === window.currentUser.username) return alert('不能添加自己');
    if (forumFriends.indexOf(n) !== -1) return alert('已是好友');
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/friend_requests', { to: n });
        if (r.ok) { alert('已发送好友申请，等待对方通过'); renderSocialPanel(); return; }
        if (r.status !== 0) { alert(r.data.error || '发送失败'); return; }
    }
    forumFriends.push(n); safeSet('darkalley_friends', forumFriends); renderSocialPanel();
};
window.acceptFriend = async function (from) {
    const me = (window.currentUser || {}).username;
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/friend_requests/accept', { from });
        if (r.ok) { await loadCloudSocial(); await loadFriendRequests(); return; }
        if (r.status !== 0 && r.status !== 409) { alert(r.data.error || '操作失败'); return; }
    }
    if (forumFriends.indexOf(from) === -1) { forumFriends.push(from); safeSet('darkalley_friends', forumFriends); }
    friendRequests = friendRequests.filter(r => !(r.from_user === from && r.to_user === me)); safeSet('darkalley_friend_requests', friendRequests);
    renderSocialPanel(); if (typeof renderForumProfile === 'function') renderForumProfile();
};
window.declineFriend = async function (from) {
    const me = (window.currentUser || {}).username;
    if (cloudApiBase() && window.currentUser) await cloudRequest('/api/friend_requests/decline', { from });
    friendRequests = friendRequests.filter(r => !(r.from_user === from && r.to_user === me)); safeSet('darkalley_friend_requests', friendRequests);
    renderSocialPanel();
};
async function loadFriendRequests() {
    if (!cloudApiBase() || !window.currentUser) return;
    const r = await cloudRequest('/api/friend_requests');
    if (r.ok && Array.isArray(r.data.requests)) { friendRequests = r.data.requests; safeSet('darkalley_friend_requests', friendRequests); renderSocialPanel(); renderUnreadBadges(); }
}
// 清空所有频道聊天记录（本地重置为预置通知；云端由部署时 SQL 清空）
function clearAllChat() {
    lingshiMessages = JSON.parse(JSON.stringify(DEFAULT_CHANNELS)); safeSet('xuju_lingshi', lingshiMessages);
    forumMessages = []; safeSet('darkalley_messages', forumMessages);
    forumFriends = []; safeSet('darkalley_friends', forumFriends);
    friendGroups = {}; safeSet('darkalley_friend_groups', friendGroups);
    groupChats = {}; safeSet('darkalley_group_chats', groupChats);
    cloudChatMessages = []; cloudGroups = []; cloudGroupsLoaded = false; cloudGroupMessages = {};
    unreadMap = {}; safeSet('darkalley_unread', unreadMap);
    safeSet('darkalley_msg_read', {});
    friendRequests = []; safeSet('darkalley_friend_requests', friendRequests);
    if (typeof renderLingshiChannels === 'function') renderLingshiChannels();
    if (typeof renderLingshi === 'function') renderLingshi();
    if (typeof renderSocialPanel === 'function') renderSocialPanel();
    renderUnreadBadges();
}
// —— 私信对话式渲染 ——
function renderMessageChat() {
    const contactsEl = document.getElementById('msgContactList');
    const headEl = document.getElementById('msgChatHead');
    const bodyEl = document.getElementById('msgChatBody');
    if (!contactsEl) return;
    const me = (window.currentUser || {}).username;
    const partners = new Set(forumFriends);
    forumMessages.forEach(m => { if (m.to_user === me) partners.add(m.from_user); if (m.from_user === me) partners.add(m.to_user); });
    const list = [...partners].filter(u => u && u !== me);
    contactsEl.innerHTML = list.length ? list.map(u => `<div class="msg-contact-item ${msgRecipient === u ? 'msg-contact-active' : ''}" onclick="selectMsgRecipient('${u.replace(/'/g, '')}')">${u}<small>${forumMessages.filter(m => (m.from_user===u&&m.to_user===me)||(m.from_user===me&&m.to_user===u)).length} 条</small></div>`).join('') : '<div class="msg-chat-empty" style="padding:10px 4px;">暂无联系人<br>去「好友」添加</div>';
    if (headEl) headEl.textContent = msgRecipient ? `与 ${msgRecipient} 的对话` : '从好友列表选择收件人';
    if (bodyEl) {
        if (!msgRecipient) { bodyEl.innerHTML = '<div class="msg-chat-empty">选择左侧好友开始私信</div>'; return; }
        const conv = forumMessages.filter(m => (m.from_user === msgRecipient && m.to_user === me) || (m.from_user === me && m.to_user === msgRecipient));
        bodyEl.innerHTML = conv.length ? conv.map(m => { const mine = m.from_user === me; return `<div class="msg-bubble ${mine ? 'msg-mine' : 'msg-theirs'}"><div class="msg-name">${mine ? '我' : (m.from_name || m.from_user)}</div>${m.text}<span class="msg-time">${m.time}</span></div>`; }).join('') : '<div class="msg-chat-empty">还没有消息，说点什么吧</div>';
        bodyEl.scrollTop = bodyEl.scrollHeight;
    }
}
window.selectMsgRecipient = function(u) { msgRecipient = u; renderMessageChat(); };
// 论坛好友点击 → 打开论坛私信对话
window.openForumChat = function(u) {
    backToProfile();
    const tab = document.querySelector('.profile-tab[data-tab="messages"]');
    if (tab) tab.click();
    msgRecipient = u;
    renderMessageChat();
};
window.removeFriend = async function(name) {
    forumFriends = forumFriends.filter(f => f !== name);
    safeSet('darkalley_friends', forumFriends);
    if (cloudApiBase() && window.currentUser) await cloudRequest('/api/friends', { friend: name }, 'DELETE');
    renderForumProfile();
};
document.getElementById('addFriendBtn').addEventListener('click', async () => {
    if (!window.currentUser) { alert('请先登录'); openAwakenModal(); return; }
    const name = safePrompt('输入好友用户名：');
    if (!name || !name.trim()) return;
    const n = name.trim();
    if (forumFriends.includes(n)) return alert('已是好友');
    sendFriendRequest(n);
    renderForumProfile();
});
document.getElementById('sendMessageBtn').addEventListener('click', async () => {
    if (!window.currentUser) { alert('请先登录'); openAwakenModal(); return; }
    if (!msgRecipient) return alert('请先选择收件人');
    const text = document.getElementById('messageContent').value.trim();
    if (!text) return;
    const to = msgRecipient;
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/messages', { to, text });
        if (r.ok && r.data.message) {
            forumMessages.push(r.data.message);
            safeSet('darkalley_messages', forumMessages);
            document.getElementById('messageContent').value = '';
            renderMessageChat(); return;
        }
        if (r.status !== 0) { alert(r.data.error || '发送失败'); return; }
    }
    forumMessages.push({ from_user: window.currentUser.username, from_name: currentIdentityName(), to_user: to, to_name: to, text, time: new Date().toLocaleString('zh-CN') });
    safeSet('darkalley_messages', forumMessages);
    document.getElementById('messageContent').value = '';
    renderMessageChat();
});
document.getElementById('messageContent').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sendMessageBtn').click(); } });

// ============ 🗑 我的帖子管理（删除 / 编辑，云端） ============
window.deleteMyPost = async function(id) {
    if (!confirm('确定删除这篇帖子吗？')) return;
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/posts', { id }, 'DELETE');
        if (r.ok) {
            forumPosts = forumPosts.filter(p => p.id !== id);
            cloudPosts = cloudPosts.filter(p => p.id !== id);
            savePosts(); renderPostList(); renderForumProfile(); return;
        }
        if (r.status !== 0) { alert(r.data.error || '删除失败'); return; }
    }
    forumPosts = forumPosts.filter(p => p.id !== id);
    cloudPosts = cloudPosts.filter(p => p.id !== id);
    savePosts(); renderPostList(); renderForumProfile();
};
window.editMyPost = async function(id) {
    const post = forumPosts.find(p => p.id === id);
    if (!post) return;
    const title = prompt('修改标题：', post.title); if (title === null) return;
    const content = prompt('修改内容：', post.content); if (content === null) return;
    if (!title.trim() || !content.trim()) return alert('标题和内容不能为空');
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/posts', { id, title: title.trim(), content: content.trim() }, 'PUT');
        if (r.ok) {
            post.title = title.trim(); post.content = content.trim();
            savePosts(); renderPostList(); renderForumProfile(); return;
        }
        if (r.status !== 0) { alert(r.data.error || '修改失败'); return; }
    }
    post.title = title.trim(); post.content = content.trim();
    savePosts(); renderPostList(); renderForumProfile();
};

// ============ ✎ 更换头像（emoji 或上传图片，云端保存） ============
const forumChangeAvatarBtn = document.getElementById('forumChangeAvatarBtn');
const forumAvatarTools = document.getElementById('forumAvatarTools');
const forumAvatarEmojiBtn = document.getElementById('forumAvatarEmojiBtn');
const forumAvatarUploadBtn = document.getElementById('forumAvatarUploadBtn');
const forumAvatarFile = document.getElementById('forumAvatarFile');
const forumAvatarEmojiInput = document.getElementById('forumAvatarEmoji');
if (forumChangeAvatarBtn && forumAvatarTools) forumChangeAvatarBtn.addEventListener('click', () => { forumAvatarTools.style.display = forumAvatarTools.style.display === 'none' ? 'flex' : 'none'; });
if (forumAvatarEmojiBtn) forumAvatarEmojiBtn.addEventListener('click', async () => {
    if (!window.currentUser) return alert('请先登录');
    const emoji = (forumAvatarEmojiInput.value || '').trim();
    if (!emoji) return alert('请输入 emoji');
    await saveAvatar(emoji);
});
if (forumAvatarUploadBtn && forumAvatarFile) forumAvatarUploadBtn.addEventListener('click', () => forumAvatarFile.click());
if (forumAvatarFile) forumAvatarFile.addEventListener('change', () => {
    const file = forumAvatarFile.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) { alert('请选择图片文件'); forumAvatarFile.value = ''; return; }
    if (file.size > 5 * 1024 * 1024) { alert('图片需小于 5MB'); forumAvatarFile.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (e) => openCropModal(e.target.result, async (out) => { await saveAvatar(out); forumAvatarFile.value = ''; });
    reader.readAsDataURL(file);
});

// —— 头像裁剪（拖动 + 滚轮缩放，中间方形输出 200x200）——
let __crop = { img: null, scale: 1, dx: 0, dy: 0, nw: 0, nh: 0, baseScale: 1, onDone: null };
function openCropModal(dataUrl, onDone) {
    const modal = document.getElementById('cropModal');
    const img = document.getElementById('cropImage');
    if (!modal || !img) return;
    __crop = { img, scale: 1, dx: 0, dy: 0, nw: 0, nh: 0, baseScale: 1, onDone };
    modal.style.display = 'flex';
    img.onload = () => {
        __crop.nw = img.naturalWidth; __crop.nh = img.naturalHeight;
        __crop.baseScale = Math.max(248 / __crop.nw, 248 / __crop.nh); // 初始保证覆盖 200 框+边距
        __crop.scale = __crop.baseScale;
        applyCropTransform();
    };
    img.src = dataUrl;
}
function applyCropTransform() {
    const { img, scale, dx, dy, nw, nh } = __crop;
    const w = nw * scale, h = nh * scale;
    img.style.width = w + 'px'; img.style.height = h + 'px';
    img.style.left = (130 - w / 2 + dx) + 'px';
    img.style.top = (130 - h / 2 + dy) + 'px';
}
function confirmCrop() {
    const modal = document.getElementById('cropModal');
    const { img, scale, dx, dy, nw, nh, onDone } = __crop;
    const w = nw * scale, h = nh * scale;
    const imgLeft = 130 - w / 2 + dx, imgTop = 130 - h / 2 + dy;
    // 裁剪框左上角相对 stage 的实际位置（居中 200x200 在 260x260 stage 内 → 30,30）
    const stageEl = document.getElementById('cropStage');
    const boxEl = document.querySelector('.crop-box');
    let boxLeft = 30, boxTop = 30;
    if (stageEl && boxEl) {
        const sr = stageEl.getBoundingClientRect();
        const br = boxEl.getBoundingClientRect();
        boxLeft = br.left - sr.left;
        boxTop = br.top - sr.top;
    }
    let sx = boxLeft - imgLeft, sy = boxTop - imgTop;
    sx = Math.max(0, Math.min(w - 200, sx)); sy = Math.max(0, Math.min(h - 200, sy));
    const sw = Math.min(200, w - sx), sh = Math.min(200, h - sy);
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 200;
    canvas.getContext('2d').drawImage(img, (sx / w) * nw, (sy / h) * nh, (sw / w) * nw, (sh / h) * nh, 0, 0, 200, 200);
    const out = canvas.toDataURL('image/jpeg', 0.85);
    modal.style.display = 'none';
    if (onDone) onDone(out);
}
function bindCropEvents() {
    const modal = document.getElementById('cropModal');
    const stage = document.getElementById('cropStage');
    const cancelBtn = document.getElementById('cropCancelBtn');
    const confirmBtn = document.getElementById('cropConfirmBtn');
    if (!modal || !stage || !cancelBtn || !confirmBtn) return;
    cancelBtn.addEventListener('click', () => { modal.style.display = 'none'; const f = document.getElementById('forumAvatarFile'); if (f) f.value = ''; });
    confirmBtn.addEventListener('click', confirmCrop);
    let dragging = false, psx = 0, psy = 0, odx = 0, ody = 0;
    stage.addEventListener('pointerdown', (e) => { dragging = true; psx = e.clientX; psy = e.clientY; odx = __crop.dx; ody = __crop.dy; if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) {} } });
    stage.addEventListener('pointermove', (e) => { if (!dragging) return; __crop.dx = odx + (e.clientX - psx); __crop.dy = ody + (e.clientY - psy); applyCropTransform(); });
    stage.addEventListener('pointerup', () => { dragging = false; });
    stage.addEventListener('pointercancel', () => { dragging = false; });
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.1 : 0.9; __crop.scale = Math.max(__crop.baseScale, Math.min(__crop.baseScale * 5, __crop.scale * f)); applyCropTransform(); }, { passive: false });
}
bindCropEvents();
async function saveAvatar(avatar) {
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/avatar', { avatar });
        if (r.ok) {
            window.currentUser.avatar = avatar;
            if (forumAvatarTools) forumAvatarTools.style.display = 'none';
            updateForumIdentityUI(); renderForumProfile(); return;
        }
        if (r.status !== 0) { alert(r.data.error || '头像保存失败'); return; }
    }
    window.currentUser.avatar = avatar;
    const users = getUsers();
    if (users[window.currentUser.username]) { users[window.currentUser.username].avatar = avatar; saveUsers(users); }
    if (forumAvatarTools) forumAvatarTools.style.display = 'none';
    updateForumIdentityUI(); renderForumProfile();
}
document.querySelectorAll('.profile-tab').forEach(tab => { tab.addEventListener('click', () => { document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); const t = tab.dataset.tab; ['overview','myposts','checkin','friends','messages'].forEach(k => { const el = document.getElementById(k + 'Panel'); if (el) el.style.display = k === t ? 'block' : 'none'; }); if (t === 'myposts' || t === 'checkin' || t === 'overview') renderForumProfile(); }); });
const quickCheckinBtn = document.getElementById('quickCheckinBtn');
if (quickCheckinBtn) quickCheckinBtn.addEventListener('click', () => { doCheckin(); renderForumProfile(); });
const quickNewPostBtn = document.getElementById('quickNewPostBtn');
if (quickNewPostBtn) quickNewPostBtn.addEventListener('click', () => { document.getElementById('forumProfileView').style.display = 'none'; document.getElementById('postListView').style.display = 'none'; document.getElementById('postDetailView').style.display = 'none'; document.getElementById('newPostForm').style.display = 'block'; });

// ============ 🚀【核心修复】管理员登录状态同步与管理按钮显示 ============
function updatePortalStatus() {
    if (window.currentUser) {
        document.getElementById('topUsername').textContent = window.currentUser.name;
        if (window.currentUser.isAdmin) {
            // 显示 [管理员] 标签
            document.getElementById('topAdminBadge').style.display = 'inline';
            // 🛠️ 修复：必须把 admin-only 按钮的 display 属性改掉，否则菜单里永远不会有【管理】
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'inline-block';
            });
        } else {
            document.getElementById('topAdminBadge').style.display = 'none';
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'none';
            });
        }
    } else {
        document.getElementById('topUsername').textContent = '---';
        document.getElementById('topAdminBadge').style.display = 'none';
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
    }
}

// ============ ☁️ 云端账号（腾讯云 CloudBase 云函数 + PostgreSQL） ============
// CloudBase HTTP 网关默认域名（路由 / → 云函数 api）；留空 = 纯本地模式
// 也可不改代码：运行后执行 localStorage.setItem('darkalley_cloud_api', '你的域名') 再刷新（优先级更高）
const CLOUD_API_BASE_DEFAULT = 'https://huaxu-account.y15390814204.workers.dev';
const CLOUD_TOKEN_KEY = 'darkalley_cloud_token';
function cloudApiBase() {
    // file:// 本地调试：Origin=null 被 CloudBase 网关 WEB 安全域名白名单拦截，无法跨域访问云端
    // 直接返回空走本地模式，避免每次登录/注册白等 6s 超时；线上 http(s) 部署不受影响
    if (location.protocol === 'file:') return '';
    return (localStorage.getItem('darkalley_cloud_api') || CLOUD_API_BASE_DEFAULT).replace(/\/+$/, '');
}
function cloudToken() { return localStorage.getItem(CLOUD_TOKEN_KEY); }
function setCloudToken(t) { if (t) localStorage.setItem(CLOUD_TOKEN_KEY, t); else localStorage.removeItem(CLOUD_TOKEN_KEY); }
async function cloudRequest(path, body, method) {
    const headers = {};
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    const tok = cloudToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
        const m = method || (body !== undefined && body !== null ? 'POST' : 'GET');
        const res = await fetch(cloudApiBase() + path, {
            method: m,
            headers,
            body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
            signal: ctrl.signal
        });
        const data = await res.json().catch(() => ({ error: '响应解析失败' }));
        return { ok: res.ok, status: res.status, data };
    } catch (e) {
        return { ok: false, status: 0, data: { error: '网络错误' } }; // status 0 = 连不上云端，交给本地兜底
    } finally { clearTimeout(timer); }
}
// 云端服务是否不可用（网络错 / 5xx / 函数不可用 / 余额不足）——此时应降级到本地兜底，保证本地账号可用
function cloudUnavailable(r) {
    if (!r || r.status === 0) return true;
    if (r.status >= 500) return true;
    const msg = String((r.data && (r.data.message || r.data.error)) || '');
    return /FUNCTIONS_INVOCATION_FAILED|InsufficientBalance|Function is Unavailable|Unavailable/i.test(msg);
}

// ============ 👤 统一账号系统（邀请码注册 / 身份绑定） ============
const INVITE_CODE = 'HX-2026';
const STAFF_OPTIONS = {
    'L-09-01-S': '苏晚眠', 'L-09-03-S': '沈绛离', 'L-09-02-X': '谢逢虚', 'L-09-04-W': '温泣语', 'L-09-05-L': '陆烬弦'
};
function getUsers() { return safeGetJSON('darkalley_users', {}); }
function saveUsers(u) { safeSet('darkalley_users', u); }
function getSessionUser() { return localStorage.getItem('darkalley_session'); }
function setSessionUser(u) { if (u) localStorage.setItem('darkalley_session', u); else localStorage.removeItem('darkalley_session'); }

// 登录：用户名 + 密码（云端优先，本地兜底）
async function attemptLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();
    const err = document.getElementById('loginError');
    err.textContent = '';
    // —— 云端优先 ——
    if (cloudApiBase()) {
        const r = await cloudRequest('/api/login', { username, pass });
        if (r.ok) {
            setCloudToken(r.data.token);
            doLogin({ username: r.data.user.username, name: r.data.user.roleName, isAdmin: !!r.data.user.isAdmin, type: r.data.user.type, staffId: r.data.user.staffId, avatar: r.data.user.avatar });
            return;
        }
        if (r.status === 401) { err.textContent = r.data.error || '[!] 用户名或密码错误'; return; }
        if (!cloudUnavailable(r)) { err.textContent = r.data.error || '[!] 登录失败'; return; }
        // 云端不可用（余额不足 / 函数不可用 / 网络错误）→ 落到本地兜底，保证本地账号可登录
    }
    // —— 本地兜底 ——
    let info = null;
    if (VALID_USERS[username] && VALID_USERS[username].pass === pass) {
        info = { username, name: VALID_USERS[username].name, isAdmin: !!VALID_USERS[username].isAdmin, type: 'staff', staffId: username, avatar: null };
    }
    if (!info) {
        const users = getUsers();
        const u = users[username];
        if (u && u.pass === pass) {
            info = { username, name: u.roleName || STAFF_OPTIONS[u.staffId] || username, isAdmin: false, type: u.type, staffId: u.staffId, avatar: u.avatar };
        }
    }
    if (!info) { err.textContent = '[!] 用户名或密码错误'; return; }
    doLogin(info);
}
function doLogin(info) {
    info.id = info.username; // 兼容旧代码里的 currentUser.id（= 账号名）
    window.currentUser = info;
    seedTestAccount(); // 测试管理员账号自动填充数据（登录 / 会话恢复时）
    setSessionUser(info.username);
    userLoginCounts[info.username] = (userLoginCounts[info.username] || 0) + 1; safeSet('xuju_logincounts', userLoginCounts);
    if (!userFavorites[info.username]) userFavorites[info.username] = {};
    if (!userHistory[info.username]) userHistory[info.username] = [];
    document.getElementById('awakenModal').style.display = 'none';
    document.getElementById('forumContainer').style.display = 'block';
    document.getElementById('terminalContainer').style.display = 'none';
    updateForumIdentityUI();
    applyForumSkin(getForumSkin());
    if (typeof renderForumProfile === 'function') renderForumProfile();
    renderPostList();
    if (cloudApiBase()) { loadCloudPosts(); loadCloudArchives(); loadCloudSocial(); loadCloudUsers(); loadCloudProfile(); loadCloudGroups(); } // 登录后同步云端帖子 + 档案 + 好友/私信 + 在线用户 + 签到/积分 + 群聊
}
// 注册：邀请码 + 用户名 + 密码 + 身份类型（自己带入 / 扮演觉醒者角色）——云端优先，本地兜底
function collectAwakeningForm() {
    const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const name = v('regAwakenName') || v('regAwakenSelfName') || '';
    return {
        name: name,
        gender: v('regAwakenGender'), age: v('regAwakenAge'), birthday: v('regAwakenBirth'),
        height: v('regAwakenHeight'), weight: v('regAwakenWeight'), identity: v('regAwakenIdentity'),
        anchorType: v('regAwakenAnchorType'), level: v('regAwakenLevel'), abilities: v('regAwakenAbilities'),
        appearance: v('regAwakenAppearance'), style: v('regAwakenStyle'),
        family: v('regAwakenFamily'), experience: v('regAwakenExperience'),
        traits: v('regAwakenTraits'), relations: v('regAwakenRelations'), item: v('regAwakenItem')
    };
}
async function registerAccount() {
    const invite = document.getElementById('regInvite').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const pass = document.getElementById('regPassword').value.trim();
    const roleType = (document.querySelector('input[name="regRoleType"]:checked') || {}).value || 'self';
    const err = document.getElementById('registerError');
    err.textContent = '';
    // 基础校验（本地快速反馈，云端也会再校验）
    if (invite !== INVITE_CODE) { err.textContent = '[!] 邀请码无效'; return; }
    if (!username || username.length < 2) { err.textContent = '[!] 用户名至少 2 个字符'; return; }
    if (!pass || pass.length < 4) { err.textContent = '[!] 密码至少 4 位'; return; }
    let roleName = username, staffId = null, avatar = null, awakening = null;
    if (roleType === 'self') {
        roleName = document.getElementById('regSelfName').value.trim() || username;
    } else {
        // 觉醒者：收集登记表
        awakening = collectAwakeningForm();
        roleName = awakening.name || document.getElementById('regAwakenName').value.trim() || username;
        if (!roleName || roleName === username) { err.textContent = '[!] 请填写角色名（觉醒者登记表）'; return; }
        avatar = document.getElementById('regAwakenAvatar').value.trim() || '🙂';
    }
    // —— 云端优先 ——
    if (cloudApiBase()) {
        const r = await cloudRequest('/api/register', { invite, username, pass, roleType, roleName, staffId, avatar, awakening });
        if (r.ok) {
            setCloudToken(r.data.token);
            doLogin({ username: r.data.user.username, name: r.data.user.roleName, isAdmin: !!r.data.user.isAdmin, type: r.data.user.type, staffId: r.data.user.staffId, avatar: r.data.user.avatar });
            return;
        }
        if (!cloudUnavailable(r)) { err.textContent = r.data.error || '[!] 注册失败'; return; }
        // 云端不可用（余额不足 / 函数不可用 / 网络错误）→ 落到本地兜底
    }
    // —— 本地兜底 ——
    const users = getUsers();
    if (users[username] || VALID_USERS[username]) { err.textContent = '[!] 用户名已被占用'; return; }
    users[username] = { pass, type: roleType, staffId, roleName, avatar, awakening, createdAt: Date.now() };
    saveUsers(users);
    err.textContent = '';
    doLogin({ username, name: roleName, isAdmin: false, type: roleType, staffId, avatar });
}
// 退出登录（回游客）
function logoutForum() {
    const tok = cloudToken();
    window.currentUser = null;
    setSessionUser(null);
    setCloudToken(null);
    if (cloudApiBase() && tok) { try { fetch(cloudApiBase() + '/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tok } }).catch(() => {}); } catch (e) {} }
    document.getElementById('terminalContainer').style.display = 'none';
    document.getElementById('forumContainer').style.display = 'block';
    updateForumIdentityUI();
    applyForumSkin(getForumSkin());
    if (typeof renderForumProfile === 'function') renderForumProfile();
    renderPostList();
}
// 进入终端（员工视角，保留）
function enterTerminal() {
    if (!window.currentUser) { openAwakenModal(); return; }
    document.getElementById('forumContainer').style.display = 'none';
    document.getElementById('terminalContainer').style.display = 'block';
    if (!terminalInited) setTimeout(initTerminal, 300);
    updatePortalStatus(); setupMiniTerminalPlayer();
}
function logoutTerminal() { document.getElementById('terminalContainer').style.display = 'none'; document.getElementById('forumContainer').style.display = 'block'; updatePortalStatus(); }
// 论坛身份 UI 刷新
function updateForumIdentityUI() {
    const elName = document.getElementById('forumUserName');
    const elSub = document.getElementById('forumUserSub');
    const elAvatar = document.getElementById('forumUserAvatar');
    const loginBtn = document.getElementById('forumLoginBtn');
    const logoutBtn = document.getElementById('forumLogoutBtn');
    const accLink = document.getElementById('forumAccountLink');
    if (window.currentUser) {
        if (elName) elName.textContent = window.currentUser.name;
        if (elSub) elSub.textContent = window.currentUser.type === 'awakened' ? '觉醒者 · 扮演角色' : (window.currentUser.type === 'staff' ? '编内 · 守夜人' : '自创角色');
        if (elAvatar) {
            applyAvatarFrame(elAvatar);
            const av = window.currentUser.avatar;
            if (av && /^(data:|https?:|\/)/.test(av)) {
                elAvatar.innerHTML = '<img src="' + av + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
            } else {
                elAvatar.textContent = av || (window.currentUser.type === 'staff' ? '☽' : '🙂');
            }
        }
        if (loginBtn) loginBtn.textContent = '◈ 进入终端';
        if (logoutBtn) logoutBtn.style.display = '';
        if (accLink) accLink.textContent = window.currentUser.name;
    } else {
        if (elName) elName.textContent = '匿名访客';
        if (elSub) elSub.textContent = '未登录 · 可浏览，不可发言';
        if (elAvatar) elAvatar.textContent = '☽';
        if (loginBtn) loginBtn.textContent = '☽ 登录 / 注册';
        if (logoutBtn) logoutBtn.style.display = 'none';
        if (accLink) accLink.textContent = '登录';
    }
    renderUserExp();
}
// 会话恢复（云端优先，本地兜底）
async function restoreSession() {
    // —— 云端优先：有 token 先验证 ——
    if (cloudApiBase() && cloudToken()) {
        const r = await cloudRequest('/api/me');
        if (r.ok) {
            const u = r.data.user;
            doLogin({ username: u.username, name: u.roleName, isAdmin: !!u.isAdmin, type: u.type, staffId: u.staffId, avatar: u.avatar });
            return;
        }
        if (r.status === 401) setCloudToken(null); // 会话过期，清掉 token
        // status 0 = 云端连不上 → 回退本地
    }
    // —— 本地兜底 ——
    const username = getSessionUser();
    if (!username) return;
    const users = getUsers();
    const u = users[username];
    if (u) {
        doLogin({ username, name: u.roleName || STAFF_OPTIONS[u.staffId] || username, isAdmin: false, type: u.type, staffId: u.staffId, avatar: u.avatar });
    } else if (VALID_USERS[username]) {
        doLogin({ username, name: VALID_USERS[username].name, isAdmin: !!VALID_USERS[username].isAdmin, type: 'staff', staffId: username, avatar: null });
    }
}

// 绑定事件
document.getElementById('loginBtn').addEventListener('click', attemptLogin);
document.getElementById('loginPassword').addEventListener('keypress', e => { if (e.key === 'Enter') attemptLogin(); });
document.getElementById('registerBtn').addEventListener('click', registerAccount);
document.getElementById('logoutTopBtn').addEventListener('click', logoutTerminal);
document.querySelectorAll('.login-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.getElementById('loginForm').style.display = tab.dataset.tab === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = tab.dataset.tab === 'register' ? 'block' : 'none';
}));
document.querySelectorAll('input[name="regRoleType"]').forEach(r => r.addEventListener('change', () => {
    const val = (document.querySelector('input[name="regRoleType"]:checked') || {}).value || 'self';
    const sw = document.getElementById('regSelfWrap'), aw = document.getElementById('regAwakenedWrap');
    if (sw) sw.style.display = val === 'self' ? 'block' : 'none';
    if (aw) aw.style.display = val === 'awakened' ? 'block' : 'none';
}));
function openAwakenModal() {
    document.getElementById('awakenModal').style.display = 'flex';
    const lu = document.getElementById('loginUsername'); if (lu) lu.focus();
}
// 「那扇门」：未登录 → 登录框；已登录 → 进终端
['awakenEntryBtn', 'awakenEntryFooter'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('click', e => { e.preventDefault(); if (window.currentUser) enterTerminal(); else openAwakenModal(); }); });
const forumAccountLink = document.getElementById('forumAccountLink');
if (forumAccountLink) forumAccountLink.addEventListener('click', e => { e.preventDefault(); if (window.currentUser) enterTerminal(); else openAwakenModal(); });
const forumLoginBtnEl = document.getElementById('forumLoginBtn');
if (forumLoginBtnEl) forumLoginBtnEl.addEventListener('click', () => { if (window.currentUser) enterTerminal(); else openAwakenModal(); });
const forumLogoutBtnEl = document.getElementById('forumLogoutBtn');
if (forumLogoutBtnEl) forumLogoutBtnEl.addEventListener('click', logoutForum);
document.getElementById('closeAwakenModalBtn').addEventListener('click', () => document.getElementById('awakenModal').style.display = 'none');

function showTerminalLoading(callback) {
    const loader = document.getElementById('terminalLoading');
    if (!loader) { if (callback) callback(); return; }
    const ring = document.getElementById('ringBar');
    const percentText = document.getElementById('percentText');
    const loadingText = document.getElementById('loadingText');
    const CIRC = 2 * Math.PI * 72;
    if (ring) { ring.style.strokeDasharray = CIRC; ring.style.strokeDashoffset = CIRC; }
    loader.style.display = 'flex';
    let progress = 0;
    const stages = [[0,'正在建立灵枢链接…'],[28,'校准锚点频率…'],[52,'注入认知屏蔽层…'],[74,'同步收容物库…'],[90,'链路稳定…']];
    const timer = setInterval(() => {
        progress += Math.floor(Math.random() * 6) + 4;
        if (progress > 100) progress = 100;
        if (ring) ring.style.strokeDashoffset = CIRC - (CIRC * progress / 100);
        if (percentText) percentText.textContent = progress + '%';
        const stage = stages.filter(s => progress >= s[0]).pop();
        if (stage && loadingText) loadingText.textContent = stage[1];
        if (progress >= 100) {
            clearInterval(timer);
            if (loadingText) loadingText.textContent = '链接完成';
            loader.classList.add('done');
            setTimeout(() => { loader.classList.remove('done'); loader.style.display = 'none'; if (callback) callback(); }, 480);
        }
    }, 150);
}

// ============ � 播放器音量控制（含静音记忆） ============
function bindPlayerVolume(audio, slider, toggle, storageKey) {
    if (!audio || !slider) return;
    const load = () => {
        let v = 0.3;
        try { const s = parseFloat(localStorage.getItem(storageKey)); if (!isNaN(s)) v = Math.max(0, Math.min(1, s)); } catch (e) {}
        audio.volume = v; slider.value = Math.round(v * 100);
        if (toggle) toggle.textContent = v <= 0 ? '🔇' : '🔊';
    };
    load();
    slider.addEventListener('input', () => {
        const v = slider.value / 100;
        audio.volume = v;
        try { localStorage.setItem(storageKey, String(v)); } catch (e) {}
        if (toggle) toggle.textContent = v <= 0 ? '🔇' : '🔊';
    });
    if (toggle) toggle.addEventListener('click', () => {
        if (audio.volume > 0) { audio.dataset.prevVol = audio.volume; audio.volume = 0; slider.value = 0; toggle.textContent = '🔇'; }
        else { const v = parseFloat(audio.dataset.prevVol || '0.3') || 0.3; audio.volume = v; slider.value = Math.round(v * 100); toggle.textContent = '🔊'; }
    });
}

// ============ 🕯 论坛鼠标烛火拖尾（仅桌面） ============
function initCursorCandle() {
    if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return;
    const forum = document.getElementById('forumContainer');
    if (!forum) return;
    let lastT = 0;
    forum.addEventListener('mousemove', (e) => {
        const now = Date.now();
        if (now - lastT < 40) return;
        lastT = now;
        const p = document.createElement('span');
        p.className = 'cursor-candle';
        const s = (3 + Math.random() * 6);
        p.style.left = (e.clientX - s / 2) + 'px';
        p.style.top = (e.clientY - s / 2) + 'px';
        p.style.width = p.style.height = s + 'px';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1400);
    });
}

// ============ �🛰 扫描数据角标时钟（主页地图卡 / 监测面板） ============
function startScanMeta() {
    const els = [document.getElementById('homeMapMeta'), document.getElementById('signalMapMeta')].filter(Boolean);
    if (!els.length) return;
    const fmt = (n) => String(n).padStart(2, '0');
    const tick = () => {
        const d = new Date();
        const t = fmt(d.getHours()) + ':' + fmt(d.getMinutes()) + ':' + fmt(d.getSeconds());
        const txt = 'LINK · ' + t + ' · STABLE';
        els.forEach(el => { el.textContent = txt; });
    };
    tick();
    if (window.__scanMetaTimer) clearInterval(window.__scanMetaTimer);
    window.__scanMetaTimer = setInterval(tick, 1000);
}
// ============ 🕒 论坛页脚实时时钟 ============
function startForumClock() {
    const el = document.getElementById('forumClock');
    if (!el) return;
    const fmt = (n) => String(n).padStart(2, '0');
    const tick = () => {
        const d = new Date();
        el.textContent = '· ' + fmt(d.getHours()) + ':' + fmt(d.getMinutes()) + ':' + fmt(d.getSeconds());
    };
    tick();
    if (window.__forumClockTimer) clearInterval(window.__forumClockTimer);
    window.__forumClockTimer = setInterval(tick, 1000);
}

// ============ 终端面板逻辑 ============
function initTerminal() {
    if (terminalInited) return;
    terminalInited = true; loadArchive(); saveLocalDataBundle(); bindTerminalNav(); startRain();
    startTypewriter(); renderLingshi(); renderInternalPosts(); renderMissions();
    loadCloudChat(); // 预加载云端聊天室
    applyTerminalTheme(safeGetJSON('darkalley_theme', 'default'));
    setupEditorEvents(); switchPanel('home'); renderHomeEmbed('bureau'); updateProfilePanel();
    document.getElementById('terminalFortuneText').textContent = getDailyFortune();
    startScanMeta();
}
window.switchPanel = function(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(name + 'Panel');
    if (panel) panel.classList.add('active');
    document.querySelectorAll('.nav-btn[data-panel]').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.nav-btn[data-panel="${name}"]`);
    if (btn) btn.classList.add('active');
    currentPanel = name;
    if (name === 'archive') {
        if (!Array.isArray(archiveData) || archiveData.length === 0) {
            loadArchive();
        }
        if (activeCategory === '行动记录') { showArchiveActions(); } else { renderArchiveList(); }
    }
    if (name === 'admin') renderAdminList();
    if (name === 'profile') { updateProfilePanel(); renderEquipPanel(); }
    if (name === 'lingshi') renderLingshi();
    if (name === 'internalForum') renderInternalPosts();
    if (name === 'missions') renderMissions();
    if (name === 'monitor') initMap();
    if (name === 'containment') renderContainmentList();
    if (name === 'commBoard') renderCommBoard();
    if (name === 'bureau') renderBureau();
    if (name === 'experiment') renderExperimentRecords();
    if (name === 'entities') renderEntities();
    if (name === 'collections') renderCollections();
    if (name === 'shop') renderShop();
}
function bindTerminalNav() {
    // 手机端导航收缩展开
    const navEl = document.querySelector('.main-nav');
    const collapseBtn = document.getElementById('navCollapseBtn');
    if (navEl && collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            navEl.classList.toggle('nav-open');
            collapseBtn.classList.toggle('open');
            const label = collapseBtn.querySelector('.nav-collapse-label');
            if (label) label.textContent = navEl.classList.contains('nav-open') ? '收起' : '菜单';
        });
    }
    document.querySelectorAll('.nav-btn[data-panel]').forEach(btn => btn.addEventListener('click', () => switchPanel(btn.dataset.panel)));
    document.querySelectorAll('.index-card').forEach(card => card.addEventListener('click', () => {
        if (card.dataset.panel) { renderHomeEmbed(card.dataset.panel); return; }
        const cat = card.dataset.cat; const tab = document.querySelector(`.cat-tab[data-category="${cat}"]`); if (tab) { tab.click(); switchPanel('archive'); }
    }));
    document.querySelectorAll('.cat-tab').forEach(tab => tab.addEventListener('click', () => {
        document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeCategory = tab.dataset.category || 'all';
        activeSubCategory = 'all';
        if (activeCategory === '行动记录') { showArchiveActions(); return; }
        renderArchiveList();
    }));
    document.getElementById('archiveSearchInput').addEventListener('input', renderArchiveList);
}

// ============ 档案检索、收容物、通讯等 ============
function loadArchive() {
    const saved = safeGetJSON('xuju_archive', null);
    const validCategories = new Set(['华墟管理档案', '华墟地理', '威胁评估档案', '人物档案', '事件记录', '收容物分支']);
    const normalizeArchiveItem = item => {
        if (!item || typeof item !== 'object') return null;
        const category = String(item.category || '');
        const keyCategory = category === '档案条例' || category === '华墟管理档案' ? '华墟管理档案'
            : category === '人物' || category === '人物档案' ? '人物档案'
            : category === '高危势力' || category === '威胁评估档案' ? '威胁评估档案'
            : category === '事件' || category === '事件记录' ? '事件记录'
            : category === '收容物' || category === '收容物分支' ? '收容物分支'
            : category;
        const normalized = { ...item, category: keyCategory };
        if (normalized.title && /^档案条例\s*·|^总则分支\s*·|^机制分支\s*·/.test(normalized.title)) {
            normalized.title = normalized.title.replace(/^档案条例\s*·/, '华墟管理档案 ·').replace(/^总则分支\s*·/, '华墟管理档案 · 总则分支 ·').replace(/^机制分支\s*·/, '华墟管理档案 · 机制分支 ·');
        }
        if (normalized.title && /^人物档案\s*·/.test(normalized.title) && normalized.category === '人物档案') {
            normalized.title = normalized.title.replace(/^人物档案\s*·/, '人物档案 ·');
        }
        if (normalized.title && /^(人物档案|档案条例|事件记录|收容物分支)/.test(normalized.title) && !validCategories.has(normalized.category)) {
            normalized.category = validCategories.has(normalized.category) ? normalized.category : '华墟管理档案';
        }
        return normalized;
    };
    const normalizedSaved = Array.isArray(saved) ? saved.map(normalizeArchiveItem).filter(Boolean) : [];
    const archiveIsClean = normalizedSaved.length > 0 && normalizedSaved.every(item => {
        if (!item || typeof item !== 'object') return false;
        if (!validCategories.has(item.category) || !item.title || !item.summary || !item.content) return false;
        const content = String(item.content || '');
        return !/(正文内容|整理自|\.docx)/i.test(content);
    });
    archiveData = archiveIsClean ? normalizedSaved : JSON.parse(JSON.stringify(DEFAULT_ARCHIVES));
    // 补全元数据：即使是从旧缓存读取的数据，也确保 image / subCategory / subtitle 与图片联动正确
    archiveData.forEach(item => {
        if (!item) return;
        const inferredImage = inferArchiveImage(item.title, item.category);
        const inferredSub = inferArchiveSubCategory(item.title, item.category);
        const inferredSubtitle = inferArchiveSubtitle(item.title, item.category, item.content || '');
        item.image = item.image || inferredImage;
        item.subCategory = item.subCategory || inferredSub;
        item.subtitle = item.subtitle || inferredSubtitle;
        if (item.category === '人物档案') item.image = inferredImage || '';
    });
    safeSet('xuju_archive', archiveData);
    safeSet('site_local_data_bundle', { exportAt: new Date().toISOString(), archiveData, forumPosts, featuredPosts });
}
function buildArchiveTree(items) {
    const tree = {};

    items.forEach(item => {
        const title = String(item.title || '');
        const parts = title.split(/\s*·\s*/).map(part => part.trim()).filter(Boolean);
        const docName = item.category || parts[0] || '未知档案';
        const chapterName = parts.length > 1 ? parts[1] : '总目录';
        const subName = parts.length > 2 ? parts.slice(2).join(' · ') : null;

        if (!tree[docName]) tree[docName] = {};
        if (!tree[docName][chapterName]) {
            tree[docName][chapterName] = { title: chapterName, items: [], children: {} };
        }

        const chapterBucket = tree[docName][chapterName];
        if (subName) {
            if (!chapterBucket.children[subName]) {
                chapterBucket.children[subName] = { title: subName, items: [] };
            }
            chapterBucket.children[subName].items.push(item);
        } else {
            chapterBucket.items.push(item);
        }
    });

    return tree;
}

function renderArchiveNodeItems(items, container) {
    items.forEach(item => {
        const node = document.createElement('div');
        node.className = 'archive-node';
        node.innerHTML = `
            <div class="archive-node-index">${item.id}</div>
            <div class="archive-node-main">
                <div class="archive-node-title">${item.title}</div>
                <div class="archive-node-summary">${item.summary}</div>
            </div>
        `;
        node.addEventListener('click', () => openArchiveDetail(item));
        container.appendChild(node);
    });
}

// 无配图档案的分类图标占位
function archiveCatIcon(cat) {
    const map = {
        '华墟管理档案': '📜',
        '华墟地理': '🗺️',
        '威胁评估档案': '🕯️',
        '人物档案': '👤',
        '事件记录': '📍',
        '收容物分支': '📦'
    };
    return map[cat] || '🗂';
}

function renderArchiveList() {
    if (!Array.isArray(archiveData) || archiveData.length === 0) {
        loadArchive();
    }
    if (activeCategory === '行动记录') { showArchiveActions(); return; }
    const searchInput = document.getElementById('archiveSearchInput');
    const container = document.getElementById('archiveContainer');
    if (!searchInput || !container) return;
    const actionView = document.getElementById('archiveActionView');
    if (container) container.style.display = '';
    if (actionView) actionView.style.display = 'none';

    const keyword = searchInput.value.trim().toLowerCase();
    let filtered = [...archiveData];

    if (activeCategory !== 'all') {
        filtered = filtered.filter(item => item.category === activeCategory);
    }

    if (activeSubCategory && activeSubCategory !== 'all') {
        filtered = filtered.filter(item => (item.subCategory || '概览') === activeSubCategory);
    }

    if (keyword) {
        filtered = filtered.filter(item => {
            const searchable = `${item.id} ${item.title} ${(item.tags || []).join(' ')} ${(item.summary || '')} ${(item.subtitle || '')} ${(item.content || '')}`.toLowerCase();
            return searchable.includes(keyword);
        });
    }

    let sidebar = document.getElementById('archiveSidebar');
    if (!sidebar) {
        sidebar = document.createElement('div');
        sidebar.id = 'archiveSidebar';
        sidebar.className = 'archive-sidebar';
        container.appendChild(sidebar);
    }

    let grid = document.getElementById('archiveGrid');
    if (!grid) {
        grid = document.createElement('div');
        grid.id = 'archiveGrid';
        container.appendChild(grid);
    }
    // 人物/威胁档案视图:有证件照的排前面(主角团最前),无图的往后排;卡片用紧凑四列布局
    if (activeCategory === '人物档案' || activeCategory === '威胁评估档案') {
        const heroOrder = ['L-09-01-S', 'L-09-02-X', 'L-09-03-S', 'L-09-04-W', 'L-09-05-L', 'L-09-06-N'];
        const hasImg = (x) => !!(x.image && String(x.image).trim());
        filtered.sort((a, b) => {
            const ia = hasImg(a) ? 1 : 0, ib = hasImg(b) ? 1 : 0;
            if (ia !== ib) return ib - ia;
            const ha = heroOrder.indexOf(a.id), hb = heroOrder.indexOf(b.id);
            if (ha !== -1 || hb !== -1) return (ha === -1 ? 999 : ha) - (hb === -1 ? 999 : hb);
            return String(a.id || '').localeCompare(String(b.id || ''));
        });
    }
    grid.className = 'archive-grid' + ((activeCategory === '人物档案' || activeCategory === '威胁评估档案') ? ' archive-grid--person' : '');

    container.innerHTML = '';
    container.appendChild(sidebar);
    container.appendChild(grid);

    sidebar.innerHTML = '';
    grid.innerHTML = '';

    const categories = Array.from(new Set((archiveData || []).map(item => item.category).filter(Boolean))).sort((a, b) => {
        const order = ['华墟管理档案', '华墟地理', '威胁评估档案', '人物档案', '事件记录', '收容物分支'];
        return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
    });

    categories.forEach(category => {
        // 数字用全量档案统计，不受当前搜索/分类过滤影响
        const totalCount = (archiveData || []).filter(item => item.category === category).length;
        const group = document.createElement('div');
        group.className = 'archive-nav-group';

        const categoryBtn = document.createElement('div');
        categoryBtn.className = 'archive-nav-item' + (activeCategory === category ? ' active' : '');
        categoryBtn.innerHTML = `<span class="archive-nav-cat">${category}</span><span class="archive-nav-count">${totalCount}</span>`;
        categoryBtn.addEventListener('click', () => {
            activeCategory = category;
            activeSubCategory = 'all';
            document.querySelectorAll('.cat-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.category === category));
            renderArchiveList();
        });

        const subList = document.createElement('div');
        subList.className = 'archive-nav-sublist';
        // 子分类基于该分类全部档案计算，避免被其他分类过滤影响
        const categoryAll = (archiveData || []).filter(item => item.category === category);
        const subOptions = Array.from(new Set(categoryAll.map(item => item.subCategory || '概览').filter(Boolean))).sort();

        if (subOptions.length) {
            subOptions.forEach(sub => {
                const subBtn = document.createElement('div');
                subBtn.className = 'archive-nav-subitem' + ((activeCategory === category && activeSubCategory === sub) ? ' active' : '');
                const subCount = categoryAll.filter(item => (item.subCategory || '概览') === sub).length;
                subBtn.innerHTML = `<span>${sub}</span><span class="archive-nav-count">${subCount}</span>`;
                subBtn.addEventListener('click', (event) => {
                    event.stopPropagation();
                    activeCategory = category;
                    activeSubCategory = sub;
                    document.querySelectorAll('.cat-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.category === category));
                    renderArchiveList();
                });
                subList.appendChild(subBtn);
            });
        }

        group.appendChild(categoryBtn);
        if (activeCategory === category) {
            group.appendChild(subList);
        }

        sidebar.appendChild(group);
    });

    if (!filtered.length) {
        grid.innerHTML = '<div class="archive-card" style="text-align:center;color:var(--text-muted);padding:20px;">没有匹配的档案。</div>';
        return;
    }

    filtered.forEach(item => {
        const card = document.createElement('div');
        card.className = 'archive-card-item';
        card.addEventListener('click', () => openArchiveDetail(item));

        const hasImg = item.image && String(item.image).trim() ? String(item.image).trim() : '';
        const tags = Array.isArray(item.tags) ? item.tags.slice(0, 3) : [item.subCategory || '档案'];
        const imgHtml = hasImg
            ? `<img class="archive-card-img" src="${hasImg}" alt="${item.title}" loading="lazy" decoding="async" onerror="this.style.display='none'">`
            : `<div class="archive-card-img archive-card-img-text"><span>${archiveCatIcon(item.category)}</span></div>`;

        card.innerHTML = `
            ${imgHtml}
            <div class="archive-card-body">
                <div class="archive-card-title">${item.title}</div>
                <div class="archive-card-summary">${item.summary || ''}</div>
                <div class="archive-card-tags">
                    ${(tags || []).map(tag => `<span class="archive-tag">${tag}</span>`).join('')}
                </div>
            </div>
        `;

        grid.appendChild(card);
    });
}

// ============ ⭐ 收藏分组系统 ============
let activeFavGroup = '默认';
function favGroups(uid) {
    if (!uid) return {};
    let fav = userFavorites[uid];
    if (!fav) fav = userFavorites[uid] = {};
    if (Array.isArray(fav)) { const arr = fav.slice(); fav = userFavorites[uid] = { '默认': arr }; }
    if (!fav['默认']) fav['默认'] = [];
    return fav;
}
function saveFav() { safeSet('xuju_favorites', userFavorites); }
function isFavorited(uid, id) {
    if (!uid || !id) return false;
    const fav = userFavorites[uid];
    if (!fav) return false;
    if (Array.isArray(fav)) return fav.includes(id);
    return Object.values(fav).some(a => Array.isArray(a) && a.includes(id));
}
function toggleFavorite(uid, id) {
    const fav = favGroups(uid);
    for (const g in fav) { const i = fav[g].indexOf(id); if (i > -1) { fav[g].splice(i, 1); saveFav(); return false; } }
    fav['默认'].push(id); saveFav(); return true;
}
function moveFav(uid, id, group) {
    const fav = favGroups(uid);
    for (const g in fav) { const i = fav[g].indexOf(id); if (i > -1) fav[g].splice(i, 1); }
    if (!fav[group]) fav[group] = [];
    if (fav[group].indexOf(id) === -1) fav[group].push(id);
    saveFav();
}
function favTitle(id) { const a = archiveData.find(x => x.id === id); if (a) return a.title; const p = forumPosts.find(x => x.id === id); if (p) return p.title; return id; }
function favType(id) { if (archiveData.find(x => x.id === id)) return '档'; if (forumPosts.find(x => x.id === id)) return '帖'; return '·'; }
function favBtnHtml(id, title) {
    const uid = window.currentUser ? window.currentUser.id : '';
    const on = isFavorited(uid, id);
    return `<button class="fav-btn${on ? ' fav-on' : ''}" data-fav-id="${id}" data-fav-title="${String(title || '').replace(/"/g, '&quot;')}" type="button">${on ? '★ 已收藏' : '☆ 收藏'}</button>`;
}
function bindFavBtn(scope) {
    if (!scope) return;
    scope.querySelectorAll('.fav-btn').forEach(b => {
        b.addEventListener('click', () => {
            const uid = window.currentUser ? window.currentUser.id : '';
            if (!uid) { alert('请先登录终端再收藏'); return; }
            const on = toggleFavorite(uid, b.dataset.favId);
            b.textContent = on ? '★ 已收藏' : '☆ 收藏';
            b.classList.toggle('fav-on', on);
            if (typeof updateProfilePanel === 'function') updateProfilePanel();
        });
    });
}
function renderFavGroupsPanel() {
    const uid = window.currentUser ? window.currentUser.id : '';
    const wrap = document.getElementById('favGroups');
    const listEl = document.getElementById('favList');
    if (!wrap || !listEl) return;
    const fav = favGroups(uid);
    const groups = Object.keys(fav);
    if (groups.indexOf(activeFavGroup) === -1) activeFavGroup = groups.length ? groups[0] : '默认';
    wrap.innerHTML = groups.map(function(g) { return '<button class="fav-group-tab' + (g === activeFavGroup ? ' active' : '') + '" data-g="' + escapeHtml(g) + '" type="button">' + escapeHtml(g) + '<small>' + (fav[g] || []).length + '</small></button>'; }).join('');
    const items = fav[activeFavGroup] || [];
    listEl.innerHTML = items.length ? items.map(id => '<div class="fav-item"><span class="fav-type">' + favType(id) + '</span><span class="fav-name">' + favTitle(id) + '</span><button class="fav-cmd" data-act="move" data-id="' + id + '" type="button">⇄</button><button class="fav-cmd" data-act="del" data-id="' + id + '" type="button">✕</button></div>').join('') : '<div class="fav-empty">该分组暂无收藏</div>';
    wrap.querySelectorAll('.fav-group-tab').forEach(b => b.addEventListener('click', function() { activeFavGroup = b.dataset.g; renderFavGroupsPanel(); }));
    listEl.querySelectorAll('.fav-cmd').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.id;
        if (b.dataset.act === 'del') {
            const fav = favGroups(uid); const i = fav[activeFavGroup].indexOf(id);
            if (i > -1) { fav[activeFavGroup].splice(i, 1); saveFav(); renderFavGroupsPanel(); }
        } else {
            const g = prompt('移动到分组：', activeFavGroup);
            if (g && g.trim()) { moveFav(uid, id, g.trim()); renderFavGroupsPanel(); }
        }
    }));
}
function openArchiveDetail(item) {
    addHistory(item.id);
    markRead('archive|' + item.id);
    const modal = document.getElementById('archiveDetailModal');
    const content = document.getElementById('archiveDetailContent');
    if (!modal || !content) return;

    const imagePath = item.image && String(item.image).trim() ? String(item.image).trim() : 'images/default-archive.jpg';
    const isPerson = item.category === '人物档案' || /人物档案/.test(item.title || '');
    const subtitle = item.subtitle || '';
    const personImgHtml = item.image && String(item.image).trim()
        ? `<img src="${imagePath}" alt="${item.title}" loading="lazy" decoding="async" style="width:200px; height:200px; object-fit:cover; border-radius:12px; border:1px solid var(--border-color); background:#111;" onerror="this.src='images/default-archive.jpg'">`
        : `<div class="archive-card-img archive-card-img-text" style="width:200px; height:200px; font-size:64px; border-radius:12px;"><span>${archiveCatIcon(item.category)}</span></div>`;
    const header = isPerson ? `
        <div style="display:flex; gap:16px; align-items:flex-start; margin-bottom:20px; padding-bottom:16px; border-bottom:1px solid var(--border-color);">
            ${personImgHtml}
            <div style="flex:1; min-width:0;">
                <h2 style="color:#fff; margin:0 0 8px;">${item.title}</h2>
                <div style="color:var(--text-muted); margin-bottom:8px;">${item.category}</div>
                <div style="color:var(--accent-red); font-weight:700; margin-bottom:6px;">${subtitle || item.subCategory || '档案'}</div>
                <div style="color:var(--text-secondary); font-size:0.9rem;">编号：${item.id}</div>
            </div>
        </div>
    ` : `
        <div style="border-bottom:1px solid var(--border-color);padding-bottom:15px;margin-bottom:15px;">
            <div style="display:flex; align-items:flex-start; gap:16px;">
                ${item.image ? `<img src="${imagePath}" alt="${item.title}" loading="lazy" decoding="async" style="width:200px; height:140px; object-fit:cover; border-radius:10px; border:1px solid var(--border-color); background:#111;" onerror="this.src='images/default-archive.jpg'">` : ''}
                <div style="flex:1; min-width:0;">
                    <h2 style="color:#fff; margin:0 0 8px;">${item.title}</h2>
                    <div style="color:var(--text-muted);">${item.category}</div>
                    ${item.subtitle ? `<div style="color:var(--accent-red); margin-top:6px; font-weight:700;">${item.subtitle}</div>` : ''}
                </div>
            </div>
        </div>
    `;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    // 终端实际滚动容器是 #terminalContainer（body 不滚动），必须同时锁定，否则滚轮会穿透到外部容器
    const tc = document.getElementById('terminalContainer');
    if (tc) tc.style.overflow = 'hidden';
    content.innerHTML = `${header}<div class="archive-fav-zone">${favBtnHtml(item.id, item.title)}</div><div style="line-height:1.7;color:var(--text-secondary);">${item.content}</div>`;
    bindFavBtn(content);
    // 断点续读：恢复上次阅读位置
    lastArchiveScrollId = item.id;
    const savedScroll = safeGetJSON('darkalley_archive_scroll', {});
    if (savedScroll[item.id]) { requestAnimationFrame(() => { content.scrollTop = savedScroll[item.id]; }); }
}
let lastArchiveScrollId = null;
function closeArchiveDetail() {
    const content = document.getElementById('archiveDetailContent');
    if (lastArchiveScrollId && content) {
        const saved = safeGetJSON('darkalley_archive_scroll', {});
        saved[lastArchiveScrollId] = content.scrollTop;
        safeSet('darkalley_archive_scroll', saved);
    }
    lastArchiveScrollId = null;
    document.getElementById('archiveDetailModal').style.display = 'none';
    document.body.style.overflow = '';
    const tc = document.getElementById('terminalContainer');
    if (tc) tc.style.overflow = '';
}
document.getElementById('closeArchiveDetailBtn').addEventListener('click', closeArchiveDetail);
document.getElementById('archiveDetailModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeArchiveDetail(); });
function addHistory(id) { if (!window.currentUser) return; const uid = window.currentUser.id; userHistory[uid] = [id, ...userHistory[uid].filter(x => x !== id)].slice(0, 20); safeSet('xuju_history', userHistory); }

function formatLevel(level) { const s = String(level || ''); const map = [ { k:'壬', label:'壬阶', cls:'lv-ren' }, { k:'辛', label:'辛阶', cls:'lv-xin' }, { k:'庚', label:'庚阶', cls:'lv-geng' }, { k:'己', label:'己阶', cls:'lv-ji' }, { k:'戊', label:'戊阶', cls:'lv-wu' }, { k:'丁', label:'丁阶', cls:'lv-ding' } ]; for (const m of map) { if (s.indexOf(m.k) !== -1) return { label: m.label, cls: m.cls }; } return { label: s || '未知', cls: 'lv-xin' }; }
function containmentSummary(item) { const raw = item.desc || item.appearance || ''; const text = String(raw).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); return text.length > 50 ? text.slice(0, 50) + '…' : text; }
function renderContainmentDetail(item) {
    if (!item) return '';
    const rows = [];
    const add = (label, val) => { if (val) rows.push(`<div class="cd-row"><span class="cd-label">${label}</span><div class="cd-value">${val}</div></div>`); };
    add('登记编号', item.id); add('定名', item.name); add('危险等级', formatLevel(item.level).label); add('类型', item.type); add('持有者', item.holder); add('来源', item.origin); add('形态描述', item.appearance); add('作用机制', item.mechanism); add('使用限制与禁忌', item.restrictions); add('关联事件', item.events); add('当前状态', item.status);
    if (item.notes) rows.push(`<div class="cd-row"><span class="cd-label">研究备注</span><div class="cd-value">${item.notes}</div></div>`);
    let html = rows.join('');
    if (item.story) { const paras = String(item.story).split('\n\n').filter(Boolean).map(p => `<p>${p}</p>`).join(''); html += `<div class="containment-story"><div class="story-title">📖 相关记录</div>${paras}</div>`; }
    const exps = (EXPERIMENT_RECORDS || []).filter(e => e.item && item.name && e.item.indexOf(item.name.split('（')[0]) !== -1);
    if (exps.length) {
        html += `<div class="containment-exp"><div class="containment-exp-head">🧪 实验记录（${exps.length}）</div><div class="containment-exp-list">` + exps.map(e => `
            <details class="containment-exp-details"><summary>${e.expNo} · ${e.purpose}</summary>
                <p><b>实验人员</b>：${e.personnel}</p><p><b>日期</b>：${e.date}</p>
                <div class="record-steps">${(e.steps || []).map(s => `<div class="record-step">${s}</div>`).join('')}</div>
                <p><b>结果</b>：${e.result}</p><p><b>结论</b>：${e.conclusion}</p><p class="record-notes">${e.notes}</p>
            </details>`).join('') + `</div></div>`;
    }
    return html;
}
function renderContainmentNotice() { const wrap = document.getElementById('containmentNotice'); if (!wrap) return; const items = CONTAINMENT_ITEMS || []; const redacted = items.filter(i => i.redacted).length; const latest = items.filter(i => !i.redacted).slice(-2).reverse(); const latestText = latest.map(i => `${i.name}（${i.id}·${formatLevel(i.level).label}）`).join('；'); wrap.innerHTML = `<span class="cn-ico">📢</span><span class="cn-text"><b>近期录入</b>：${latestText || '—'}；另有 <b class="blink">${redacted}</b> 份档案已加密，暂不可调阅。</span>`; }
function renderContainmentTypeTabs() { const wrap = document.getElementById('containmentCatTabs'); if (!wrap) return; const items = CONTAINMENT_ITEMS || []; const typeNames = [...new Set(items.map(i => (i.type || '未分类').split('（')[0].trim()))]; const all = ['全部'].concat(typeNames); wrap.innerHTML = all.map(t => { const key = t === '全部' ? 'all' : t; const count = key === 'all' ? items.length : items.filter(i => (i.type || '').split('（')[0].trim() === key).length; return `<button class="containment-cat-tab${activeContainmentType === key ? ' active' : ''}" data-type="${key}">${t}<small>${count}</small></button>`; }).join(''); wrap.querySelectorAll('.containment-cat-tab').forEach(btn => { btn.addEventListener('click', () => { activeContainmentType = btn.dataset.type; renderContainmentList(); }); }); }
function renderContainmentList() { const list = document.getElementById('containmentList'); if (!list) return; renderContainmentNotice(); renderContainmentTypeTabs(); let items = CONTAINMENT_ITEMS || []; if (activeContainmentType !== 'all') items = items.filter(i => (i.type || '未分类').split('（')[0].trim() === activeContainmentType); if (!items.length) { list.innerHTML = '<div class="containment-empty">该分类暂无收容物登记。</div>'; return; } list.innerHTML = items.map(item => { const lv = formatLevel(item.level); if (item.redacted) { return `
        <div class="containment-card containment-redacted" data-id="${item.id}">
            <div class="containment-head">
                <span class="containment-id">${item.id}</span>
                <span class="containment-level ${lv.cls}">${lv.label}</span>
            </div>
            <div class="containment-name">${item.name}</div>
            <div class="containment-summary redacted-bar">████ 档案内容已加密 · 需二级以上权限调阅 ████</div>
            <div class="containment-meta"><span>持有者：<span class="redacted">[已涂黑]</span></span><span>状态：${item.status || '密'}</span></div>
            <div class="containment-lock">🔒 该档案不可调阅</div>
        </div>`; } const hasDetail = !!(item.appearance || item.mechanism || item.restrictions || item.events || item.status || item.notes || item.story); return `
        <div class="containment-card" data-id="${item.id}">
            <div class="containment-head">
                <span class="containment-id">${item.id}</span>
                <span class="containment-level ${lv.cls}">${lv.label}</span>
            </div>
            <div class="containment-name">${item.name}</div>
            <div class="containment-summary">${containmentSummary(item)}</div>
            <div class="containment-meta"><span>持有者：${item.holder || '无'}</span><span>类型：${item.type || '未分类'}</span></div>
            ${hasDetail ? `<button class="containment-expand-btn" type="button">展开详情 ▾</button>
            <div class="containment-detail">${renderContainmentDetail(item)}</div>` : ''}
        </div>`; }).join('');
    list.querySelectorAll('.containment-expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const card = this.closest('.containment-card'); if (!card) return;
            const detail = card.querySelector('.containment-detail'); if (!detail) return;
            const isOpen = detail.classList.contains('open');
            list.querySelectorAll('.containment-card .containment-detail.open').forEach(d => { if (d !== detail) { d.classList.remove('open'); const b = d.closest('.containment-card') && d.closest('.containment-card').querySelector('.containment-expand-btn'); if (b) b.textContent = '展开详情 ▾'; } });
            if (isOpen) { detail.classList.remove('open'); this.textContent = '展开详情 ▾'; }
            else { detail.classList.add('open'); this.textContent = '收起详情 ▴'; try { detail.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
        });
    });
}
function renderCommBoard() {
    const list = document.getElementById('commPostList');
    if (!list) return;
    if (!INTERNAL_BOARDS || !INTERNAL_BOARDS.length) { list.innerHTML = '<div>暂无总局内部通讯。</div>'; return; }
    list.innerHTML = INTERNAL_BOARDS.map(item => `
        <div class="letter-card">
            <div class="letter-head">
                <span class="letter-secret${(item.secret || '内部') === '绝密' ? ' top' : ''}">【${item.secret || '内部'}】</span>
                <span class="letter-title">${item.title}</span>
                <span class="letter-dept">${item.dept || ''}</span>
            </div>
            <div class="letter-paper">
                <div class="letter-salute">呈：各司局 · 经办</div>
                <div class="letter-body">${item.content}</div>
                <div class="letter-footer">
                    <div class="letter-sign">${item.sender || item.dept}<br><span class="letter-date">${item.date || ''}</span></div>
                    <div class="letter-seal">${item.seal || item.dept}</div>
                </div>
            </div>
            <div class="letter-comment">✍ 【批注】${item.comment}</div>
        </div>`).join('');
}
function renderInternalPosts() { document.getElementById('internalPostList').innerHTML = internalPosts.slice().reverse().map(p => `<div class="admin-item" style="padding:10px;border-bottom:1px solid var(--border-color);"><span>${p.title}</span><small style="color:var(--text-muted);">${p.author}</small><button onclick="showInternalPostDetail('${p.id}')" style="color:var(--accent-red);float:right;border:1px solid var(--border-color);padding:2px 8px;">查看</button></div>`).join(''); }
window.showInternalPostDetail = function(id) { currentInternalPostId = id; const post = internalPosts.find(p => p.id === id); if (!post) return; document.getElementById('internalPostList').style.display = 'none'; document.getElementById('internalPostDetail').style.display = 'block'; document.getElementById('internalPostContent').innerHTML = `<h3>${post.title}</h3><div style="color:var(--text-muted);font-size:0.8rem;">${post.author} · ${post.timestamp}</div><p style="margin:15px 0;">${post.content}</p>${(post.comments||[]).map(c => `<div style="border-top:1px solid var(--border-color);padding:10px 0;"><strong>${c.user}</strong>: ${c.text}</div>`).join('')}`; };
document.getElementById('internalBackBtn').addEventListener('click', () => { document.getElementById('internalPostDetail').style.display = 'none'; document.getElementById('internalPostList').style.display = 'grid'; renderInternalPosts(); });
document.getElementById('internalNewPostBtn').addEventListener('click', () => { const title = safePrompt('标题：'); if (!title || !title.trim()) return; const content = safePrompt('内容：'); if (!content || !content.trim()) return; internalPosts.push({ id:'ip'+Date.now(), title: title.trim(), content: content.trim(), author: window.currentUser ? window.currentUser.name : '匿名', timestamp:new Date().toLocaleString('zh-CN'), comments:[] }); safeSet('xuju_internal_posts', internalPosts); renderInternalPosts(); });
document.getElementById('internalCommentBtn').addEventListener('click', () => { const text = document.getElementById('internalCommentInput').value.trim(); if (!text) return; const post = internalPosts.find(p => p.id === currentInternalPostId); if (!post) return; post.comments.push({ user: window.currentUser ? window.currentUser.name : '匿名', text, time:new Date().toLocaleString('zh-CN') }); safeSet('xuju_internal_posts', internalPosts); window.showInternalPostDetail(currentInternalPostId); });

function formatMissionLevel(risk) { const map = { red:'己阶', amber:'辛阶', blue:'壬阶', purple:'庚阶' }; const cls = { red:'lv-ji', amber:'lv-xin', blue:'lv-ren', purple:'lv-geng' }; return { label: map[risk] || '未定级', cls: cls[risk] || 'lv-xin' }; }
function renderMissions() {
    document.getElementById('missionsList').innerHTML = missions.map(m => {
        const ml = formatMissionLevel(m.risk);
        return `
        <div class="mission-item">
            <div class="mission-head">
                <div class="mission-title">${m.title}</div>
                <span class="mission-status">${m.status}</span>
            </div>
            <div class="mission-meta"><span class="mission-tag ${ml.cls}">${ml.label}</span>截止：${m.deadline}</div>
            ${m.dept ? `<div class="mission-dept">主管司局：<span class="dept-badge">${m.dept}</span></div>` : ''}
            <div class="mission-desc">${m.desc}</div>
        </div>
    `;
    }).join('');
}
// ============ 👥 好友社交（好友列表 + 好友群聊） ============
const INTERNAL_ROLE_NAMES = ['苏晚眠', '沈绛离', '谢逢虚', '温泣语', '陆烬弦']; // 内部角色账号（民俗社可见）
let friendGroups = safeGetJSON('darkalley_friend_groups', {}); // 本地兜底 { groupName: { members: [], createdAt } }
let groupChats = safeGetJSON('darkalley_group_chats', {}); // 本地兜底 { groupName: [ {user,text,time} ] }
let cloudGroups = []; // 云端群列表 [{name,members,owner,createdAt}]
let cloudGroupMessages = {}; // 云端群消息 { groupName: [{username,name,text,time}] }
let cloudGroupsLoaded = false;
function isInternalRole() {
    return !!window.currentUser && INTERNAL_ROLE_NAMES.indexOf(window.currentUser.name) !== -1;
}
function isInternalUsername(uname) {
    return !!uname && INTERNAL_ROLE_NAMES.indexOf(uname) !== -1;
}
// 渲染灵犀侧栏频道按钮 + 好友会话 + 好友群聊频道
function renderLingshiChannels() {
    const wrap = document.getElementById('lingshiChannels');
    if (!wrap) return;
    const baseChannels = [
        { ch: 'main', label: '总局' },
        { ch: 'operation', label: '外勤' }
    ];
    baseChannels.push({ ch: 'cloud', label: '云端 · 全球' });
    // 群频道：云端已加载优先云端群，否则本地兜底
    const groupNames = (cloudGroupsLoaded && window.currentUser) ? cloudGroups.map(g => g.name) : Object.keys(friendGroups || {});
    const chBtn = (c) => { const n = unreadOf(c); return `<button class="channel-btn${currentChannel === c ? ' active' : ''}" data-channel="${c}"># ${baseChannels.find(b => b.ch === c) ? baseChannels.find(b => b.ch === c).label : c}${n ? `<span class="ch-badge">${n > 99 ? '99+' : n}</span>` : ''}</button>`; };
    // 好友会话频道（微信式，终端显示实名/备注 + 头像 + 未读红点）
    const friendChs = forumFriends.map(f => {
        const nm = friendNameInTerminal(f);
        const av = friendAvatarOf(f);
        const avHtml = av ? `<img src="${av}" alt="">` : (nm || '友').slice(-1);
        const un = unreadOf('u_' + f);
        return `<button class="channel-btn friend-ch${currentChannel === 'u_' + f ? ' active' : ''}" data-channel="u_${f}"><span class="ch-avatar">${avHtml}</span><span class="ch-name">${nm}</span>${un ? `<span class="ch-badge">${un > 99 ? '99+' : un}</span>` : ''}</button>`;
    }).join('');
    const groupChs = groupNames.map(g => { const n = unreadOf('g_' + g); return `<button class="channel-btn${currentChannel === 'g_' + g ? ' active' : ''}" data-channel="g_${g}">👥 # ${g}${n ? `<span class="ch-badge">${n > 99 ? '99+' : n}</span>` : ''}</button>`; }).join('');
    const html = baseChannels.map(c => chBtn(c.ch)).join('')
        + (friendChs ? `<div class="bp-cat-label">👥 好友</div>` + friendChs : '')
        + (groupChs ? `<div class="bp-cat-label">👥 好友群聊</div>` + groupChs : '');
    wrap.innerHTML = html;
    // 重新绑定频道点击
    wrap.querySelectorAll('.channel-btn').forEach(btn => btn.addEventListener('click', () => {
        currentChannel = btn.dataset.channel;
        renderLingshi();
        if (currentChannel === 'cloud') loadCloudChat();
    }));
}
// 频道消息：微信群聊风格（方形头像 + 名字 + 气泡，自己消息靠右）
function chatMsgHtml(m) {
    const name = m.name || m.user || m.username || '未知';
    const time = m.time || '';
    const uname = m.username || (m.user && typeof m.user === 'string' ? m.user : '');
    const me = (window.currentUser || {}).username;
    const meName = (window.currentUser || {}).name;
    const mine = !!(m && ((m.username && m.username === me) || (m.from_user && m.from_user === me) || (m.user && m.user === meName)));
    let avUrl = null;
    if (uname) { const u = (cloudUsers || []).find(x => x.username === uname); if (u && u.avatar) avUrl = u.avatar; }
    const avHtml = (avUrl && /^(data:|https?:|\/)/.test(avUrl))
        ? `<img src="${avUrl}" class="chat-msg-avatar" alt="">`
        : `<div class="chat-msg-avatar chat-msg-avatar-fb">${(name || '?').slice(-1)}</div>`;
    return `<div class="chat-msg${mine ? ' chat-msg-mine' : ''}">${mine ? '' : avHtml}<div class="chat-msg-main"><div class="chat-msg-meta"><strong>${mine ? '我' : name}</strong><span>${time}</span></div><div class="chat-msg-bubble">${m.text}</div></div>${mine ? avHtml : ''}</div>`;
}
function renderLingshi() {
    const channelMap = {
        main: '总局',
        operation: '外勤',
        cloud: '云端 · 全球'
    };
    const el = document.getElementById('lingshiMessages');
    const headerEl = document.querySelector('.lingshi-header');
    const headerText = document.getElementById('lingshiHeaderText');
    const gdBtn = document.getElementById('lingshiGroupDetailBtn');
    renderLingshiChannels();
    if (gdBtn) gdBtn.style.display = 'none';
    if (currentChannel) { markConvRead(currentChannel); refreshUnread(); }
    // 好友群聊频道
    if (currentChannel && currentChannel.indexOf('g_') === 0) {
        const gname = currentChannel.slice(2);
        const head = `好友群聊 · ${gname}`;
        if (headerText) headerText.textContent = '# ' + head;
        if (gdBtn) gdBtn.style.display = 'inline-block';
        const msgs = (cloudGroupMessages[gname] || groupChats[gname] || []);
        el.innerHTML = msgs.length
            ? msgs.map(m => chatMsgHtml(m)).join('')
            : `<div class="chat-msg"><div class="chat-msg-avatar chat-msg-avatar-fb">系</div><div class="chat-msg-main"><div class="chat-msg-meta"><strong>系统</strong><span>--</span></div><div class="chat-msg-bubble">好友群聊「${gname}」创建成功，发一条消息吧。</div></div></div>`;
        el.scrollTop = el.scrollHeight;
        return;
    }
    // 好友私聊频道（微信风格：方形头像 + 气泡 + 已读）
    if (currentChannel && currentChannel.indexOf('u_') === 0) {
        const partner = currentChannel.slice(2);
        const me = (window.currentUser || {}).username;
        const partnerName = friendNameInTerminal(partner);
        if (headerText) headerText.textContent = '# 私聊 · ' + partnerName;
        const conv = forumMessages.filter(m => (m.from_user === partner && m.to_user === me) || (m.from_user === me && m.to_user === partner));
        const myAv = currentUserAvatar();
        const theirAv = friendAvatarOf(partner);
        const myNm = (window.currentUser && (window.currentUser.name || window.currentUser.username)) || '我';
        const dmAv = (av, nm) => (av && /^(data:|https?:|\/)/.test(av)) ? `<img src="${av}" class="dm-avatar" alt="">` : `<div class="dm-avatar dm-avatar-fb">${(nm || '?').slice(-1)}</div>`;
        el.innerHTML = conv.length ? conv.map(m => {
            const mine = m.from_user === me;
            const avHtml = mine ? dmAv(myAv, myNm) : dmAv(theirAv, partnerName);
            return `<div class="dm-row ${mine ? 'dm-row-mine' : 'dm-row-theirs'}">${mine ? '' : avHtml}<div class="dm-bubble ${mine ? 'dm-mine' : 'dm-theirs'}">${m.text}<span class="dm-meta"><span class="dm-time">${m.time}</span>${mine ? '<span class="dm-read">已读</span>' : ''}</span></div>${mine ? avHtml : ''}</div>`;
        }).join('') : `<div class="dm-empty">和 ${partnerName} 还没有私聊，发条消息吧。</div>`;
        el.scrollTop = el.scrollHeight;
        return;
    }
    if (headerText) headerText.textContent = `# ${channelMap[currentChannel] || '总局'}`;
    // 云端频道 = 全球共享聊天室
    if (currentChannel === 'cloud') {
        const msgs = cloudChatMessages;
        el.innerHTML = msgs.length
            ? msgs.map(m => chatMsgHtml(m)).join('')
            : `<div class="chat-msg"><div class="chat-msg-avatar chat-msg-avatar-fb">云</div><div class="chat-msg-main"><div class="chat-msg-meta"><strong>系统</strong><span>--</span></div><div class="chat-msg-bubble">云端频道 · 全球在线，发一条试试。</div></div></div>`;
        el.scrollTop = el.scrollHeight;
        return;
    }
    const msgs = lingshiMessages[currentChannel] || [];
    el.innerHTML = msgs.length
        ? msgs.map(m => chatMsgHtml(m)).join('')
        : `<div class="chat-msg"><div class="chat-msg-avatar chat-msg-avatar-fb">系</div><div class="chat-msg-main"><div class="chat-msg-meta"><strong>系统</strong><span>--</span></div><div class="chat-msg-bubble">该频道尚无消息，先发一条记录吧。</div></div></div>`;
    el.scrollTop = el.scrollHeight;
}
// 好友头像：优先云端论坛头像（cloudUsers 按 username 匹配），无则昵称首字兜底
function friendAvatarOf(uname) {
    const u = (cloudUsers || []).find(x => x.username === uname);
    if (u && u.avatar && /^(data:|https?:|\/)/.test(u.avatar)) return u.avatar;
    return null;
}
function friendDisplayOf(uname) { return accountNick(uname) || uname || '友'; }
function currentGroupNames() {
    if (cloudGroupsLoaded && window.currentUser) return cloudGroups.map(g => g.name);
    return Object.keys(friendGroups || {});
}
function groupMemberCount(gn) {
    if (cloudGroupsLoaded && window.currentUser) {
        const g = cloudGroups.find(x => x.name === gn);
        if (g) return (g.members || []).length;
    }
    const g = friendGroups[gn];
    return g ? (g.members || []).length : 0;
}
function renderSocialPanel() {
    const listEl = document.getElementById('socialFriendsList');
    const groupEl = document.getElementById('socialGroupList');
    const reqEl = document.getElementById('socialReqList');
    if (!listEl) return;
    const me = (window.currentUser || {}).username;
    // 好友申请（发给我的待处理）
    if (reqEl) {
        const pending = friendRequests.filter(r => r.status === 'pending' && r.to_user === me);
        reqEl.innerHTML = pending.length
            ? pending.map(r => `<div class="social-req-item"><span class="req-name">${friendNameInTerminal(r.from_user)}<small style="display:block;color:var(--text-muted);font-size:0.6rem;">${r.from_user}</small></span><span class="req-actions"><button class="accept" onclick="acceptFriend('${r.from_user.replace(/'/g,'')}')">通过</button><button onclick="declineFriend('${r.from_user.replace(/'/g,'')}')">拒绝</button></span></div>`).join('')
            : '<div class="social-empty">暂无好友申请</div>';
    }
    // 好友列表：终端显示实名/备注，可编辑备注，可删除
    listEl.innerHTML = forumFriends.length
        ? forumFriends.map(f => {
            const av = friendAvatarOf(f);
            const nm = friendNameInTerminal(f);
            const idSafe = f.replace(/[^a-zA-Z0-9_-]/g, '');
            const avHtml = av ? `<img src="${av}" class="social-avatar-img" alt="">` : `<div class="social-avatar">${(nm || '友').slice(-1)}</div>`;
            return `<div class="social-friend" onclick="openFriendChat('${f.replace(/'/g,'')}')">${avHtml}<span class="social-friend-name" title="${f}">${nm}<small style="display:block;color:var(--text-muted);font-size:0.58rem;">${friendDisplayOf(f)}</small></span><span class="social-note-edit"><input id="note_${idSafe}" placeholder="备注" value="${(friendNotes[f] || '').replace(/"/g, '&quot;')}" title="${f}" onclick="event.stopPropagation()"><button onclick="event.stopPropagation();editFriendNote('${f.replace(/'/g,'')}',document.getElementById('note_${idSafe}').value)">存</button><button onclick="event.stopPropagation();removeFriend('${f.replace(/'/g,'')}')">✕</button></span></div>`;
        }).join('')
        : '<div class="social-empty">暂无好友<br>输入用户名发好友申请</div>';
    const groupNames = currentGroupNames();
    const meU = (window.currentUser || {}).username || '';
    groupEl.innerHTML = groupNames.length
        ? groupNames.map(g => {
            const own = (cloudGroupsLoaded && window.currentUser)
                ? ((cloudGroups.find(x => x.name === g) || {}).owner || '')
                : '';
            const isOwner = own === meU;
            return `<div class="social-group-item" onclick="switchToGroup('${g.replace(/'/g,'')}')"><span>👥 ${g}${isOwner ? ' <em class="sg-owner">· 群主</em>' : ''}</span><small>${groupMemberCount(g)} 人</small>${isOwner ? `<button class="sg-del" onclick="event.stopPropagation();deleteGroup('${g.replace(/'/g,'')}')">删</button>` : ''}</div>`;
        }).join('')
        : '<div class="social-empty">暂无群聊<br>添加好友后点「创建群聊」</div>';
}
function switchToGroup(gname) {
    currentChannel = 'g_' + gname;
    if (typeof switchLingTab === 'function') switchLingTab('chats');
    renderLingshi();
}
// 打开群聊详情（QQ/微信式：右上角 ⋯ → 群主/成员/删除/退出）
window.openGroupDetail = function () {
    const gname = (currentChannel || '').indexOf('g_') === 0 ? currentChannel.slice(2) : '';
    if (!gname) return;
    const ov = document.getElementById('groupDetailOverlay');
    const nameEl = document.getElementById('gdGroupName');
    const ownerEl = document.getElementById('gdOwner');
    const listEl = document.getElementById('gdMemberList');
    const cntEl = document.getElementById('gdMemberCount');
    const delBtn = document.getElementById('gdDeleteBtn');
    const leaveBtn = document.getElementById('gdLeaveBtn');
    const closeBtn = document.getElementById('gdCloseBtn');
    nameEl.textContent = '👥 ' + gname;
    let members = [], owner = '';
    if (cloudGroupsLoaded && window.currentUser) {
        const g = (cloudGroups || []).find(x => x.name === gname);
        if (g) { members = g.members || []; owner = g.owner || ''; }
    } else {
        const g = (friendGroups || {})[gname];
        if (g) { members = g.members || []; }
    }
    ownerEl.textContent = owner ? friendNameInTerminal(owner) + '（' + owner + '）' : '未知';
    cntEl.textContent = members.length;
    listEl.innerHTML = members.map(m => {
        const nm = friendNameInTerminal(m);
        return `<div class="gd-member"><div class="gd-av">${(nm || '?').slice(-1)}</div><div class="gd-mi"><span class="gd-member-name">${nm}</span><small>${m}</small></div>${m === owner ? '<em class="gd-owner-tag">群主</em>' : ''}</div>`;
    }).join('') || '<div class="gd-empty">暂无成员</div>';
    const me = (window.currentUser || {}).username;
    const isOwner = !!(owner && me && owner === me);
    if (delBtn) delBtn.style.display = isOwner ? 'inline-block' : 'none';
    if (leaveBtn) leaveBtn.style.display = isOwner ? 'none' : 'inline-block';
    if (delBtn) delBtn.onclick = () => { ov.style.display = 'none'; deleteGroup(gname); };
    if (leaveBtn) leaveBtn.onclick = () => { ov.style.display = 'none'; leaveGroup(gname); };
    if (closeBtn) closeBtn.onclick = () => { ov.style.display = 'none'; };
    if (ov) ov.style.display = 'flex';
};
window.closeGroupDetail = function () {
    const ov = document.getElementById('groupDetailOverlay');
    if (ov) ov.style.display = 'none';
};
// 退出群聊（非群主；群主用删除）
window.leaveGroup = async function (name) {
    if (!window.currentUser) return alert('请先登录');
    if (!confirm('退出群聊「' + name + '」？')) return;
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/groups/leave', { name });
        if (r.ok) { await loadCloudGroups(); if (currentChannel === 'g_' + name) { currentChannel = ''; switchLingTab('chats'); } renderLingshi(); renderSocialPanel(); return; }
        if (r.status !== 0) { alert(r.data.error || '操作失败'); return; }
    }
    const g = friendGroups[name];
    if (g) { g.members = (g.members || []).filter(m => m !== (window.currentUser || {}).username); if (!g.members.length) delete friendGroups[name]; safeSet('darkalley_friend_groups', friendGroups); }
    if (currentChannel === 'g_' + name) { currentChannel = ''; switchLingTab('chats'); }
    renderSocialPanel(); renderLingshi();
};
// 点击好友 → 打开与该好友的气泡私聊（切到消息区）
window.openFriendChat = function(u) {
    if (!window.currentUser) return alert('请先登录');
    msgRecipient = u;
    currentChannel = 'u_' + u;
    if (typeof switchLingTab === 'function') switchLingTab('chats');
    if (cloudApiBase() && window.currentUser) loadCloudSocial();
    renderLingshi();
};
function localCreateGroup(n) {
    friendGroups[n] = { members: forumFriends.slice(), createdAt: Date.now() };
    groupChats[n] = groupChats[n] || [];
    safeSet('darkalley_friend_groups', friendGroups);
    safeSet('darkalley_group_chats', groupChats);
    renderSocialPanel();
    renderLingshi();
}
// 创建群聊：一键勾选好友（QQ 式）
function renderGroupFriendChecks() {
    const wrap = document.getElementById('socialGroupFriends');
    if (!wrap) return;
    wrap.innerHTML = forumFriends.length
        ? forumFriends.map(f => `<label class="social-gf-item"><input type="checkbox" value="${f.replace(/'/g, '')}"><span>${friendNameInTerminal(f)}</span><small>${f}</small></label>`).join('')
        : '<div class="social-empty">暂无好友可拉</div>';
}
function createFriendGroup() {
    if (!window.currentUser) return alert('请先登录');
    const form = document.getElementById('socialCreateGroupForm');
    if (!form) return;
    const show = form.style.display === 'none';
    form.style.display = show ? 'block' : 'none';
    if (show) renderGroupFriendChecks();
}
window.confirmCreateGroup = async function () {
    if (!window.currentUser) return alert('请先登录');
    const name = (document.getElementById('socialNewGroupName').value || '').trim();
    if (!name) return alert('请输入群聊名称');
    if (currentGroupNames().indexOf(name) !== -1) return alert('群聊已存在');
    const checked = [...document.querySelectorAll('#socialGroupFriends input:checked')].map(i => i.value);
    if (!checked.length) return alert('请至少勾选一位好友');
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/groups', { name, members: checked });
        if (r.ok) { document.getElementById('socialNewGroupName').value = ''; document.getElementById('socialCreateGroupForm').style.display = 'none'; await loadCloudGroups(); return; }
        if (r.status !== 0) { alert(r.data.error || '创建失败'); return; }
    }
    friendGroups[name] = { members: checked, createdAt: Date.now() };
    groupChats[name] = groupChats[name] || [];
    safeSet('darkalley_friend_groups', friendGroups); safeSet('darkalley_group_chats', groupChats);
    document.getElementById('socialNewGroupName').value = '';
    document.getElementById('socialCreateGroupForm').style.display = 'none';
    renderSocialPanel(); renderLingshi();
};
window.deleteGroup = async function (name) {
    if (!window.currentUser) return alert('请先登录');
    if (!confirm('删除群聊「' + name + '」？')) return;
    if (cloudApiBase() && window.currentUser) {
        const r = await cloudRequest('/api/groups', { name }, 'DELETE');
        if (r.ok) { await loadCloudGroups(); return; }
        if (r.status !== 0) { alert(r.data.error || '删除失败'); return; }
    }
    delete friendGroups[name]; delete groupChats[name];
    safeSet('darkalley_friend_groups', friendGroups); safeSet('darkalley_group_chats', groupChats);
    renderSocialPanel(); renderLingshi();
};
function bindSocialEvents() {
    // 灵犀分区 tab：💬 消息 / 👥 好友 / ✉️ 申请（QQ 式）
    const tabBtns = document.querySelectorAll('.lingshi-tab');
    window.switchLingTab = function (t) {
        tabBtns.forEach(b => b.classList.toggle('active', b.dataset.ltab === t));
        ['chats', 'friends', 'requests'].forEach(k => {
            const el = document.getElementById('lsec-' + k);
            if (el) el.style.display = (k === t) ? '' : 'none';
        });
        if (t === 'friends' || t === 'requests') renderSocialPanel();
    };
    tabBtns.forEach(b => b.addEventListener('click', () => switchLingTab(b.dataset.ltab)));
    const addBtn = document.getElementById('socialAddBtn');
    if (addBtn) addBtn.addEventListener('click', () => {
        const input = document.getElementById('socialAddInput');
        const name = input.value.trim();
        if (!name) return;
        sendFriendRequest(name);
        input.value = '';
    });
    const createBtn = document.getElementById('socialCreateGroupBtn');
    if (createBtn) createBtn.addEventListener('click', createFriendGroup);
    const confirmBtn = document.getElementById('socialConfirmGroupBtn');
    if (confirmBtn) confirmBtn.addEventListener('click', () => window.confirmCreateGroup());
    const groupHead = document.getElementById('socialGroupHead');
    if (groupHead) groupHead.addEventListener('click', toggleGroupList);
    // 群聊详情：右上角 ⋯ 入口
    const gdBtn = document.getElementById('lingshiGroupDetailBtn');
    if (gdBtn) gdBtn.addEventListener('click', () => window.openGroupDetail());
    // 点击弹层遮罩空白处关闭
    const gdOverlay = document.getElementById('groupDetailOverlay');
    if (gdOverlay) gdOverlay.addEventListener('click', e => { if (e.target === gdOverlay) window.closeGroupDetail(); });
    // 论坛顶部小邮件：点开个人主页私信
    const mailLink = document.getElementById('forumMailLink');
    if (mailLink) mailLink.addEventListener('click', e => {
        e.preventDefault();
        if (!window.currentUser) { openAwakenModal(); return; }
        backToProfile();
        const tab = document.querySelector('.profile-tab[data-tab="messages"]');
        if (tab) tab.click();
    });
}
bindSocialEvents();
// 云端好友群聊：加载我加入的群 + 各群消息（跨账号共享）
async function loadCloudGroups() {
    if (!cloudApiBase() || !window.currentUser) return;
    const r = await cloudRequest('/api/groups');
    if (!r.ok || !Array.isArray(r.data.groups)) return;
    cloudGroups = r.data.groups;
    cloudGroupsLoaded = true;
    for (const g of cloudGroups) {
        const h = await cloudRequest('/api/groups/history', { name: g.name });
        if (h.ok && Array.isArray(h.data.messages)) cloudGroupMessages[g.name] = h.data.messages;
    }
    // 同步到本地兜底（离线也能看到群名）
    const fb = {};
    cloudGroups.forEach(g => { fb[g.name] = { members: g.members, createdAt: g.createdAt }; });
    friendGroups = fb;
    safeSet('darkalley_friend_groups', friendGroups);
    refreshUnread();
    if (typeof renderSocialPanel === 'function') renderSocialPanel();
    if (typeof renderLingshiChannels === 'function') renderLingshiChannels();
    if (typeof renderLingshi === 'function') renderLingshi();
}
function toggleGroupList() {
    const head = document.getElementById('socialGroupHead');
    const list = document.getElementById('socialGroupList');
    const btn = document.getElementById('socialCreateGroupBtn');
    const form = document.getElementById('socialCreateGroupForm');
    if (!head) return;
    const collapsed = head.classList.toggle('collapsed');
    const arrow = head.querySelector('.sg-arrow');
    if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
    if (list) list.style.display = collapsed ? 'none' : '';
    if (btn) btn.style.display = collapsed ? 'none' : '';
    if (form) form.style.display = collapsed ? 'none' : form.style.display;
}
async function sendLingshiMessage() {
    const inputEl = document.getElementById('lingshiInput');
    const text = inputEl.value.trim();
    if (!text) return alert('请输入消息');
    if (!window.currentUser) return alert('请先登录');
    // 好友私聊频道 → 私信（云端优先，本地兜底）
    if (currentChannel && currentChannel.indexOf('u_') === 0) {
        const to = currentChannel.slice(2);
        if (cloudApiBase() && window.currentUser) {
            const r = await cloudRequest('/api/messages', { to, text });
            if (r.ok && r.data.message) {
                forumMessages.push(r.data.message);
                safeSet('darkalley_messages', forumMessages);
                renderLingshi();
                document.getElementById('lingshiInput').value = '';
                return;
            }
            if (r.status !== 0) { alert(r.data.error || '发送失败'); return; }
        }
        forumMessages.push({ from_user: window.currentUser.username, from_name: currentIdentityName(), to_user: to, to_name: to, text, time: new Date().toLocaleString('zh-CN') });
        safeSet('darkalley_messages', forumMessages);
        renderLingshi();
        document.getElementById('lingshiInput').value = '';
        return;
    }
    // 好友群聊频道 → 云端群聊（云端不可用时本地兜底）
    if (currentChannel && currentChannel.indexOf('g_') === 0) {
        const gname = currentChannel.slice(2);
        if (cloudApiBase() && cloudGroupsLoaded) {
            const r = await cloudRequest('/api/groups/messages', { name: gname, text });
            if (r.ok && r.data.message) {
                (cloudGroupMessages[gname] = cloudGroupMessages[gname] || []).push(r.data.message);
                renderLingshi();
                document.getElementById('lingshiInput').value = '';
                return;
            }
            if (r.status !== 0) { alert(r.data.error || '发送失败'); return; }
        }
        if (!groupChats[gname]) groupChats[gname] = [];
        groupChats[gname].push({ user: window.currentUser.name, text, time: new Date().toLocaleString('zh-CN') });
        safeSet('darkalley_group_chats', groupChats);
        renderLingshi();
        document.getElementById('lingshiInput').value = '';
        return;
    }
    // 云端频道 → 全球共享聊天室
    if (currentChannel === 'cloud') {
        if (!cloudApiBase()) return alert('云端频道需连接云端');
        const r = await cloudRequest('/api/chat', { text });
        if (r.ok && r.data.message) {
            cloudChatMessages.push(r.data.message);
            document.getElementById('lingshiInput').value = '';
            renderLingshi(); return;
        }
        if (r.status !== 0) { alert(r.data.error || '发送失败'); return; }
        return alert('云端频道需连接云端');
    }
    if (!lingshiMessages[currentChannel]) lingshiMessages[currentChannel] = [];
    lingshiMessages[currentChannel].push({ user: window.currentUser.name, text, time: new Date().toLocaleString('zh-CN') });
    safeSet('xuju_lingshi', lingshiMessages);
    renderLingshi();
    inputEl.value = '';
}
document.getElementById('lingshiSendBtn').addEventListener('click', sendLingshiMessage);
document.getElementById('lingshiInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendLingshiMessage(); } });
function updateProfilePanel() {
    if (!window.currentUser) return;
    document.getElementById('profileName').textContent = window.currentUser.name;
    document.getElementById('profileId').textContent = window.currentUser.id;
    // 终端个人面板头像：统一用账号头像（与论坛一致）
    const pAv = document.getElementById('profileAvatarImg');
    if (pAv) {
        const av = currentUserAvatar();
        pAv.src = (av && /^(data:|https?:|\/)/.test(av)) ? av : 'images/user-icon.png';
        pAv.style.display = '';
    }
    const uid = window.currentUser.id;
    const fav = favGroups(uid);
    const favorites = Object.values(fav).reduce((a, arr) => a.concat(arr), []);
    const history = userHistory[uid] || [];
    const completed = Math.min((missions || []).filter(m => m.status === '进行中' || m.status.includes('已')).length + 2, 9);
    document.getElementById('statMission').textContent = completed;
    document.getElementById('statFav').textContent = favorites.length;
    document.getElementById('statHistory').textContent = history.length;
    renderFavGroupsPanel();
    document.getElementById('historyList').innerHTML = history.length
        ? history.slice(0, 5).map(id => `<div>⏱ ${id}</div>`).join('')
        : '<div>暂无查看记录</div>';
}
function renderAdminList() {
    const archiveHtml = archiveData.map(a => `<div class="admin-item"><span>${a.id} ${a.title}</span><button onclick="editArchive('${a.id}')" style="color:var(--accent-red);">编辑</button></div>`).join('');
    const postHtml = forumPosts.slice().reverse().map(post => `<div class="admin-item"><span>${post.id} ${post.title}</span><button onclick="editForumPost('${post.id}')" style="color:var(--accent-red);">编辑</button></div>`).join('');
    document.getElementById('adminList').innerHTML = `
        <div style="margin-bottom:18px;">
            <h3 style="margin-bottom:10px; color:var(--text-muted); font-size:0.8rem; letter-spacing:0.1em; text-transform:uppercase;">档案库</h3>
            ${archiveHtml || '<div class="admin-item">暂无档案</div>'}
        </div>
        <div>
            <h3 style="margin-bottom:10px; color:var(--text-muted); font-size:0.8rem; letter-spacing:0.1em; text-transform:uppercase;">论坛帖子</h3>
            ${postHtml || '<div class="admin-item">暂无帖子</div>'}
        </div>
    `;
}
window.editArchive = function(id) { const item = archiveData.find(a => a.id === id); if (!item) return; editingId = id; document.getElementById('editId').value = item.id; document.getElementById('editTitle').value = item.title; document.getElementById('editCategory').value = item.category; document.getElementById('editTags').value = item.tags.join(', '); document.getElementById('editSummary').value = item.summary; document.getElementById('editContent').value = item.content; document.getElementById('modalTitle').textContent = '编辑: ' + id; document.getElementById('editModal').style.display = 'flex'; };
window.editForumPost = function(id) {
    const post = forumPosts.find(p => p.id === id);
    if (!post) return;
    document.getElementById('postEditTitle').value = post.title;
    document.getElementById('postEditBoard').value = post.board || '灵异见闻';
    document.getElementById('postEditImage').value = post.image || '';
    document.getElementById('postEditContent').value = post.content || '';
    document.getElementById('postModalTitle').textContent = '编辑帖子: ' + post.id;
    document.getElementById('postEditModal').dataset.postId = post.id;
    document.getElementById('postEditModal').style.display = 'flex';
};
async function saveEdit() { const newData = { id: document.getElementById('editId').value.trim(), title: document.getElementById('editTitle').value.trim(), category: document.getElementById('editCategory').value, tags: document.getElementById('editTags').value.split(',').map(s=>s.trim()).filter(s=>s), summary: document.getElementById('editSummary').value.trim(), content: document.getElementById('editContent').value.trim() }; if(!newData.id||!newData.title) return alert('必填'); if (cloudApiBase() && window.currentUser) { const r = await cloudRequest('/api/archives', newData, 'POST'); if (r.ok) { await loadCloudArchives(); } else if (r.status !== 0) { alert('云端保存失败：' + ((r.data && r.data.error) || '未知错误')); return; } } if(editingId) { const idx = archiveData.findIndex(a=>a.id===editingId); if(idx>-1) archiveData[idx]=newData; } else archiveData.push(newData); safeSet('xuju_archive', archiveData); document.getElementById('editModal').style.display='none'; renderAdminList(); renderArchiveList(); }
async function deleteArchive() { if(!editingId||!confirm('删除？')) return; const delId = editingId; if (cloudApiBase() && window.currentUser && isCloudArchive(delId)) { const r = await cloudRequest('/api/archives', { id: delId }, 'DELETE'); if (r.ok) { await loadCloudArchives(); } else if (r.status !== 0) { alert('云端删除失败：' + ((r.data && r.data.error) || '未知错误')); return; } } archiveData = archiveData.filter(a=>a.id!==delId); safeSet('xuju_archive', archiveData); document.getElementById('editModal').style.display='none'; renderAdminList(); renderArchiveList(); }
function saveForumPostEdit() {
    const postId = document.getElementById('postEditModal').dataset.postId;
    const title = document.getElementById('postEditTitle').value.trim();
    const board = document.getElementById('postEditBoard').value;
    const image = document.getElementById('postEditImage').value.trim();
    const content = document.getElementById('postEditContent').value.trim();
    if (!title || !content) return alert('请填写标题和正文');
    const idx = forumPosts.findIndex(p => p.id === postId);
    if (idx >= 0) {
        forumPosts[idx] = { ...forumPosts[idx], title, board, image: image || forumPosts[idx].image, content, timestamp: new Date().toLocaleString('zh-CN') };
    } else {
        forumPosts.unshift({ id: 'p' + Date.now(), title, board, image, content, author: forumNickname || '匿名', timestamp: new Date().toLocaleString('zh-CN'), comments: [] });
    }
    savePosts();
    renderFeaturedPosts();
    renderPostList();
    document.getElementById('postEditModal').style.display = 'none';
    renderAdminList();
}
function deleteForumPost() {
    const postId = document.getElementById('postEditModal').dataset.postId;
    if (!postId || !confirm('确认删除此帖子？')) return;
    forumPosts = forumPosts.filter(p => p.id !== postId);
    savePosts();
    renderFeaturedPosts();
    renderPostList();
    document.getElementById('postEditModal').style.display = 'none';
    renderAdminList();
}
function bulkInsertArchiveFromText() {
    const text = document.getElementById('bulkContentInput').value.trim();
    if (!text) return alert('没有内容可写入');
    const title = safePrompt('请输入新档案标题：') || '新档案';
    const category = safePrompt('请输入分类：世界观 / 人物 / 收容物 / 事件', '世界观') || '世界观';
    const summary = text.replace(/\s+/g, ' ').slice(0, 80) || '新导入文档';
    const paragraphs = text.split(/\n{2,}|\r\n\r\n+/).filter(Boolean).map(p => `<p>${escapeHtml(p.trim().replace(/\n/g, '<br>'))}</p>`).join('');
    archiveData.unshift({ id: `AUTO-${Date.now()}`, title, category, tags: [category], summary, content: paragraphs || `<p>${escapeHtml(text)}</p>` });
    safeSet('xuju_archive', archiveData);
    renderAdminList();
    renderArchiveList();
    document.getElementById('bulkContentInput').value = '';
}
async function importDocxToBulk() {
    const input = document.getElementById('docxImportInput');
    const file = input.files && input.files[0];
    if (!file) return;
    try {
        if (!window.mammoth || typeof window.mammoth.extractRawText !== 'function') {
            alert('文档解析库未加载成功，请刷新页面后重试。');
            return;
        }
        const result = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        const text = result.value.trim();
        if (!text) {
            alert('文档中没有可读取的正文内容。');
            return;
        }
        document.getElementById('bulkContentInput').value = text;
        alert('文档已导入，可直接写入档案或保存本地。');
    } catch (error) {
        console.error(error);
        alert('导入失败：' + error.message);
    } finally {
        input.value = '';
    }
}
function setupEditorEvents() {
    document.getElementById('saveEditBtn').addEventListener('click', saveEdit);
    document.getElementById('deleteArchiveBtn').addEventListener('click', deleteArchive);
    document.getElementById('closeModalBtn').addEventListener('click', ()=>document.getElementById('editModal').style.display='none');
    document.getElementById('addNewArchiveBtn').addEventListener('click', ()=>{ editingId=null; ['editId','editTitle','editTags','editSummary','editContent'].forEach(f=>document.getElementById(f).value=''); document.getElementById('editCategory').value='世界观'; document.getElementById('modalTitle').textContent='新增档案'; document.getElementById('editModal').style.display='flex'; });
    document.getElementById('managePostsBtn').addEventListener('click', () => { renderAdminList(); document.getElementById('adminPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    document.getElementById('importDocxBtn').addEventListener('click', () => document.getElementById('docxImportInput').click());
    document.getElementById('docxImportInput').addEventListener('change', importDocxToBulk);
    document.getElementById('createArchiveFromBulkBtn').addEventListener('click', bulkInsertArchiveFromText);
    document.getElementById('saveLocalDataBtn').addEventListener('click', () => { saveLocalDataBundle(); exportLocalDataBundle(); });
    document.getElementById('exportDataBtn').addEventListener('click', exportLocalDataBundle);
    document.getElementById('resetDefaultBtn').addEventListener('click', ()=>{ if(confirm('重置？')) { archiveData = JSON.parse(JSON.stringify(DEFAULT_ARCHIVES)); safeSet('xuju_archive', archiveData); renderAdminList(); renderArchiveList(); } });
    document.getElementById('insertImageBtn').addEventListener('click', ()=>{ const url = safePrompt('图片链接：'); if(url && url.trim()) document.getElementById('editContent').value += `<img src="${url.trim()}" style="max-width:200px;border:1px solid var(--border-color);margin:5px 0;">`; });
    document.getElementById('insertPostImageBtn').addEventListener('click', ()=>{ const url = safePrompt('图片链接：'); if(url && url.trim()) document.getElementById('postEditContent').value += `\n\n<img src="${url.trim()}" style="max-width:220px; border:1px solid var(--border-color); margin:10px 0;">`; });
    document.getElementById('savePostEditBtn').addEventListener('click', saveForumPostEdit);
    document.getElementById('deletePostEditBtn').addEventListener('click', deleteForumPost);
    document.getElementById('closePostEditBtn').addEventListener('click', ()=>document.getElementById('postEditModal').style.display='none');
    const dropZone = document.getElementById('imageDropZone'); const contentTA = document.getElementById('editContent'); ['dragenter','dragover'].forEach(ev=>dropZone.addEventListener(ev, e=>{ e.preventDefault(); dropZone.classList.add('dragover'); })); ['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev, e=>{ e.preventDefault(); dropZone.classList.remove('dragover'); })); dropZone.addEventListener('drop', e=>{ [...e.dataTransfer.files].forEach(file=>{ if(!file.type.startsWith('image/')) return; const reader = new FileReader(); reader.onload = ev => contentTA.value += `<img src="${ev.target.result}" style="max-width:200px;border:1px solid var(--border-color);margin:5px 0;">`; reader.readAsDataURL(file); }); });
}

// ============ 异常信号监测网（离线 SVG 网络图，替代 Leaflet 在线地图） ============
const SIGNAL_SITES = [
    { id:'a', name:'京兆府', level:'总局', status:'HQSCA 核心', time:'持续', desc:'华墟共和国首都，全域墟化现象管控总局总部驻地，全国监测中枢，八大司局常驻，能量基准恒定。' },
    { id:'b', name:'临川府', level:'观测', status:'民俗社', time:'持续', desc:'云江省省会，临川民俗研究社团活动区域，锚点能量平稳，标记为长期观测点位。' },
    { id:'c', name:'沧溟府', level:'辛', status:'模因污染', time:'2025-03-15', desc:'沿海港口城市，认知污染残留与"沧溟风暴"能量波形高度吻合，与沧溟-S级风暴事件同源，需持续追踪。' },
    { id:'d', name:'宁州府', level:'观测', status:'学术重镇', time:'持续', desc:'华墟学术重镇，玄理科研院分院驻地，收容物研究核心区，多处试验场能量读数稳定。' },
    { id:'e', name:'潭州府', level:'庚', status:'古墓遗址', time:'2024-08-11', desc:'玄水省省会，多处古墓遗址频发规则型墟域，外勤小队重点巡防区，夜间信号间歇波动。' },
    { id:'f', name:'丹霞府', level:'辛', status:'民俗禁忌', time:'2026-01-05', desc:'赤岭省省会，西南山区民俗保留完整，山野墟域事件频发，局地锚点能量偏高。' },
    { id:'g', name:'南荒岭', level:'绝危', status:'无人区警戒', time:'持续', desc:'西南无人区，己阶以上高危墟域多发区，禁止未授权进入，全局最高响应，探测阵列全天候运转。' },
    { id:'h', name:'沙洲府', level:'待核', status:'荒漠异常', time:'2026-02-01', desc:'戈壁省首府，西北荒漠深处多次侦测到异常能量残留，初步判定为收容物级，待现场核验。' }
];
function initMap() {
    const mapEl = document.getElementById('signalMap');
    if (!mapEl) return;
    const readout = document.getElementById('sigReadout');
    const siteList = document.getElementById('monitorSiteList');
    const selectSite = (site) => {
        if (!site) return;
        if (readout) {
            readout.innerHTML = `
                <div class="sig-readout-head">📍 ${site.name} · ${site.level}级异常</div>
                <div class="sig-readout-body">${site.desc}</div>
                <div class="sig-readout-meta">状态：${site.status} ｜ 记录：${site.time}</div>`;
        }
        mapEl.querySelectorAll('.sig-node').forEach(n => n.classList.remove('active'));
        const node = mapEl.querySelector(`.sig-node[data-site="${site.name}"]`);
        if (node) node.classList.add('active');
        if (siteList) {
            siteList.querySelectorAll('.monitor-site-item').forEach(item =>
                item.classList.toggle('active', item.dataset.site === site.name));
        }
    };
    mapEl.querySelectorAll('.sig-node').forEach(node => {
        node.addEventListener('click', () => {
            const site = SIGNAL_SITES.find(s => s.name === node.dataset.site);
            selectSite(site);
        });
    });
    // 生成华墟各分区监测站点清单
    if (siteList) {
        siteList.innerHTML = SIGNAL_SITES.map(site => `
            <button class="monitor-site-item" data-site="${site.name}">
                <span class="ms-dot"></span>
                <span class="ms-name">${site.name}</span>
                <span class="ms-tag">${site.level}</span>
            </button>`).join('');
        siteList.querySelectorAll('.monitor-site-item').forEach(item => {
            item.addEventListener('click', () => {
                const site = SIGNAL_SITES.find(s => s.name === item.dataset.site);
                selectSite(site);
            });
        });
    }
    // 默认高亮第一个节点，展示一条摘要
    if (SIGNAL_SITES.length) selectSite(SIGNAL_SITES[0]);
}

let rainAnimId = null; let glitchTimer = null;
function startRain() { const canvas = document.getElementById('rainCanvas'); if (!canvas) return; if(rainAnimId) { cancelAnimationFrame(rainAnimId); } const ctx = canvas.getContext('2d'); function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; } window.removeEventListener('resize', resizeCanvas); window.addEventListener('resize', resizeCanvas); resizeCanvas(); const drops = Array.from({length:150}, ()=>({x: Math.random()*canvas.width, y: Math.random()*canvas.height, speed: 4 + Math.random()*6, len: 8 + Math.random()*12})); function draw() { ctx.clearRect(0,0,canvas.width,canvas.height); ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1.5; ctx.beginPath(); drops.forEach(d=>{ ctx.moveTo(d.x,d.y); ctx.lineTo(d.x-1,d.y+d.len); d.y+=d.speed; if(d.y>canvas.height+20){ d.y=-20; d.x=Math.random()*canvas.width; } }); ctx.stroke(); rainAnimId = requestAnimationFrame(draw); } draw(); if(glitchTimer) clearInterval(glitchTimer); glitchTimer = setInterval(() => { const flash = document.getElementById('glitchFlash'); if(!flash) return; if(Math.random() < 0.03){ flash.style.background = 'rgba(207, 42, 42, 0.2)'; flash.style.width = (20 + Math.random()*80) + '%'; setTimeout(() => { flash.style.background = 'transparent'; flash.style.width = '100%'; }, 120); } }, 2000); }

const WELCOME_MESSAGES = [
    "欢迎登入，终端已连通，请注意安全。",
    "欢迎登入，认知污染监测正常。",
    "欢迎登入，底层数据重构完成。",
    "欢迎登入，屏蔽层生效，外部无法侦测。",
    "欢迎登入，终端界面加载完毕，开始工作吧。"
];
function startTypewriter() { const el = document.getElementById('typewriterText'); const msg = WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)]; el.textContent = ''; let i=0; const t = setInterval(() => { if(i<msg.length) { el.textContent += msg.charAt(i++); playTypeKey(); } else clearInterval(t); }, 60); }

// ============ ⌨️ 打字机音效 + 口令显隐 ============
let typeCtx = null;
function playTypeKey() {
    try {
        if (!typeCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; typeCtx = new AC(); }
        if (typeCtx.state === 'suspended') typeCtx.resume();
        const now = typeCtx.currentTime;
        const osc = typeCtx.createOscillator();
        const gain = typeCtx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(900 + Math.random() * 500, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
        osc.connect(gain); gain.connect(typeCtx.destination);
        osc.start(now); osc.stop(now + 0.03);
    } catch (e) {}
}
function bindPasswordToggle() {
    const input = document.getElementById('passwordInput');
    const btn = document.getElementById('pwdToggleBtn');
    if (!input || !btn) return;
    btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? '🙈' : '👁';
    });
    input.addEventListener('keydown', playTypeKey);
}
function bindTypeKeyInputs() {
    ['lingshiInput', 'internalCommentInput'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keydown', playTypeKey);
    });
}
// 全局点击提示音（极轻）
function playClick() {
    try {
        if (!typeCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; typeCtx = new AC(); }
        if (typeCtx.state === 'suspended') typeCtx.resume();
        const now = typeCtx.currentTime;
        const osc = typeCtx.createOscillator();
        const gain = typeCtx.createGain();
        osc.type = 'triangle'; osc.frequency.setValueAtTime(560 + Math.random() * 240, now);
        gain.gain.setValueAtTime(0.028, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.connect(gain); gain.connect(typeCtx.destination);
        osc.start(now); osc.stop(now + 0.05);
    } catch (e) {}
}
function bindClickSfx() {
    document.addEventListener('click', (e) => {
        const el = e.target && e.target.closest ? e.target.closest('button, a, .post-item, .collection-item, .archive-card-item, .nav-btn, .board-tab, .folk-entry, .index-card, .ncm-track, .game-option') : null;
        if (el) playClick();
    }, true);
}
// 时辰显示
function shiChenLabel() {
    const h = new Date().getHours();
    const arr = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
    return '☾ ' + arr[Math.floor(((h + 1) % 24) / 2)] + '时';
}

// ============ 🏛️ 总局八大司局 ============
function renderBureau() {
    const grid = document.getElementById('bureauDeptGrid');
    if (!grid) return;
    grid.innerHTML = (BUREAU_DEPARTMENTS || []).map(d => `
        <div class="bureau-dept-card" onclick="this.classList.toggle('open')">
            <div class="bureau-dept-head">
                <span class="bureau-dept-icon">${d.icon}</span>
                <div class="bureau-dept-info">
                    <div class="bureau-dept-name">${d.name}</div>
                    <div class="bureau-dept-id">${d.id}</div>
                </div>
                <span class="bureau-dept-arrow">▾</span>
            </div>
            <div class="bureau-dept-func">${d.func}</div>
            <div class="bureau-dept-status"><span class="status-dot"></span>${d.status}</div>
        </div>
    `).join('');
}

// ============ 🧪 实验记录（SCP 风格） ============
function experimentTag(rec) {
    const n = (rec.notes || '') + (rec.result || '');
    if (n.indexOf('事故') !== -1) return { label: '事故', cls: 'tag-accident' };
    if (n.indexOf('意外') !== -1) return { label: '意外', cls: 'tag-incident' };
    return { label: '正常', cls: 'tag-normal' };
}
function renderExperimentRecords() {
    const list = document.getElementById('experimentList');
    if (!list) return;
    const records = EXPERIMENT_RECORDS || [];
    list.innerHTML = records.map(rec => {
        const tag = experimentTag(rec);
        return `
        <div class="record-item">
            <div class="record-head">
                <span class="record-no">${rec.expNo}</span>
                <span class="record-item-name">${rec.item}</span>
                <span class="record-tag ${tag.cls}">${tag.label}</span>
            </div>
            <div class="record-meta"><span>实验人员：${rec.personnel}</span><span>日期：${rec.date}</span></div>
            <div class="record-purpose">目的：${rec.purpose}</div>
            <button class="record-expand-btn" type="button">展开实验详情 ▾</button>
            <div class="record-detail">
                <div class="record-block"><h4>实验过程</h4><div class="record-steps">${rec.steps.map(s => `<div class="record-step">${s}</div>`).join('')}</div></div>
                <div class="record-block"><h4>实验结果</h4><p>${rec.result}</p></div>
                <div class="record-block"><h4>结论</h4><p>${rec.conclusion}</p></div>
                <div class="record-block"><h4>备注</h4><p class="record-notes">${rec.notes}</p></div>
            </div>
        </div>`;
    }).join('');
    list.querySelectorAll('.record-expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const item = this.closest('.record-item'); if (!item) return;
            const detail = item.querySelector('.record-detail'); if (!detail) return;
            const isOpen = detail.classList.contains('open');
            list.querySelectorAll('.record-item .record-detail.open').forEach(d => {
                if (d !== detail) { d.classList.remove('open'); const b = d.closest('.record-item') && d.closest('.record-item').querySelector('.record-expand-btn'); if (b) b.textContent = '展开实验详情 ▾'; }
            });
            if (isOpen) { detail.classList.remove('open'); this.textContent = '展开实验详情 ▾'; }
            else { detail.classList.add('open'); this.textContent = '收起实验详情 ▴'; }
        });
    });
}

// ============ 👻 异化体图鉴 ============
function renderEntities() {
    const list = document.getElementById('entityList');
    if (!list) return;
    const entities = CONTAINMENT_ENTITIES || [];
    const cardHtml = (ent) => {
        const lv = formatLevel(ent.level);
        return `
        <div class="entity-card${ent.contained ? ' entity-contained' : ''}">
            <div class="entity-head">
                <span class="entity-id">${ent.id}</span>${ent.cat6 ? `<span class="entity-cat6">${ent.cat6}</span>` : ''}
                <span class="entity-level ${lv.cls}">${lv.label}</span>
                ${ent.contained ? '<span class="entity-held">在押</span>' : ''}
            </div>
            <div class="entity-name">${ent.name}<span class="entity-cls">${ent.cls}</span></div>
            <button class="entity-expand-btn" type="button">展开形态详情 ▾</button>
            <div class="entity-detail">
                <div class="entity-block"><h4>形态描述</h4><p>${ent.appearance}</p></div>
                <div class="entity-block"><h4>行为模式</h4><p>${ent.behavior}</p></div>
                <div class="entity-block"><h4>弱点</h4><ul class="entity-weak">${ent.weaknesses.map(w => `<li>${w}</li>`).join('')}</ul></div>
                <div class="entity-block"><h4>首次发现</h4><p>${ent.firstFound}</p></div>
                ${ent.containment ? `<div class="entity-block"><h4>收容状态</h4><p class="entity-related">⚠ 在押 · ${ent.containment}</p></div>` : ''}
                <div class="entity-block"><h4>关联收容物</h4><p class="entity-related">${ent.related}</p></div>
            </div>
        </div>`;
    };
    const held = entities.filter(e => e.contained);
    const free = entities.filter(e => !e.contained);
    let html = '';
    if (held.length) {
        html += `<div class="entity-group-title">⛓ 在押 · 收容中（${held.length}）</div>`;
        html += held.map(cardHtml).join('');
    }
    html += `<div class="entity-group-title">👁 在册 / 观测中（${free.length}）</div>`;
    html += free.map(cardHtml).join('');
    list.innerHTML = html;
    list.querySelectorAll('.entity-expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const card = this.closest('.entity-card'); if (!card) return;
            const detail = card.querySelector('.entity-detail'); if (!detail) return;
            const isOpen = detail.classList.contains('open');
            list.querySelectorAll('.entity-card .entity-detail.open').forEach(d => {
                if (d !== detail) { d.classList.remove('open'); const b = d.closest('.entity-card') && d.closest('.entity-card').querySelector('.entity-expand-btn'); if (b) b.textContent = '展开形态详情 ▾'; }
            });
            if (isOpen) { detail.classList.remove('open'); this.textContent = '展开形态详情 ▾'; }
            else { detail.classList.add('open'); this.textContent = '收起形态详情 ▴'; }
        });
    });
}

// ============ ⚔️ 收容行动记录 ============
function renderActionList(list) {
    if (!list) return;
    const records = ACTION_RECORDS || [];
    list.innerHTML = records.map(rec => {
        const relArchives = (rec.links || []).map(id => (archiveData || []).find(a => a.id === id)).filter(Boolean);
        const relHtml = relArchives.length ? `<div class="action-links">📎 关联档案：${relArchives.map(a => `<button class="action-link" data-id="${a.id}" type="button">${(a.title || a.id).replace(/^.+·\s*/, '')}</button>`).join('')}</div>` : '';
        return `
        <div class="action-item">
            <div class="action-head">
                <span class="action-id">${rec.id}</span>
                <span class="action-codename">行动代号「${rec.codename}」</span>
            </div>
            <div class="action-meta"><span>执行单位：${rec.unit}</span></div>
            <div class="action-meta"><span>行动日期：${rec.date}</span><span>地点：${rec.location}</span></div>
            ${relHtml}
            <button class="action-expand-btn" type="button">展开行动详情 ▾</button>
            <div class="action-detail">
                <div class="action-block"><h4>参与人员</h4><div class="action-members">${rec.members.map(m => `<span class="action-member">${m}</span>`).join('')}</div></div>
                <div class="action-block"><h4>行动目标</h4><p>${rec.objective}</p></div>
                <div class="action-block"><h4>行动背景</h4><p>${rec.background}</p></div>
                <div class="action-block"><h4>行动过程</h4><div class="action-timeline">${rec.timeline.map(t => `<div class="action-tl-item">${t}</div>`).join('')}</div></div>
                <div class="action-block"><h4>战斗损伤</h4><p>${rec.damage}</p></div>
                <div class="action-block"><h4>结论</h4><p>${rec.conclusion}</p></div>
                <div class="action-block"><h4>备注</h4><p class="action-notes">${rec.notes}</p></div>
            </div>
        </div>`;
    }).join('');
    list.querySelectorAll('.action-link').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const a = (archiveData || []).find(x => x.id === btn.dataset.id);
            if (a) openArchiveDetail(a);
        });
    });
    list.querySelectorAll('.action-expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const item = this.closest('.action-item'); if (!item) return;
            const detail = item.querySelector('.action-detail'); if (!detail) return;
            const isOpen = detail.classList.contains('open');
            list.querySelectorAll('.action-item .action-detail.open').forEach(d => {
                if (d !== detail) { d.classList.remove('open'); const b = d.closest('.action-item') && d.closest('.action-item').querySelector('.action-expand-btn'); if (b) b.textContent = '展开行动详情 ▾'; }
            });
            if (isOpen) { detail.classList.remove('open'); this.textContent = '展开行动详情 ▾'; }
            else { detail.classList.add('open'); this.textContent = '收起行动详情 ▴'; }
        });
    });
}
function showArchiveActions() {
    const container = document.getElementById('archiveContainer');
    const view = document.getElementById('archiveActionView');
    if (container) container.style.display = 'none';
    if (view) { view.style.display = 'block'; renderActionList(document.getElementById('archiveActionList')); }
}

// ============ ⌨️ 面板快捷键 + 主页内嵌切换 ============
const NAV_KEYMAP = { '1':'home','2':'monitor','3':'containment','4':'archive','5':'experiment','6':'entities','7':'lingshi','8':'profile' };
function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!NAV_KEYMAP[e.key]) return;
        const term = document.getElementById('terminalContainer');
        if (!term || term.style.display !== 'block') return;
        const tag = (e.target && e.target.tagName) || '';
        if (['INPUT','TEXTAREA','SELECT'].indexOf(tag) !== -1 || (e.target && e.target.isContentEditable)) return;
        switchPanel(NAV_KEYMAP[e.key]);
    });
}
function renderHomeEmbed(panel) {
    const embed = document.getElementById('homeEmbed');
    if (!embed) return;
    document.querySelectorAll('#homeIndexGrid .index-card').forEach(c => c.classList.toggle('active', c.dataset.panel === panel));
    const openBtn = (p, label) => `<button class="embed-open" data-panel="${p}">进入完整 ${label} →</button>`;
    let html = '';
    if (panel === 'bureau') {
        html = `<div class="embed-head"><span class="embed-title">🏛 总局架构 · 八大司局</span>${openBtn('bureau', '面板')}</div>
            <div class="bureau-dept-grid">${(BUREAU_DEPARTMENTS || []).map(d => `
                <div class="bureau-dept-card" onclick="this.classList.toggle('open')">
                    <div class="bureau-dept-head"><span class="bureau-dept-icon">${d.icon}</span><div class="bureau-dept-info"><div class="bureau-dept-name">${d.name}</div><div class="bureau-dept-id">${d.id}</div></div><span class="bureau-dept-arrow">▾</span></div>
                    <div class="bureau-dept-func">${d.func}</div>
                    <div class="bureau-dept-status"><span class="status-dot"></span>${d.status}</div>
                </div>`).join('')}</div>`;
    } else if (panel === 'commBoard') {
        html = `<div class="embed-head"><span class="embed-title">✉ 总局通讯</span>${openBtn('commBoard', '面板')}</div>
            <div class="embed-list">${(INTERNAL_BOARDS || []).map(item => `
                <div class="embed-item"><div class="embed-item-title">📌 ${item.title}${item.dept ? `<span class="dept-badge">${item.dept}</span>` : ''}</div>
                <div class="embed-item-body">${item.content}</div>
                <div class="embed-item-comment">✍ 【批注】${item.comment}</div></div>`).join('') || '<div class="embed-item">暂无通讯记录。</div>'}</div>`;
    } else if (panel === 'internalForum') {
        html = `<div class="embed-head"><span class="embed-title">▣ 司内议室</span>${openBtn('internalForum', '面板')}</div>
            <div class="embed-list">${(internalPosts || []).slice().reverse().map(p => `
                <div class="embed-item"><div class="embed-item-title">📌 ${p.title}</div>
                <div class="embed-item-meta">${p.author} · ${p.timestamp} · ${(p.comments || []).length} 条回复</div></div>`).join('') || '<div class="embed-item">暂无内部帖子。</div>'}</div>`;
    } else if (panel === 'missions') {
        html = `<div class="embed-head"><span class="embed-title">☒ 悬赏榜</span>${openBtn('missions', '面板')}</div>
            <div class="embed-list">${(missions || []).map(m => { const ml = formatMissionLevel(m.risk); return `
                <div class="embed-item"><div class="embed-item-title">📌 ${m.title}<span class="mission-tag ${ml.cls}">${ml.label}</span></div>
                <div class="embed-item-meta">截止：${m.deadline} · ${m.status}${m.dept ? ` · <span class="dept-badge">${m.dept}</span>` : ''}</div>
                <div class="embed-item-body">${m.desc}</div></div>`; }).join('') || '<div class="embed-item">暂无悬赏委托。</div>'}</div>`;
    }
    embed.innerHTML = html;
    embed.querySelectorAll('.embed-open').forEach(b => b.addEventListener('click', () => switchPanel(b.dataset.panel)));
}

// ============ 🎮 规则怪谈互动游戏（文游） ============
let gameSanity = 100;
function startGame() {
    gameSanity = 100;
    const s = document.getElementById('gameSanity'); if (s) s.textContent = '100';
    renderGameScene('start');
}
function closeGame() { setForumView('postListView'); renderPostList(); }
function renderGameScene(id) {
    const body = document.getElementById('gameBody');
    const scene = (GAME_SCENES || []).find(s => s.id === id);
    if (!body || !scene) return;
    const s = document.getElementById('gameSanity');
    if (s) s.textContent = Math.max(0, gameSanity);
    if (scene.isEnd) {
        if (scene.reward > 0) addPoints(scene.reward);
        body.innerHTML = `
            <div class="game-end game-end-${scene.endType || 'bad'}">
                <h2>${scene.title}</h2>
                <p class="game-end-desc">${scene.desc}</p>
                <p class="game-end-reward">${scene.reward > 0 ? '✦ 获得 ' + scene.reward + ' 积分' : '—— 黑夜将你吞没 ——'}</p>
                <div class="game-end-actions">
                    <button class="game-btn" id="gameRestartBtn" type="button">↺ 再玩一次</button>
                    <button class="game-btn ghost" id="gameEndCloseBtn" type="button">✕ 离开校园</button>
                </div>
            </div>`;
        const rb = document.getElementById('gameRestartBtn'); if (rb) rb.addEventListener('click', startGame);
        const eb = document.getElementById('gameEndCloseBtn'); if (eb) eb.addEventListener('click', closeGame);
        return;
    }
    body.innerHTML = `
        <div class="game-scene-head"><span class="game-scene-tag">${scene.isStart ? '序章' : '续'}</span><h2>${scene.title}</h2></div>
        <p class="game-desc">${scene.desc}</p>
        <div class="game-options">${scene.options.map((o, i) => `<button class="game-option" data-i="${i}" type="button"><span class="opt-num">${i + 1}</span><span class="opt-text">${o.text}</span></button>`).join('')}</div>`;
    body.querySelectorAll('.game-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const o = scene.options[+btn.dataset.i];
            gameSanity = Math.max(0, gameSanity + ((o.effect && o.effect.sanity) || 0));
            if (s) s.textContent = gameSanity;
            btn.classList.add('chosen');
            btn.disabled = true;
            const note = document.createElement('div');
            note.className = 'game-note';
            note.textContent = '◆ ' + (o.note || '');
            body.appendChild(note);
            setTimeout(() => {
                if (gameSanity <= 0) { renderGameScene('end_lost'); return; }
                renderGameScene(o.effect.goto);
            }, 1500);
        });
    });
}
function bindGameView() {
    const back = document.getElementById('gameBackBtn');
    if (back) back.addEventListener('click', closeGame);
    const rulesBtn = document.getElementById('gameRulesBtn');
    const rulesPanel = document.getElementById('gameRulesPanel');
    if (rulesBtn && rulesPanel) rulesBtn.addEventListener('click', () => {
        const open = rulesPanel.style.display !== 'none';
        rulesPanel.style.display = open ? 'none' : 'block';
        if (!open && !rulesPanel.dataset.filled) {
            rulesPanel.dataset.filled = '1';
            rulesPanel.innerHTML = `<div class="game-rules-head">📜 学生生存守则 · 全文</div>` + (GAME_RULES || []).map(r => `<div class="rule-line">${r}</div>`).join('');
        }
    });
}

// ============ 📚 合集系统（仅整合论坛帖子，论坛/终端共用渲染） ============
function markRead(key) { const set = safeGetJSON('darkalley_readset', {}); set[key] = true; safeSet('darkalley_readset', set); }
function isRead(key) { return !!safeGetJSON('darkalley_readset', {})[key]; }
function renderCollectionList(list) {
    if (!list) return;
    list.innerHTML = (STORY_COLLECTIONS || []).map(col => {
        const done = col.items.filter(it => isRead(it.type + '|' + it.id)).length;
        const total = col.items.length;
        const pct = Math.round(done / total * 100);
        return `
        <div class="collection-card">
            <div class="collection-head">
                <span class="collection-ico">${col.icon}</span>
                <div>
                    <div class="collection-title">${col.title}</div>
                    <div class="collection-desc">${col.desc}</div>
                </div>
            </div>
            <div class="collection-progress"><div class="collection-bar" style="width:${pct}%"></div></div>
            <div class="collection-meta">阅读进度 <b>${done}/${total}</b> · ${pct}%</div>
            <ul class="collection-items">${col.items.map(it => {
                const read = isRead(it.type + '|' + it.id);
                return `<li class="collection-item${read ? ' read' : ''}" data-type="${it.type}" data-id="${it.id}">
                    <span class="ci-state">${read ? '✔' : '○'}</span><span class="ci-title">${it.title}</span><span class="ci-tag">${it.type === 'post' ? '帖子' : '档案'}</span>
                </li>`;
            }).join('')}</ul>
        </div>`;
    }).join('');
    list.querySelectorAll('.collection-item').forEach(li => {
        li.addEventListener('click', () => {
            const type = li.dataset.type, id = li.dataset.id;
            if (type === 'post') { const p = forumPosts.find(x => x.id === id); if (p) showPostDetail(id); }
            else { const a = archiveData.find(x => x.id === id); if (a) openArchiveDetail(a); }
        });
    });
}
function renderCollections() { renderCollectionList(document.getElementById('collectionList')); }
function renderFolkCollections() { renderCollectionList(document.getElementById('folkCollectionList')); }

// ============ 🧪 测试管理员账号自动填充（本地调试用） ============
// 登录 HUAXU（管理员局长号）且从未填充过时，自动注入：满积分 + 全部商城物品 + 高等级经验 + 签到历史，
// 方便直接查看头像框 / 等级经验条 / 成就勋章效果。其他账号不受影响。
// 用独立标记 darkalley_seed_map 记录是否已填充（而不是用积分判断，避免云端积分同步后漏填物品/经验）。
function seedTestAccount(force) {
    if (!window.currentUser || window.currentUser.username !== 'HUAXU') return;
    const uid = window.currentUser.id; // = 'HUAXU'
    const seeded = safeGetJSON('darkalley_seed_map', {}) || {};
    if (!force && seeded[uid]) return; // 已填充过则跳过（避免覆盖用户手动改动）
    // ① 积分：至少 99999（取 max，云端同步后也不会低于此值）
    const points = safeGetJSON('darkalley_points_map', {}) || {};
    points[uid] = Math.max(points[uid] || 0, 99999);
    safeSet('darkalley_points_map', points);
    // ② 拥有全部商城物品（论坛商城 f1-f14 + 终端商城 t1-t11）
    const owned = safeGetJSON('darkalley_owned_map', {}) || {};
    owned[uid] = [...(FORUM_SHOP_ITEMS || []).map(i => i.id), ...(TERMINAL_SHOP_ITEMS || []).map(i => i.id)];
    safeSet('darkalley_owned_map', owned);
    // ③ 经验：2950 → Lv.30，经验条 50/100 便于查看进度
    const exp = safeGetJSON('darkalley_exp_map', {}) || {};
    exp[uid] = 2950;
    safeSet('darkalley_exp_map', exp);
    // ④ 签到历史：30 天连签（到昨天为止），今天可再签一次看效果（仅本地模式；云端以真实签到为准）
    if (!force) {
        const dates = [];
        for (let i = 30; i >= 1; i--) {
            const d = new Date(); d.setDate(d.getDate() - i);
            dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
        }
        checkinState = { streak: 30, total: 30, points: 500, lastDate: dates[dates.length - 1], dates };
        safeSet('darkalley_checkin', checkinState);
    }
    seeded[uid] = true;
    safeSet('darkalley_seed_map', seeded);
    console.log('[seedTestAccount] 已为 HUAXU 注入测试数据：积分 ≥99999 / 全部商城物品 / 经验 2950(Lv.30) / 签到 30 天');
}
// ============ 🛒 积分商城（论坛商城 + 终端商城分离） ============
// 积分/拥有状态按账号存储：论坛游客 → guest，终端员工 → 各自编号（如 ADMIN-001）
function getPoints() {
    let m = safeGetJSON('darkalley_points_map', null);
    if (!m) { const legacy = parseInt(safeGetJSON('darkalley_points', 0), 10) || 0; m = { guest: legacy }; safeSet('darkalley_points_map', m); }
    const uid = window.currentUser ? window.currentUser.id : 'guest';
    return m[uid] || 0;
}
function addPoints(n) {
    const m = safeGetJSON('darkalley_points_map', {}) || {};
    const uid = window.currentUser ? window.currentUser.id : 'guest';
    m[uid] = Math.max(0, (m[uid] || 0) + (n || 0));
    safeSet('darkalley_points_map', m);
    // 云端同步（账号级积分，跨设备；fire-and-forget，连不上不影响本地）
    if (cloudApiBase() && window.currentUser && n) {
        cloudRequest('/api/points', { delta: n }).then(r => {
            if (r.ok && r.data && r.data.points !== undefined) {
                const mm = safeGetJSON('darkalley_points_map', {}) || {};
                mm[uid] = r.data.points;
                safeSet('darkalley_points_map', mm);
            }
        }).catch(() => {});
    }
    return m[uid];
}
function addPointsFor(uid, n) {
    const m = safeGetJSON('darkalley_points_map', {}) || {};
    m[uid] = (m[uid] || 0) + (n || 0);
    safeSet('darkalley_points_map', m);
}
// —— 论坛经验 / 等级系统 ——
function getExpMap() { return safeGetJSON('darkalley_exp_map', {}); }
function getExp() { const m = getExpMap(); const uid = window.currentUser ? window.currentUser.id : 'guest'; return m[uid] || 0; }
function addExp(n) {
    const m = getExpMap();
    const uid = window.currentUser ? window.currentUser.id : 'guest';
    m[uid] = (m[uid] || 0) + n;
    safeSet('darkalley_exp_map', m);
    renderUserExp();
}
function userLevel(exp) { return Math.min(50, Math.floor((exp || 0) / 100) + 1); }
function renderUserExp() {
    const row = document.getElementById('userExpRow');
    if (!row) return;
    if (!window.currentUser) { row.style.display = 'none'; return; }
    const exp = getExp();
    const lv = userLevel(exp);
    const cur = exp % 100, pct = Math.round((cur / 100) * 100);
    row.style.display = '';
    const lvEl = document.getElementById('userLvText'); if (lvEl) lvEl.textContent = 'Lv.' + lv;
    const fill = document.getElementById('userExpFill'); if (fill) fill.style.width = pct + '%';
    const num = document.getElementById('userExpNum'); if (num) num.textContent = cur + '/100';
    const cl = document.getElementById('checkinLevel'); if (cl) cl.textContent = 'Lv.' + lv;
}
function getOwned() {
    let o = safeGetJSON('darkalley_owned_map', null);
    if (!o) { const legacy = safeGetJSON('darkalley_owned', []); o = { guest: Array.isArray(legacy) ? legacy : [] }; safeSet('darkalley_owned_map', o); }
    const uid = window.currentUser ? window.currentUser.id : 'guest';
    return o[uid] || [];
}
// 当前生效的头像框（优先用户手动指定 darkalley_frame，否则最后购买的；未拥有则无）
function activeAvatarFrame() {
    const owned = getOwned();
    const frames = (FORUM_SHOP_ITEMS || []).filter(it => it.cat === '头像框' && it.frameCls && owned.includes(it.id));
    if (!frames.length) return null;
    const chosen = safeGetJSON('darkalley_frame', '');
    if (chosen && frames.some(f => f.id === chosen)) return frames.find(f => f.id === chosen);
    return frames[frames.length - 1];
}
function setActiveFrame(id) {
    safeSet('darkalley_frame', id || '');
    if (typeof updateForumIdentityUI === 'function') updateForumIdentityUI();
    if (typeof renderForumProfile === 'function') renderForumProfile();
    if (typeof renderEquipPanel === 'function') renderEquipPanel();
    if (typeof renderForumBackpack === 'function') renderForumBackpack();
}
function applyAvatarFrame(el) {
    if (!el) return;
    el.classList.remove('frame-fr-grey', 'frame-fr-red', 'frame-fr-gold', 'frame-fr-dark');
    const frame = activeAvatarFrame();
    if (frame) el.classList.add('frame-' + frame.frameCls);
}
// —— 🏮 论坛皮肤实装（f10 纸灯巷 / f11 月下冷夜）——
function getForumSkin() {
    const sk = safeGetJSON('darkalley_forum_skin', 'default') || 'default';
    if (sk !== 'default') {
        const it = (FORUM_SHOP_ITEMS || []).find(i => i.id === sk && i.cat === '皮肤');
        if (!it || getOwned().indexOf(sk) === -1) return 'default';
    }
    return sk;
}
function applyForumSkin(name) {
    const fc = document.getElementById('forumContainer');
    if (!fc) return;
    name = name || 'default';
    fc.classList.remove('skin-paperlantern', 'skin-moonnight');
    if (name === 'f11') fc.classList.add('skin-moonnight');
    safeSet('darkalley_forum_skin', name);
    document.querySelectorAll('.bp-btn[data-skin]').forEach(b => b.classList.toggle('on', b.dataset.skin === name));
}
function setForumSkin(name) {
    applyForumSkin(name);
    if (typeof renderEquipPanel === 'function') renderEquipPanel();
    if (typeof renderForumBackpack === 'function') renderForumBackpack();
}
function setTerminalSkin(id) {
    applyTerminalTheme(id === 't10' ? 'night' : 'blood');
    if (typeof renderEquipPanel === 'function') renderEquipPanel();
    if (typeof renderForumBackpack === 'function') renderForumBackpack();
}
function ownItem(id) {
    const o = safeGetJSON('darkalley_owned_map', {}) || {};
    const uid = window.currentUser ? window.currentUser.id : 'guest';
    if (!o[uid]) o[uid] = [];
    if (o[uid].indexOf(id) === -1) { o[uid].push(id); safeSet('darkalley_owned_map', o); }
}
function getListings() { const l = safeGetJSON('darkalley_listings', []); return Array.isArray(l) ? l : []; }
function saveListings(list) { safeSet('darkalley_listings', list || []); }
let activeShopCat = '全部';
let activeForumShopCat = '全部';

function shopCardHtml(it, opts) {
    opts = opts || {};
    const owned = getOwned();
    const has = !opts.listing && owned.indexOf(it.id) !== -1;
    const affordable = getPoints() >= it.price;
    const mine = opts.listing && it.seller === (window.currentUser ? window.currentUser.id : '');
    const meta = opts.listing ? `<span class="shop-qty">×${it.qty}</span><span class="shop-seller">${it.sellerName || '匿名'}</span>` : `<span class="shop-cat">${it.cat}</span>`;
    let btn;
    if (mine) btn = `<button class="shop-btn mine" data-delist="${it.id}" type="button">下架</button>`;
    else if (has) btn = `<button class="shop-btn owned" disabled>已拥有</button>`;
    else if (!affordable) btn = `<button class="shop-btn cant" disabled>✦ ${it.price} 积分</button>`;
    else btn = `<button class="shop-btn" data-buy="${it.id}" data-listing="${opts.listing ? 1 : 0}" type="button">✦ ${it.price} 积分</button>`;
    return `
    <div class="shop-item${mine ? ' mine-item' : ''}">
        <span class="shop-ico">${it.ico || '📦'}</span>
        <div class="shop-main">
            <div class="shop-name">${it.name}${meta}</div>
            <div class="shop-desc">${it.desc || ''}</div>
        </div>
        ${btn}
    </div>`;
}

// —— 终端商城（总局物资部 · 内部向：官方物资 + 个人挂卖） ——
function renderShop() {
    const top = document.getElementById('shopPointsTop');
    if (top) top.textContent = getPoints();
    const tabs = document.getElementById('shopCatTabs');
    const list = document.getElementById('shopList');
    if (!tabs || !list) return;
    const cats = ['全部', '工具', '装备', '权限', '外观', '个人挂卖'];
    tabs.innerHTML = cats.map(c => `<button class="shop-cat-tab${activeShopCat === c ? ' active' : ''}" data-cat="${c}">${c}</button>`).join('');
    tabs.querySelectorAll('.shop-cat-tab').forEach(b => b.addEventListener('click', () => { activeShopCat = b.dataset.cat; renderShop(); }));
    const listings = getListings();
    const official = activeShopCat === '个人挂卖' ? [] : (TERMINAL_SHOP_ITEMS || []).filter(i => activeShopCat === '全部' || i.cat === activeShopCat);
    const userItems = (activeShopCat === '全部' || activeShopCat === '个人挂卖') ? listings : [];
    const html = [...official.map(i => shopCardHtml(i, {})), ...userItems.map(l => shopCardHtml(l, { listing: true }))];
    list.innerHTML = html.join('') || '<div class="shop-empty">该分类暂无商品</div>';
    list.querySelectorAll('.shop-btn[data-buy]').forEach(b => b.addEventListener('click', () => buyItem(b.dataset.buy, b.dataset.listing === '1')));
    list.querySelectorAll('.shop-btn[data-delist]').forEach(b => b.addEventListener('click', () => delistItem(b.dataset.delist)));
    renderMyListings();
}
function buyItem(id, isListing) {
    if (!window.currentUser) { alert('请先登录终端'); return; }
    if (isListing) {
        const listings = getListings();
        const li = listings.find(x => x.id === id);
        if (!li) return;
        if (li.seller === window.currentUser.id) { alert('不能购买自己上架的商品'); return; }
        if (getPoints() < li.price) { alert('积分不足'); return; }
        addPoints(-li.price);
        addPointsFor(li.seller, li.price);
        li.qty -= 1;
        saveListings(li.qty <= 0 ? listings.filter(x => x.id !== id) : listings);
        renderShop();
        alert('已购买「' + li.name + '」');
        return;
    }
    const it = (TERMINAL_SHOP_ITEMS || []).find(x => x.id === id);
    if (!it) return;
    if (getPoints() < it.price) { alert('积分不足'); return; }
    addPoints(-it.price); ownItem(it.id);
    renderShop();
    alert('已兑换「' + it.name + '」');
}
function delistItem(id) {
    const listings = getListings();
    const li = listings.find(x => x.id === id);
    if (!li) return;
    if (li.seller !== (window.currentUser ? window.currentUser.id : '')) return;
    saveListings(listings.filter(x => x.id !== id));
    renderShop();
    alert('已下架「' + li.name + '」');
}
// 🎨 终端主题皮肤
function applyTerminalTheme(name) {
    const term = document.getElementById('terminalContainer');
    if (!term) return;
    term.classList.remove('theme-night', 'theme-blood');
    if (name && name !== 'default') term.classList.add('theme-' + name);
    safeSet('darkalley_theme', name || 'default');
    document.querySelectorAll('#themeOptions .theme-opt').forEach(o => o.classList.toggle('active', o.dataset.theme === (name || 'default')));
}
function renderThemeOptions() {
    const wrap = document.getElementById('themeOptions');
    if (!wrap) return;
    const owned = getOwned();
    const cur = safeGetJSON('darkalley_theme', 'default') || 'default';
    const shopIds = (TERMINAL_SHOP_ITEMS || []).map(i => i.id);
    const opts = [
        { theme: 'default', label: '◐ 默认 · 猩红', locked: false, item: null },
        { theme: 'night', label: '🌑 暗夜 · 玄青', locked: owned.indexOf('t10') === -1, item: 't10' },
        { theme: 'blood', label: '🌕 血月 · 赤金', locked: owned.indexOf('t11') === -1, item: 't11' }
    ].filter(o => o.item === null || shopIds.indexOf(o.item) !== -1);
    wrap.innerHTML = opts.map(o => `<button class="theme-opt${o.locked ? ' locked' : ''}${cur === o.theme ? ' active' : ''}" data-theme="${o.theme}" ${o.locked ? 'title="需在终端商城兑换（暗夜皮肤）"' : ''} type="button">${o.label}${o.locked ? ' 🔒' : ''}</button>`).join('');
    wrap.querySelectorAll('.theme-opt:not(.locked)').forEach(b => b.addEventListener('click', () => { applyTerminalTheme(b.dataset.theme); if (typeof renderEquipPanel === 'function') renderEquipPanel(); if (typeof renderForumBackpack === 'function') renderForumBackpack(); }));
}
// 🎒 终端个人面板 · 背包实装（终端皮肤 + 头像框 + 论坛皮肤）
function renderEquipPanel() {
    if (typeof renderThemeOptions === 'function') renderThemeOptions();
    const owned = getOwned();
    const fo = document.getElementById('frameOptions');
    if (fo) {
        const frames = (FORUM_SHOP_ITEMS || []).filter(it => it.cat === '头像框' && it.frameCls && owned.includes(it.id));
        const cur = activeAvatarFrame();
        fo.innerHTML = frames.length ? frames.map(f => `<div class="bp-item"><span class="bp-ico">${f.ico}</span><span class="bp-name">${f.name}</span><button class="bp-btn${cur && cur.id === f.id ? ' on' : ''}" onclick="setActiveFrame('${f.id}')">${cur && cur.id === f.id ? '使用中' : '使用'}</button></div>`).join('') : '<div class="bp-empty">尚未拥有头像框</div>';
    }
    const fs = document.getElementById('forumSkinOptions');
    if (fs) {
        const cur = getForumSkin();
        const ownSkins = (FORUM_SHOP_ITEMS || []).filter(it => it.cat === '皮肤' && owned.includes(it.id));
        fs.innerHTML = `<div class="bp-item"><span class="bp-ico">☽</span><span class="bp-name">默认 · 暗巷</span><button class="bp-btn${cur === 'default' ? ' on' : ''}" onclick="setForumSkin('default')">${cur === 'default' ? '使用中' : '使用'}</button></div>` +
            (ownSkins.length ? ownSkins.map(s => `<div class="bp-item"><span class="bp-ico">${s.ico}</span><span class="bp-name">${s.name}</span><button class="bp-btn${cur === s.id ? ' on' : ''}" onclick="setForumSkin('${s.id}')">${cur === s.id ? '使用中' : '使用'}</button></div>`).join('') : '');
    }
}

function renderMyListings() {
    const wrap = document.getElementById('myListings');
    const hint = document.getElementById('myListingsHint');
    if (!wrap) return;
    const uid = window.currentUser ? window.currentUser.id : '';
    const mine = getListings().filter(l => l.seller === uid);
    if (hint) hint.textContent = mine.length + ' 件在售';
    wrap.innerHTML = mine.length ? mine.map(l => shopCardHtml(l, { listing: true })).join('') : '<div class="shop-empty">你还没有上架任何商品</div>';
    wrap.querySelectorAll('.shop-btn[data-delist]').forEach(b => b.addEventListener('click', () => delistItem(b.dataset.delist)));
    wrap.querySelectorAll('.shop-btn[data-buy]').forEach(b => b.addEventListener('click', () => buyItem(b.dataset.buy, true)));
}
function bindListingForm() {
    const btn = document.getElementById('listSubmitBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (!window.currentUser) { alert('请先登录终端'); return; }
        const name = (document.getElementById('listName').value || '').trim();
        const ico = (document.getElementById('listIco').value || '').trim();
        const price = parseInt(document.getElementById('listPrice').value, 10);
        const qty = parseInt(document.getElementById('listQty').value, 10) || 1;
        const desc = (document.getElementById('listDesc').value || '').trim();
        if (!name) { alert('请填写物品名称'); return; }
        if (!price || price < 1) { alert('请填写有效价格'); return; }
        const listings = getListings();
        listings.push({ id: 'L' + Date.now(), name, ico: ico || '📦', price, qty: Math.max(1, Math.min(99, qty)), desc, seller: window.currentUser.id, sellerName: window.currentUser.name, ts: Date.now() });
        saveListings(listings);
        ['listName', 'listIco', 'listPrice', 'listQty', 'listDesc'].forEach(k => { const el = document.getElementById(k); if (el) el.value = k === 'listQty' ? '1' : ''; });
        renderShop();
        alert('已上架「' + name + '」');
    });
}

// —— 论坛商城（巷口杂货铺 · 民众向：护身/头像框/皮肤等，含「🎒 背包」实装） ——
function backpackItemsHtml() {
    const owned = getOwned();
    const frame = activeAvatarFrame();
    const skin = getForumSkin();
    const theme = safeGetJSON('darkalley_theme', 'default') || 'default';
    const itemHtml = (it) => {
        let on = false, act = '';
        if (it.cat === '头像框' && it.frameCls) { on = !!(frame && frame.id === it.id); act = `onclick="setActiveFrame('${it.id}')"`; }
        else if (it.cat === '皮肤') { on = skin === it.id; act = `onclick="setForumSkin('${it.id}')"`; }
        else if (it.id === 't10' || it.id === 't11') { const th = it.id === 't10' ? 'night' : 'blood'; on = theme === th; act = `onclick="setTerminalSkin('${it.id}')"`; }
        const btn = act ? `<button class="bp-btn${on ? ' on' : ''}" ${act}>${on ? '使用中' : '使用'}</button>` : `<button class="bp-btn" disabled>无实装</button>`;
        return `<div class="bp-item"><span class="bp-ico">${it.ico}</span><span class="bp-name">${it.name}</span><span class="bp-cat">${it.cat}</span>${btn}</div>`;
    };
    const fItems = (FORUM_SHOP_ITEMS || []).filter(i => owned.includes(i.id));
    const tItems = (TERMINAL_SHOP_ITEMS || []).filter(i => owned.includes(i.id));
    if (!fItems.length && !tItems.length) return '<div class="bp-empty">背包空空如也，先去商城兑换吧 🎒</div>';
    const head = (t) => `<div class="bp-cat-label">${t}</div>`;
    return head('论坛 · 巷口杂货铺') + `<div class="bp-grid">${fItems.length ? fItems.map(itemHtml).join('') : '<div class="bp-empty">暂无论坛物品</div>'}</div>`
         + head('终端 · 总局物资部') + `<div class="bp-grid">${tItems.length ? tItems.map(itemHtml).join('') : '<div class="bp-empty">暂无终端物品</div>'}</div>`;
}
function renderForumShop() {
    const top = document.getElementById('forumShopPoints');
    if (top) top.textContent = getPoints();
    const tabs = document.getElementById('forumShopCatTabs');
    const list = document.getElementById('forumShopList');
    if (!tabs || !list) return;
    const cats = [['全部', '全部'], ['护身', '护身'], ['消耗品', '消耗品'], ['头像框', '头像框'], ['皮肤', '皮肤'], ['收集品', '收集品'], ['backpack', '🎒 背包']];
    tabs.innerHTML = cats.map(([k, label]) => `<button class="shop-cat-tab${activeForumShopCat === k ? ' active' : ''}" data-cat="${k}">${label}</button>`).join('');
    tabs.querySelectorAll('.shop-cat-tab').forEach(b => b.addEventListener('click', () => { activeForumShopCat = b.dataset.cat; renderForumShop(); }));
    if (activeForumShopCat === 'backpack') { list.classList.add('bp-mode'); list.innerHTML = backpackItemsHtml(); return; }
    list.classList.remove('bp-mode');
    const items = (FORUM_SHOP_ITEMS || []).filter(i => activeForumShopCat === '全部' || i.cat === activeForumShopCat);
    const owned = getOwned();
    list.innerHTML = items.map(it => {
        const has = owned.indexOf(it.id) !== -1;
        const affordable = getPoints() >= it.price;
        return `
        <div class="shop-item">
            <span class="shop-ico">${it.ico}</span>
            <div class="shop-main">
                <div class="shop-name">${it.name}<span class="shop-cat">${it.cat}</span></div>
                <div class="shop-desc">${it.desc}</div>
            </div>
            <button class="shop-btn${has ? ' owned' : ''}${!has && !affordable ? ' cant' : ''}" data-id="${it.id}" ${has ? 'disabled' : ''}>${has ? '已拥有' : '✦ ' + it.price + ' 积分'}</button>
        </div>`;
    }).join('');
    list.querySelectorAll('.shop-btn:not([disabled])').forEach(b => b.addEventListener('click', () => {
        const it = FORUM_SHOP_ITEMS.find(x => x.id === b.dataset.id);
        if (!it) return;
        if (getPoints() < it.price) { alert('积分不足'); return; }
        addPoints(-it.price); ownItem(it.id);
        renderForumShop();
        alert('已兑换「' + it.name + '」');
    }));
}

// —— 民俗专区（论坛内嵌面板：文游 / 故事合集 / 巷口杂货） ——
function setForumView(showId) {
    ['postListView', 'postDetailView', 'newPostForm', 'forumProfileView', 'forumGameSection', 'forumCollectionSection', 'forumShopSection'].forEach(k => {
        const el = document.getElementById(k);
        if (el) el.style.display = (k === showId) ? (k === 'postListView' ? 'flex' : 'block') : 'none';
    });
    // 帖子详情弹层：同时锁定 body 与 html（视口），避免滚到底时页脚「那扇门」透出重叠
    const lockScroll = (showId === 'postDetailView') ? 'hidden' : '';
    document.body.style.overflow = lockScroll;
    document.documentElement.style.overflow = lockScroll;
}
function showForumView(id) {
    setForumView(id);
    if (id === 'forumGameSection') startGame();
    if (id === 'forumCollectionSection') renderFolkCollections();
    if (id === 'forumShopSection') renderForumShop();
}
function bindFolkEntries() {
    document.querySelectorAll('.folk-entry[data-open]').forEach(b => b.addEventListener('click', () => {
        const o = b.dataset.open;
        document.querySelectorAll('.board-tab').forEach(t => t.classList.remove('active'));
        if (o === 'game') showForumView('forumGameSection');
        else if (o === 'shop') showForumView('forumShopSection');
        else if (o === 'collections') showForumView('forumCollectionSection');
    }));
    ['gameBackBtn', 'collectionBackBtn', 'shopBackBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => { setForumView('postListView'); renderPostList(); });
    });
}

// ============ 🌫️ 动态迷雾背景（鼠标视差） ============
function initFog() {
    const fogs = document.querySelectorAll('.fog');
    if (!fogs.length) return;
    window.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2;
        const y = (e.clientY / window.innerHeight - 0.5) * 2;
        if (fogs[0]) fogs[0].style.transform = `translate(${x * 14}px, ${y * 8}px)`;
        if (fogs[1]) fogs[1].style.transform = `translate(${x * -22}px, ${y * -12}px)`;
        if (fogs[2]) fogs[2].style.transform = `translate(${x * 30}px, ${y * 16}px)`;
    });
}

// ============ 初始化 ============
try {
    restoreSession();
    loadCloudPosts(); // 初始同步云端帖子（游客也能看）
    loadCloudArchives(); // 初始同步云端档案（游客也能看）
    loadCloudUsers();
    updateForumIdentityUI();
    initFog();
    bindGameView();
    bindFolkEntries();
    bindListingForm();
    bindPasswordToggle();
    bindTypeKeyInputs();
    bindClickSfx();
    startStars();
    setupForumMiniPlayer();
    renderFeaturedPosts();
    renderPostList();
    document.getElementById('dailyFortune').textContent = getDailyFortune();
    updateForumStatus();
    setInterval(updateForumStatus, 30000);
    bindKeyboardShortcuts();
    const moreBtn = document.getElementById('sidebarMoreBtn');
    if (moreBtn) moreBtn.addEventListener('click', () => {
        const more = document.getElementById('sidebarMore');
        more.classList.toggle('open');
        moreBtn.textContent = more.classList.contains('open') ? '△ 收起版块' : '☰ 更多版块';
    });
    updatePortalStatus();
    initCursorCandle();
    // 收藏：新建分组
    const favNewBtn = document.getElementById('favNewGroupBtn');
    if (favNewBtn) favNewBtn.addEventListener('click', () => {
        const uid = window.currentUser ? window.currentUser.id : '';
        const inp = document.getElementById('favNewGroupInput');
        const name = (inp && inp.value || '').trim();
        if (!uid) { alert('请先登录'); return; }
        if (!name) { alert('请输入分组名'); return; }
        const fav = favGroups(uid);
        if (!fav[name]) fav[name] = [];
        saveFav(); activeFavGroup = name;
        if (inp) inp.value = '';
        renderFavGroupsPanel();
    });
    // 🛠️ 修复：.modal-overlay 是 fixed，但 .main-container 的 backdrop-filter 会劫持其包含块，导致弹窗随外层滚动上移/消失。移到 body 顶层（body 无 transform/filter），fixed 相对视口正确。
    document.querySelectorAll('.modal-overlay').forEach(m => { if (m.parentElement && m.parentElement !== document.body) document.body.appendChild(m); });
    // ESC 关闭弹窗
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const m = document.getElementById('archiveDetailModal');
        if (m && m.style.display !== 'none') { closeArchiveDetail(); return; }
        ['editModal', 'postEditModal'].forEach(id => { const el = document.getElementById(id); if (el && el.style.display !== 'none') el.style.display = 'none'; });
        document.body.style.overflow = '';
        const tc = document.getElementById('terminalContainer'); if (tc) tc.style.overflow = '';
    });
    const shiChenEl = document.getElementById('shiChen');
    if (shiChenEl) { const updShi = () => shiChenEl.textContent = shiChenLabel(); updShi(); setInterval(updShi, 60000); }
    startForumClock();
} catch(e) { console.error('初始化失败:', e); }