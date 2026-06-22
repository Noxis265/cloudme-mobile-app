// ─── constants ───────────────────────────────────────────
const EMOJIS=['😀','😎','🤓','🥳','🙂','😺','🐶','🦊','🐼','🐸','🐙','🦄','🐝','🐢','🦖','🐨','🌵','🌸','🌻','🍕','🍩','🍉','⚡','🔥','🌊','🌙','⭐','🌈','☁️','🪐','🦋','🍄','🎮','🎧','📚','🎨','🚀','🛸','🤖','👾','🎲','🎯','🧩','🎸','⚽','🏆','💡','🔮'];
const REACTION_EMOJIS=['👍','❤️','😂','🔥','😮','👏'];
const RTC_CONFIG={iceServers:[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}]};
const ONLINE_TTL=30000;
const AVATAR_SIZE=128; // px — максимальный размер аватарки

// ─── state ──────────────────────────────────────────────
let state={
  view:'auth', authMode:'login',
  currentUid:null, currentEmail:null, currentProfile:null,
  directory:[], directoryLoaded:false,
  busy:false, errorMsg:'', saveMsg:'', search:'',
  activeConversation:null,
  dmList:[], groupList:[], chatList:[], dmListLoaded:false,groupListLoaded:false,
  darkMode:localStorage.getItem('cloudme_theme')==='dark',
  theme:localStorage.getItem('cloudme_theme_v2')||(localStorage.getItem('cloudme_theme')==='dark'?'dark':'light'),
  searchOpen:false, searchQuery:'', searchResults:[], searchIdx:0,
  peerTyping:false, pinnedMsgs:[],
  uploadingFile:false,
  friends:[], friendsLoaded:false,
  editingMsgId:null, editingText:'',
  replyingTo:null,
  chatFontSize:localStorage.getItem('cloudme_chat_font')||'medium'
};
let groupDraft={name:'',selectedUids:new Set()};
let groupEditDraft={name:null,description:null,emoji:null};
let authDraft={email:'',password:'',confirm:'',displayName:''};
let profileDraft={displayName:'',status:''};
let selectedEmoji='☁️';
let customAvatarBase64=null; // если пользователь загрузил фото
let avatarDirty=false; // есть несохранённые изменения аватарки
let messagesCache=[];
const GROUP_EMOJIS=['👥','🎉','🚀','🎮','📚','🎨','⚡','🌈','🍕','🎵','🏆','🌍'];
let selectedGroupEmoji='👥';

// ─── call state ─────────────────────────────────────────
let callState={status:'idle',callId:null,peerUid:null,peerName:'',peerEmoji:'☁️',pc:null,localStream:null,remoteStream:null,unsubs:[],role:null,offer:null};
let callRingTimeout=null;

// ─── subscriptions ───────────────────────────────────────
let directoryUnsub=null,dmThreadUnsub=null,dmListUnsub=null,groupListUnsub=null,incomingCallUnsub=null,convMetaUnsub=null,friendsUnsub=null;
let onlineHeartbeatTimer=null,onlineUnsub=null;
let onlineMap={};
let reactionPickerOpen=null;
let lastSeenMsg={};
let typingTimeout=null;

// ─── helpers ────────────────────────────────────────────
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function tsMs(ts){return ts&&typeof ts.toMillis==='function'?ts.toMillis():0;}
function timeAgo(ts){
  const diff=Date.now()-tsMs(ts),m=Math.floor(diff/60000);
  if(m<1)return'только что';if(m<60)return m+' мин назад';
  const h=Math.floor(m/60);if(h<24)return h+' ч назад';
  return Math.floor(h/24)+' дн назад';
}
function lastSeenText(uid){
  const t=onlineMap[uid];if(!t)return null;
  if(Date.now()-t<ONLINE_TTL*2)return'онлайн';
  return'был(а) '+timeAgo({toMillis:()=>t});
}
function mapErr(e){
  const c=e&&e.code;
  if(c==='auth/email-already-in-use')return'Email уже зарегистрирован.';
  if(c==='auth/invalid-email')return'Введи настоящий email.';
  if(c==='auth/weak-password')return'Пароль минимум 6 символов.';
  if(c==='auth/user-not-found')return'Аккаунт не найден.';
  if(c==='auth/wrong-password'||c==='auth/invalid-credential')return'Неверный пароль.';
  if(c==='auth/network-request-failed')return'Нет соединения с интернетом.';
  if(c==='permission-denied')return'Нет доступа. Обнови правила Firestore.';
  return'Что-то пошло не так.';
}
function convId(a,b){return[a,b].sort().join('_');}
function isOnline(uid){return uid&&onlineMap[uid]&&(Date.now()-onlineMap[uid])<ONLINE_TTL*2;}
function peerShowsOnlineToMe(uid){
  if(uid===state.currentUid)return true;
  const p=state.directory.find(x=>x.uid===uid);
  const setting=(p&&p.showOnlineTo)||'everyone';
  if(setting==='nobody')return false;
  if(setting==='friends')return state.friends.includes(uid);
  return true;
}
function visibleOnline(uid){return peerShowsOnlineToMe(uid)&&isOnline(uid);}
function visibleLastSeen(uid){return peerShowsOnlineToMe(uid)?lastSeenText(uid):'';}
function convRef(conv){return conv.kind==='group'?db.collection('groups').doc(conv.id):db.collection('conversations').doc(conv.id);}
function formatSize(b){
  if(!b)return'';
  if(b<1024)return b+' Б';
  if(b<1048576)return(b/1024).toFixed(1)+' КБ';
  return(b/1048576).toFixed(1)+' МБ';
}
function attachKindFromMime(mime){
  if(!mime)return'file';
  if(mime.startsWith('image/'))return'image';
  if(mime.startsWith('video/'))return'video';
  if(mime.startsWith('audio/'))return'audio';
  return'file';
}

// Рендер аватарки — либо эмодзи, либо картинка
function emojiToTwemoji(emoji){
  return emoji?esc(emoji):'';
}
function renderAvatar(profile,sizeClass=''){
  const av=profile&&profile.avatarEmoji;
  if(av&&av.startsWith('data:')){
    return`<div class="avatar-wrap ${sizeClass}" style="background:none;padding:0;overflow:hidden"><img src="${av}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"></div>`;
  }
  return`<div class="avatar-wrap ${sizeClass}">${emojiToTwemoji(av||'☁️')}</div>`;
}
function renderAvatarWithDot(profile,sizeClass='',showDot=false){
  const av=profile&&profile.avatarEmoji;
  const dot=showDot?'<div class="online-dot"></div>':'';
  if(av&&av.startsWith('data:')){
    return`<div class="avatar-wrap ${sizeClass}" style="background:none;padding:0;position:relative"><div style="width:100%;height:100%;border-radius:50%;overflow:hidden;"><img src="${av}" style="width:100%;height:100%;object-fit:cover;display:block;"></div>${dot}</div>`;
  }
  return`<div class="avatar-wrap ${sizeClass}" style="position:relative">${emojiToTwemoji(av||'☁️')}${dot}</div>`;
}

let toastEl=null;
function ensureAvatarHint(){
  if(document.querySelector('.avatar-unsaved-hint'))return;
  const wrap=document.querySelector('.avatar-preview-wrap');
  if(wrap)wrap.insertAdjacentHTML('afterend','<div class="avatar-unsaved-hint">⚠️ Не забудь нажать «Сохранить», чтобы применить новую аватарку!</div>');
}
function showToast(msg){
  if(!toastEl){toastEl=document.createElement('div');toastEl.className='toast';document.body.appendChild(toastEl);}
  toastEl.textContent=msg;toastEl.classList.add('show');
  clearTimeout(toastEl._t);toastEl._t=setTimeout(()=>toastEl.classList.remove('show'),4000);
}
function sendNativeNotification(title,body){try{if(window.cloudmeNative)window.cloudmeNative.notify(title,body);}catch(e){}}

// ─── avatar cropper ──────────────────────────────────────
const CROP_BOX=260; // размер видимой области кропа (css px)
const CROP_OUT=320; // размер итогового изображения (px)
let cropState=null;
function openAvatarCropper(file){
  const reader=new FileReader();
  reader.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const baseScale=Math.max(CROP_BOX/img.width,CROP_BOX/img.height);
      cropState={img,naturalW:img.width,naturalH:img.height,baseScale,zoom:1,panX:0,panY:0,dragging:false,lastX:0,lastY:0};
      renderCropperModal();
    };
    img.onerror=()=>showToast('Не получилось открыть это изображение.');
    img.src=e.target.result;
  };
  reader.onerror=()=>showToast('Не получилось прочитать файл.');
  reader.readAsDataURL(file);
}
function cropDisplayScale(){return cropState.baseScale*cropState.zoom;}
function renderCropperModal(){
  closeCropperModal();
  const modal=document.createElement('div');modal.className='cropper-overlay';modal.id='cropperOverlay';
  modal.innerHTML=`
    <div class="cropper-panel">
      <h3>Обрежь и приблизь фото</h3>
      <div class="cropper-box" id="cropperBox" style="width:${CROP_BOX}px;height:${CROP_BOX}px;">
        <img id="cropperImg" src="${cropState.img.src}" draggable="false">
        <div class="cropper-circle-mask"></div>
      </div>
      <input type="range" id="cropperZoom" min="1" max="3" step="0.01" value="${cropState.zoom}">
      <div class="cropper-actions">
        <button type="button" class="btn-primary" data-action="apply-crop">Применить</button>
        <button type="button" class="btn-primary cropper-cancel" data-action="cancel-crop">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  positionCropperImage();
  const box=document.getElementById('cropperBox');
  const imgEl=document.getElementById('cropperImg');
  const startDrag=(x,y)=>{cropState.dragging=true;cropState.lastX=x;cropState.lastY=y;};
  const moveDrag=(x,y)=>{
    if(!cropState||!cropState.dragging)return;
    cropState.panX+=x-cropState.lastX;cropState.panY+=y-cropState.lastY;
    cropState.lastX=x;cropState.lastY=y;
    positionCropperImage();
  };
  const endDrag=()=>{cropState.dragging=false;};
  box.addEventListener('mousedown',e=>{startDrag(e.clientX,e.clientY);e.preventDefault();});
  window.addEventListener('mousemove',e=>moveDrag(e.clientX,e.clientY));
  window.addEventListener('mouseup',endDrag);
  box.addEventListener('touchstart',e=>{const t=e.touches[0];startDrag(t.clientX,t.clientY);},{passive:true});
  box.addEventListener('touchmove',e=>{const t=e.touches[0];moveDrag(t.clientX,t.clientY);},{passive:true});
  box.addEventListener('touchend',endDrag);
  document.getElementById('cropperZoom').addEventListener('input',e=>{
    cropState.zoom=parseFloat(e.target.value);positionCropperImage();
  });
}
function positionCropperImage(){
  const imgEl=document.getElementById('cropperImg');if(!imgEl||!cropState)return;
  const scale=cropDisplayScale();
  const dispW=cropState.naturalW*scale,dispH=cropState.naturalH*scale;
  // ограничиваем панорамирование, чтобы изображение всегда покрывало круг
  const maxPanX=Math.max(0,(dispW-CROP_BOX)/2),maxPanY=Math.max(0,(dispH-CROP_BOX)/2);
  cropState.panX=Math.max(-maxPanX,Math.min(maxPanX,cropState.panX));
  cropState.panY=Math.max(-maxPanY,Math.min(maxPanY,cropState.panY));
  const left=CROP_BOX/2-dispW/2+cropState.panX,top=CROP_BOX/2-dispH/2+cropState.panY;
  imgEl.style.width=dispW+'px';imgEl.style.height=dispH+'px';
  imgEl.style.left=left+'px';imgEl.style.top=top+'px';
}
function closeCropperModal(){const m=document.getElementById('cropperOverlay');if(m)m.remove();}
function applyCrop(){
  if(!cropState)return;
  const scale=cropDisplayScale();
  const dispW=cropState.naturalW*scale,dispH=cropState.naturalH*scale;
  const left=CROP_BOX/2-dispW/2+cropState.panX,top=CROP_BOX/2-dispH/2+cropState.panY;
  let sx=(0-left)/scale,sy=(0-top)/scale,sw=CROP_BOX/scale,sh=CROP_BOX/scale;
  sx=Math.max(0,Math.min(sx,cropState.naturalW-sw));
  sy=Math.max(0,Math.min(sy,cropState.naturalH-sh));
  sw=Math.min(sw,cropState.naturalW);sh=Math.min(sh,cropState.naturalH);
  const canvas=document.createElement('canvas');canvas.width=CROP_OUT;canvas.height=CROP_OUT;
  const ctx=canvas.getContext('2d');
  ctx.save();
  ctx.beginPath();ctx.arc(CROP_OUT/2,CROP_OUT/2,CROP_OUT/2,0,Math.PI*2);ctx.clip();
  ctx.drawImage(cropState.img,sx,sy,sw,sh,0,0,CROP_OUT,CROP_OUT);
  ctx.restore();
  const base64=canvas.toDataURL('image/png');
  customAvatarBase64=base64;avatarDirty=true;
  closeCropperModal();cropState=null;
  render();
}
function cancelCrop(){closeCropperModal();cropState=null;}

// ─── theme ──────────────────────────────────────────────
const THEMES=[
  {id:'light',label:'Светлая',swatch:'#F6F8FB'},
  {id:'dark',label:'Тёмная',swatch:'#0F1117'},
  {id:'sunset',label:'Закат',swatch:'#2B1B2E'},
  {id:'forest',label:'Лес',swatch:'#0F1F17'},
  {id:'ocean',label:'Океан',swatch:'#0B1F33'},
  {id:'lavender',label:'Лаванда',swatch:'#F3EEFB'}
];
function applyTheme(){
  document.documentElement.setAttribute('data-theme',state.theme);
  localStorage.setItem('cloudme_theme_v2',state.theme);
  localStorage.setItem('cloudme_theme',(state.theme==='dark'?'dark':'light'));
}
applyTheme();
function applyChatFontSize(){
  document.documentElement.setAttribute('data-chat-font',state.chatFontSize);
  localStorage.setItem('cloudme_chat_font',state.chatFontSize);
}
applyChatFontSize();

// ─── render root ────────────────────────────────────────
function render(){
  const app=document.getElementById('app');
  if(state.view==='auth'){app.innerHTML=renderAuth();return;}
  let content='';
  const isChatsView=(state.view==='chats'||state.view==='new-group');
  if(state.view==='directory')content=renderDirectory();
  else if(state.view==='profile')content=renderProfileEdit();
  else if(state.view==='settings')content=renderSettings();
  else if(state.view==='chats')content=renderChats();
  else if(state.view==='new-group')content=renderNewGroup();
  else if(state.view==='group-info')content=renderGroupInfo();
  app.innerHTML=`<div class="app-shell">${renderTopbar()}<div class="view-area ${isChatsView?'no-scroll':''}">${content}</div></div>`;
}

// ─── topbar ─────────────────────────────────────────────
function renderTopbar(){
  return`<div class="topbar">
    <div class="logo"><span class="logo-badge">☁</span>CloudMe</div>
    <div class="navgroup">
      <button class="navbtn ${state.view==='directory'?'active':''}" data-action="nav-directory">Сеть</button>
      <button class="navbtn ${state.view==='chats'||state.view==='new-group'||state.view==='group-info'?'active':''}" data-action="nav-chats">Чаты</button>
      <button class="navbtn ${state.view==='profile'?'active':''}" data-action="nav-profile">Профиль</button>
      <button class="navbtn ${state.view==='settings'?'active':''}" data-action="nav-settings">Настройки</button>
      <button class="navbtn" data-action="logout">Выйти</button>
    </div>
  </div>`;
}

// ─── auth ────────────────────────────────────────────────
function renderAuth(){
  const isLogin=state.authMode==='login';
  return`<div class="app-shell"><div class="auth-wrap"><div class="auth-card">
    <div class="auth-hero"><div class="cloud-glow">☁️</div><h1>CloudMe</h1><p>Маленькая сеть для своих</p></div>
    <div class="auth-tabs">
      <button class="auth-tab ${isLogin?'active':''}" data-action="set-auth-mode" data-mode="login">Войти</button>
      <button class="auth-tab ${!isLogin?'active':''}" data-action="set-auth-mode" data-mode="register">Создать аккаунт</button>
    </div>
    <form data-form="auth">
      <div class="field"><label>Email</label><input type="email" name="email" value="${esc(authDraft.email)}" placeholder="you@example.com" required></div>
      ${!isLogin?`<div class="field"><label>Имя</label><input type="text" name="displayName" value="${esc(authDraft.displayName)}" placeholder="Как тебя называть" maxlength="30" required></div>`:''}
      <div class="field"><label>Пароль</label><input type="password" name="password" value="${esc(authDraft.password)}" placeholder="${isLogin?'Твой пароль':'Минимум 6 символов'}" required></div>
      ${!isLogin?`<div class="field"><label>Повтори пароль</label><input type="password" name="confirm" value="${esc(authDraft.confirm)}" required></div>`:''}
      ${state.errorMsg?`<div class="error-text">${esc(state.errorMsg)}</div>`:''}
      <button type="submit" class="btn-primary" ${state.busy?'disabled':''}>${state.busy?'Подождите…':(isLogin?'Войти':'Создать аккаунт')}</button>
    </form>
  </div></div></div>`;
}

// ─── directory ───────────────────────────────────────────
function renderDirectory(){
  const q=state.search.trim().toLowerCase();
  const me=state.directory.find(p=>p.uid===state.currentUid);
  let others=[];
  if(q.length>=2){
    others=state.directory.filter(p=>p.uid!==state.currentUid&&(p.displayName||'').toLowerCase().includes(q));
    others.sort((a,b)=>{
      const ao=visibleOnline(a.uid)?1:0,bo=visibleOnline(b.uid)?1:0;
      if(ao!==bo)return bo-ao;
      return(onlineMap[b.uid]||0)-(onlineMap[a.uid]||0);
    });
  }
  let body='';
  if(state.busy&&!state.directoryLoaded)body=`<div class="loading-state">Загружаем…</div>`;
  else{
    if(me)body+=`<div class="section-label">Мой профиль</div><div class="directory-list">${renderProfileCard(me)}</div>`;
    if(q.length>=2){
      if(others.length>0)body+=`<div class="section-label">Найдено</div><div class="directory-list">${others.map(renderProfileCard).join('')}</div>`;
      else body+=`<div class="empty-state">Никого не нашли по «${esc(state.search.trim())}».</div>`;
    }else{
      const friendProfiles=state.directory.filter(p=>state.friends.includes(p.uid));
      friendProfiles.sort((a,b)=>{
        const ao=visibleOnline(a.uid)?1:0,bo=visibleOnline(b.uid)?1:0;
        if(ao!==bo)return bo-ao;
        return(onlineMap[b.uid]||0)-(onlineMap[a.uid]||0);
      });
      if(friendProfiles.length>0)body+=`<div class="section-label">Мои друзья · ${friendProfiles.length}</div><div class="directory-list">${friendProfiles.map(renderProfileCard).join('')}</div><div class="empty-state">Введи имя друга в поиск, чтобы найти ещё кого-то.</div>`;
      else body+=`<div class="empty-state">У тебя пока нет друзей. Введи имя в поиск, чтобы найти и добавить.</div>`;
    }
  }
  return`<div class="search-bar"><input type="text" id="searchInput" placeholder="Поиск по имени (минимум 2 буквы)" value="${esc(state.search)}"></div>${body}`;
}

function renderProfileCard(p){
  const isMe=p.uid===state.currentUid;
  const online=visibleOnline(p.uid);
  const lsText=visibleLastSeen(p.uid);
  const isFriend=state.friends.includes(p.uid);
  const statusTag=online?'<span class="online-tag">онлайн</span>':(lsText&&!isMe?`<span class="lastseen-tag">${esc(lsText)}</span>`:'');
  const friendBtn=isFriend
    ?`<button class="friend-btn added" data-action="remove-friend" data-uid="${p.uid}" title="Убрать из друзей">✓ Друг</button>`
    :`<button class="friend-btn" data-action="add-friend" data-uid="${p.uid}" data-name="${esc(p.displayName||p.email)}" data-peer-emoji="${esc(p.avatarEmoji||'☁️')}" title="Добавить в друзья">➕ В друзья</button>`;
  return`<div class="profile-card ${isMe?'me':''}">
    ${renderAvatarWithDot(p,'',online)}
    <div class="profile-info">
      <div class="profile-name-row">
        <span class="profile-name">${esc(p.displayName||p.email)}</span>
        ${isMe?'<span class="you-tag">ты</span>':''}${statusTag}
      </div>
      <div class="profile-status ${!p.status?'empty':''}">${p.status?esc(p.status):'Пока без статуса'}</div>
    </div>
    ${!isMe?`<div class="profile-card-actions">${friendBtn}<button class="write-btn" data-action="open-dm" data-uid="${p.uid}" data-name="${esc(p.displayName||p.email)}" data-peer-emoji="${esc(p.avatarEmoji||'☁️')}" title="Написать">💬</button></div>`:''}
  </div>`;
}

// ─── profile edit ────────────────────────────────────────
function renderProfileEdit(){
  const currentAvatar=customAvatarBase64||(state.currentProfile&&state.currentProfile.avatarEmoji)||'☁️';
  const isPhoto=customAvatarBase64&&customAvatarBase64.startsWith('data:');
  const privacy=(state.currentProfile&&state.currentProfile.allowMessagesFrom)||'everyone';
  return`<div class="panel"><h2>Мой профиль</h2>
    <form data-form="profile">
      <div class="avatar-picker-section">
        <div class="avatar-preview-wrap">
          ${isPhoto
            ?`<div class="avatar-preview-img"><img src="${currentAvatar}" alt="аватар"></div>`
            :`<div class="avatar-preview-emoji">${selectedEmoji}</div>`
          }
          <div style="display:flex;flex-direction:column;gap:8px;">
            <label class="upload-photo-btn" for="avatarFileInput">📷 Загрузить фото</label>
            <input type="file" id="avatarFileInput" accept="image/*" style="display:none">
            ${isPhoto?`<button type="button" class="remove-photo-btn" data-action="remove-photo">✕ Убрать фото</button>`:''}
          </div>
        </div>
        ${avatarDirty?`<div class="avatar-unsaved-hint">⚠️ Не забудь нажать «Сохранить», чтобы применить новую аватарку!</div>`:''}
        <div class="emoji-section-label">${isPhoto?'Или выбери эмодзи вместо фото:':'Или выбери эмодзи:'}</div>
        <div class="emoji-grid">${EMOJIS.map(e=>`<button type="button" class="emoji-btn ${e===selectedEmoji&&!isPhoto?'selected':''}" data-emoji="${e}">${emojiToTwemoji(e)}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Имя</label><input type="text" name="displayName" value="${esc(profileDraft.displayName)}" maxlength="30" required></div>
      <div class="field"><label>Статус</label>
        <textarea name="status" id="statusInput" rows="3" maxlength="140" placeholder="Что у тебя нового?">${esc(profileDraft.status)}</textarea>
        <div class="char-count" id="statusCount">${profileDraft.status.length}/140</div>
      </div>
      ${state.errorMsg?`<div class="error-text">${esc(state.errorMsg)}</div>`:''}
      <button type="submit" class="btn-primary" ${state.busy?'disabled':''}>${state.busy?'Сохраняем…':'Сохранить'}</button>
      ${state.saveMsg?`<div class="save-msg">${esc(state.saveMsg)}</div>`:''}
    </form>
  </div>`;
}

// ─── settings ────────────────────────────────────────────
function renderSettings(){
  const privacy=(state.currentProfile&&state.currentProfile.allowMessagesFrom)||'everyone';
  const onlineVis=(state.currentProfile&&state.currentProfile.showOnlineTo)||'everyone';
  return`<div class="panel"><h2>Настройки</h2>

    <div class="settings-row-label">Тема оформления</div>
    <div class="theme-swatches">
      ${THEMES.map(t=>`<button type="button" class="theme-swatch ${state.theme===t.id?'selected':''}" data-action="set-theme" data-theme="${t.id}" title="${esc(t.label)}" style="background:${t.swatch};">${state.theme===t.id?'✓':''}</button>`).join('')}
    </div>

    <div class="settings-row-label" style="margin-top:22px;">Кто может мне писать первым</div>
    <div class="privacy-options">
      <label class="privacy-option"><input type="radio" name="privacy" value="everyone" data-action="set-privacy" ${privacy==='everyone'?'checked':''}><span>Все пользователи</span></label>
      <label class="privacy-option"><input type="radio" name="privacy" value="friends" data-action="set-privacy" ${privacy==='friends'?'checked':''}><span>Только друзья</span></label>
    </div>
    <div class="settings-hint">Если выбрать «Только друзья» — начать с тобой переписку смогут лишь те, кого ты добавил в друзья. Уже открытые чаты не закроются.</div>

    <div class="settings-row-label" style="margin-top:22px;">Кто видит мой статус «онлайн» / «был(а) недавно»</div>
    <div class="privacy-options">
      <label class="privacy-option"><input type="radio" name="onlinevis" value="everyone" data-action="set-online-visibility" ${onlineVis==='everyone'?'checked':''}><span>Все пользователи</span></label>
      <label class="privacy-option"><input type="radio" name="onlinevis" value="friends" data-action="set-online-visibility" ${onlineVis==='friends'?'checked':''}><span>Только друзья</span></label>
      <label class="privacy-option"><input type="radio" name="onlinevis" value="nobody" data-action="set-online-visibility" ${onlineVis==='nobody'?'checked':''}><span>Никто</span></label>
    </div>
    <div class="settings-hint">Если выбрать «Никто» — твой статус будет скрыт для всех, даже для друзей.</div>

    <div class="settings-row-label" style="margin-top:22px;">Размер шрифта в чате</div>
    <div class="font-size-options">
      <button type="button" class="font-size-option ${state.chatFontSize==='small'?'selected':''}" data-action="set-chat-font" data-size="small" style="font-size:12px;">Маленький</button>
      <button type="button" class="font-size-option ${state.chatFontSize==='medium'?'selected':''}" data-action="set-chat-font" data-size="medium" style="font-size:14px;">Средний</button>
      <button type="button" class="font-size-option ${state.chatFontSize==='large'?'selected':''}" data-action="set-chat-font" data-size="large" style="font-size:16px;">Крупный</button>
    </div>
  </div>`;
}

// ─── chats ───────────────────────────────────────────────
function renderChats(){
  const listHtml=renderChatList();
  const mainHtml=state.activeConversation?renderThread():`<div class="chats-placeholder">Выбери чат слева или открой профиль друга в «Сети» 💬</div>`;
  return`<div class="chats-split ${state.activeConversation?'thread-open':''}">
    <div class="chats-sidebar">
      <div class="chats-sidebar-header"><h2>Чаты</h2><button class="new-group-btn" data-action="new-group">+ Группа</button></div>
      ${listHtml}
    </div>
    <div class="chats-main">${mainHtml}</div>
  </div>`;
}

function renderChatList(){
  if(!state.dmListLoaded||!state.groupListLoaded)return`<div class="loading-state">Загружаем…</div>`;
  const list=state.chatList;
  if(list.length===0)return`<div class="empty-state">Нет чатов пока.<br>Нажми 💬 у друга в «Сети» или создай группу.</div>`;
  return`<div class="dm-list">${list.map(c=>{
    if(c.kind==='group'){
      return`<div class="dm-list-item" data-action="open-group" data-gid="${c.id}">
        ${renderAvatar({avatarEmoji:c.emoji},'small')}
        <div class="dm-list-info">
          <div class="dm-list-name">${esc(c.name)}<span class="group-tag">группа · ${c.members.length}</span></div>
          <div class="dm-list-preview">${esc(c.lastMessage||'Группа создана')}</div>
        </div>
        <div class="dm-list-time">${timeAgo(c.lastMessageAt)}</div>
      </div>`;
    }
    const online=visibleOnline(c.peerUid);const lsText=visibleLastSeen(c.peerUid);
    const peerProfile={avatarEmoji:c.peerEmoji};
    return`<div class="dm-list-item" data-action="open-dm" data-uid="${c.peerUid}" data-name="${esc(c.peerName)}" data-peer-emoji="${esc(c.peerEmoji)}">
      ${renderAvatarWithDot(peerProfile,'small',online)}
      <div class="dm-list-info">
        <div class="dm-list-name">${esc(c.peerName)}</div>
        <div class="dm-list-preview">${lsText?`<span style="color:var(--${online?'online':'text-secondary'})">${esc(lsText)}</span> · `:''}${esc(c.lastMessage||'')}</div>
      </div>
      <div class="dm-list-time">${timeAgo(c.lastMessageAt)}</div>
    </div>`;
  }).join('')}</div>`;
}

function rebuildChatList(){
  const list=[...state.dmList.map(c=>({...c,kind:'dm'})),...state.groupList.map(g=>({...g,kind:'group'}))];
  list.sort((a,b)=>tsMs(b.lastMessageAt)-tsMs(a.lastMessageAt));
  state.chatList=list;
}

// ─── group creation ──────────────────────────────────────
function renderNewGroup(){
  const others=state.directory.filter(p=>p.uid!==state.currentUid&&state.friends.includes(p.uid));
  return`<div class="panel"><h2>Новая группа</h2>
    <div class="field"><label>Название группы</label><input type="text" id="groupNameInput" value="${esc(groupDraft.name)}" maxlength="40" placeholder="Например, Друзья"></div>
    <div class="emoji-section-label">Эмодзи группы:</div>
    <div class="emoji-grid" style="grid-template-columns:repeat(6,1fr);margin-bottom:18px;">
      ${GROUP_EMOJIS.map(e=>`<button type="button" class="emoji-btn ${e===selectedGroupEmoji?'selected':''}" data-action="pick-group-emoji" data-emoji="${e}">${emojiToTwemoji(e)}</button>`).join('')}
    </div>
    <div class="emoji-section-label">Кого добавить (только друзья):</div>
    <div class="member-pick-list">
      ${others.length?others.map(p=>`<label class="member-pick-item">
        <input type="checkbox" data-action="toggle-group-member" data-uid="${p.uid}" ${groupDraft.selectedUids.has(p.uid)?'checked':''}>
        ${renderAvatar(p,'tiny')}
        <span class="member-pick-name">${esc(p.displayName||p.email)}</span>
      </label>`).join(''):'<div class="empty-state" style="padding:14px;">У тебя пока нет друзей. Найди их в «Сети» и нажми «➕ В друзья».</div>'}
    </div>
    ${state.errorMsg?`<div class="error-text">${esc(state.errorMsg)}</div>`:''}
    <button type="button" class="btn-primary" data-action="submit-new-group" ${state.busy?'disabled':''}>${state.busy?'Создаём…':'Создать группу'}</button>
    <button type="button" class="btn-primary" data-action="cancel-new-group" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);margin-top:8px;">Отмена</button>
  </div>`;
}

// ─── group info / settings ─────────────────────────────────
function openGroupInfo(){
  const c=state.activeConversation;if(!c||c.kind!=='group')return;
  groupEditDraft={name:null,description:null,emoji:null};
  state.view='group-info';render();
}
async function saveGroupEdit(){
  const c=state.activeConversation;if(!c||c.kind!=='group')return;
  const nameInput=document.getElementById('groupEditNameInput');
  const descInput=document.getElementById('groupEditDescInput');
  const name=(nameInput?nameInput.value:c.name).trim()||c.name;
  const description=(descInput?descInput.value:c.description||'').trim();
  const emoji=groupEditDraft.emoji||c.emoji;
  try{
    await db.collection('groups').doc(c.id).set({name:name.slice(0,40),description:description.slice(0,200),emoji},{merge:true});
    state.activeConversation={...c,name:name.slice(0,40),description:description.slice(0,200),emoji};
    showToast('Группа обновлена ✓');render();
  }catch(e){showToast('Не получилось сохранить изменения.');}
}
async function leaveGroup(){
  const c=state.activeConversation;if(!c||c.kind!=='group')return;
  if(!window.confirm('Покинуть группу «'+c.name+'»?'))return;
  try{
    await db.collection('groups').doc(c.id).update({members:firebase.firestore.FieldValue.arrayRemove(state.currentUid)});
    state.activeConversation=null;state.view='chats';render();
    showToast('Ты покинул группу.');
  }catch(e){showToast('Не получилось покинуть группу.');}
}
async function deleteGroup(){
  const c=state.activeConversation;if(!c||c.kind!=='group')return;
  if(c.createdBy!==state.currentUid){showToast('Удалить группу может только админ.');return;}
  if(!window.confirm('Удалить группу «'+c.name+'» навсегда? Это действие необратимо.'))return;
  try{
    await db.collection('groups').doc(c.id).delete();
    state.activeConversation=null;state.view='chats';render();
    showToast('Группа удалена.');
  }catch(e){showToast('Не получилось удалить группу.');}
}

// ─── group info / settings render ──────────────────────────
function renderGroupInfo(){
  const c=state.activeConversation;if(!c||c.kind!=='group')return'';
  const isAdmin=c.createdBy===state.currentUid;
  const membersInfo=c.membersInfo||{};
  const memberList=(c.members||[]).map(uid=>{
    const info=membersInfo[uid]||{};
    const name=uid===state.currentUid?(info.name||'Ты')+' (ты)':(info.name||'Без имени');
    return`<div class="member-row"><div class="member-row-info">${renderAvatar({avatarEmoji:info.emoji||'☁️'},'tiny')}<span>${esc(name)}</span></div>${uid===c.createdBy?'<span class="group-tag">админ</span>':''}</div>`;
  }).join('');
  return`<div class="panel">
    <button type="button" class="back-btn" data-action="close-group-info" style="margin-bottom:10px;">← Назад в чат</button>
    <h2>${isAdmin?'Группа · настройки':'Группа'}</h2>
    ${isAdmin?`
      <div class="emoji-section-label">Эмодзи группы:</div>
      <div class="emoji-grid" style="grid-template-columns:repeat(6,1fr);margin-bottom:18px;">
        ${GROUP_EMOJIS.map(e=>`<button type="button" class="emoji-btn ${e===(groupEditDraft.emoji||c.emoji)?'selected':''}" data-action="pick-group-edit-emoji" data-emoji="${e}">${emojiToTwemoji(e)}</button>`).join('')}
      </div>
      <div class="field"><label>Название группы</label><input type="text" id="groupEditNameInput" value="${esc(groupEditDraft.name!=null?groupEditDraft.name:c.name)}" maxlength="40"></div>
      <div class="field"><label>Описание</label><textarea id="groupEditDescInput" rows="2" maxlength="200" placeholder="О чём эта группа?">${esc(groupEditDraft.description!=null?groupEditDraft.description:(c.description||''))}</textarea></div>
      <button type="button" class="btn-primary" data-action="save-group-edit">Сохранить изменения</button>
    `:`
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px;">${renderAvatar({avatarEmoji:c.emoji},'')}<div><div style="font-weight:600;font-size:17px;">${esc(c.name)}</div>${c.description?`<div style="color:var(--text-secondary);font-size:13px;margin-top:2px;">${esc(c.description)}</div>`:''}</div></div>
    `}

    <div class="settings-row-label" style="margin-top:22px;">Участники (${(c.members||[]).length})</div>
    <div class="member-pick-list">${memberList}</div>

    <div style="margin-top:22px;display:flex;flex-direction:column;gap:10px;">
      <button type="button" class="btn-primary" style="background:var(--bg-card);color:var(--danger);border:1px solid var(--border);" data-action="leave-group">🚪 Покинуть группу</button>
      ${isAdmin?`<button type="button" class="btn-primary" style="background:var(--danger);" data-action="delete-group">🗑️ Удалить группу</button>`:''}
    </div>
  </div>`;
}

function renderThread(){
  const c=state.activeConversation;
  const isGroup=c.kind==='group';
  const peerProfile=isGroup?{avatarEmoji:c.emoji}:{avatarEmoji:c.peerEmoji};
  const online=!isGroup&&visibleOnline(c.peerUid);const lsText=!isGroup&&visibleLastSeen(c.peerUid);
  let statusStr='';
  if(isGroup)statusStr=`${c.members.length} участников`;
  else statusStr=online?'онлайн':(lsText||'');
  const title=isGroup?c.name:c.peerName;
  const searchPanel=state.searchOpen?`
    <div class="search-panel">
      <input type="text" id="msgSearchInput" placeholder="Поиск по сообщениям…" value="${esc(state.searchQuery)}" autofocus>
      <div class="search-nav">
        <button data-action="search-prev">↑</button>
        <span class="search-count">${state.searchResults.length?`${state.searchIdx+1}/${state.searchResults.length}`:''}</span>
        <button data-action="search-next">↓</button>
      </div>
      <button class="search-close-btn" data-action="close-search">✕</button>
    </div>`:'';
  return`
    <div class="thread-header">
      <button class="back-btn" data-action="dm-back">←</button>
      <div class="thread-header-clickable" ${isGroup?'data-action="open-group-info"':''}>
        ${isGroup?renderAvatar(peerProfile,'small'):renderAvatarWithDot(peerProfile,'small',online)}
        <div class="thread-title-wrap">
          <div class="thread-name">${esc(title)}</div>
          ${statusStr?`<div class="thread-status">${esc(statusStr)}</div>`:''}
        </div>
      </div>
      <div class="thread-actions">
        <button class="icon-btn" data-action="toggle-search" title="Поиск">🔍</button>
        ${!isGroup?`<button class="call-btn-round" data-action="start-call">📞</button>`:''}
      </div>
    </div>
    ${searchPanel}
    ${renderPinnedBar()}
    <div class="chat-thread">
      <div class="messages-list" id="messagesList"><div class="loading-state">Загружаем…</div></div>
      <div class="typing-indicator" id="typingIndicator"></div>
      <div class="chat-error" id="chatError"></div>
      ${state.replyingTo?`<div class="reply-preview-bar"><div class="reply-preview-text"><b>${esc(state.replyingTo.senderName)}</b>: ${esc((state.replyingTo.text||'').slice(0,60))}</div><button type="button" data-action="cancel-reply">✕</button></div>`:''}
      <form class="chat-input-bar" data-form="chat-message">
        <input type="file" id="chatFileInput" style="display:none">
        <button type="button" class="attach-btn" data-action="open-attach" title="Прикрепить файл">📎</button>
        <input type="text" id="chatTextInput" name="text" placeholder="Напиши сообщение…" autocomplete="off">
        <button type="submit" class="send-btn">➤</button>
      </form>
    </div>`;
}

function renderPinnedBar(){
  const ids=state.pinnedMsgs||[];
  if(!ids.length)return'';
  return`<div class="pinned-bar"><div class="pinned-bar-icon">📌</div><div class="pinned-bar-list">${ids.map(id=>{
    const m=messagesCache.find(mm=>mm.id===id);
    const txt=m?(m.text||(m.attachment?'Вложение: '+(m.attachment.name||m.attachment.type):'')):'Сообщение';
    return`<div class="pinned-bar-item" data-action="scroll-to-pinned" data-msg-id="${id}">
      <span class="pinned-bar-text"><b>${m?esc(m.senderName||''):''}</b> ${esc((txt||'').slice(0,60))}</span>
      <button class="pinned-bar-unpin" data-action="unpin-message" data-msg-id="${id}" title="Открепить">✕</button>
    </div>`;
  }).join('')}</div></div>`;
}

// ─── search ──────────────────────────────────────────────
function runSearch(){
  const q=state.searchQuery.trim().toLowerCase();
  if(!q){state.searchResults=[];state.searchIdx=0;updateMessagesList(messagesCache);return;}
  const results=[];
  messagesCache.forEach((msg,i)=>{if((msg.text||'').toLowerCase().includes(q))results.push(i);});
  state.searchResults=results;state.searchIdx=results.length>0?results.length-1:0;
  updateMessagesList(messagesCache);if(results.length>0)scrollToSearchResult();
}
function scrollToSearchResult(){
  const idx=state.searchResults[state.searchIdx];if(idx==null)return;
  const el=document.getElementById('messagesList');if(!el)return;
  const rows=el.querySelectorAll('.msg-row');
  if(rows[idx])rows[idx].scrollIntoView({block:'center',behavior:'smooth'});
}
function highlightText(text,query){
  if(!query)return esc(text);
  const escaped=esc(text);const escapedQ=esc(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return escaped.replace(new RegExp(`(${escapedQ})`,'gi'),'<mark>$1</mark>');
}

function readTicksHtml(msg,isMe){
  if(!isMe)return'';
  const conv=state.activeConversation;
  if(!conv||conv.kind!=='dm')return'';
  const isRead=state.peerLastReadMs&&tsMs(msg.createdAt)<=state.peerLastReadMs;
  return` <span class="read-tick ${isRead?'read':''}">${isRead?'✓✓':'✓'}</span>`;
}

// ─── messages ────────────────────────────────────────────
function reactionsHtml(msg){
  const reactions=msg.reactions||{};const totals={};
  for(const[uid,emoji]of Object.entries(reactions))totals[emoji]=(totals[emoji]||0)+1;
  const pills=Object.entries(totals).map(([emoji,count])=>{
    const mine=reactions[state.currentUid]===emoji;
    return`<div class="reaction-pill ${mine?'mine':''}" data-action="toggle-reaction" data-msg-id="${msg.id}" data-emoji="${emoji}">${emojiToTwemoji(emoji)}<span class="count">${count}</span></div>`;
  });
  return pills.length?`<div class="msg-reactions">${pills.join('')}</div>`:'';
}

function renderAttachment(att){
  if(!att)return'';
  if(att.type==='image')return`<a href="${att.url}" target="_blank" rel="noopener"><img src="${att.url}" class="att-image" alt="${esc(att.name||'фото')}"></a>`;
  if(att.type==='video')return`<video src="${att.url}" class="att-video" controls preload="metadata"></video>`;
  if(att.type==='audio')return`<audio src="${att.url}" class="att-audio" controls></audio>`;
  return`<a class="att-file" href="${att.url}" target="_blank" rel="noopener" download="${esc(att.name||'file')}">
    <span class="att-file-icon">📄</span>
    <span class="att-file-info"><span class="att-file-name">${esc(att.name||'Файл')}</span><span class="att-file-size">${esc(formatSize(att.size))}</span></span>
    <span class="att-file-dl">⬇</span>
  </a>`;
}

function renderMessageBubble(msg,idx){
  const isMe=msg.senderUid===state.currentUid;
  const q=state.searchQuery.trim().toLowerCase();
  const isCurrent=q&&state.searchResults[state.searchIdx]===idx;
  const isPinned=(state.pinnedMsgs||[]).includes(msg.id);
  const senderProfile={avatarEmoji:msg.senderEmoji||'☁️'};
  const isGroup=state.activeConversation&&state.activeConversation.kind==='group';
  const isEditing=state.editingMsgId===msg.id;
  const replyBlock=msg.replyTo?`<div class="msg-reply-quote" data-action="scroll-to-pinned" data-msg-id="${msg.replyTo.id}"><b>${esc(msg.replyTo.senderName||'')}</b><span>${esc((msg.replyTo.text||'').slice(0,60))}</span></div>`:'';
  const bodyHtml=isEditing
    ?`<div class="msg-edit-wrap"><input type="text" class="msg-edit-input" data-msg-id="${msg.id}" value="${esc(state.editingText)}" maxlength="2000"><div class="msg-edit-actions"><button type="button" data-action="save-edit-message" data-msg-id="${msg.id}">Сохранить</button><button type="button" data-action="cancel-edit-message">Отмена</button></div></div>`
    :`${replyBlock}${msg.attachment?renderAttachment(msg.attachment):''}${msg.text?`<div class="msg-text">${highlightText(msg.text,q)}</div>`:''}`;
  return`<div class="msg-row ${isMe?'me':''}" data-msg-id="${msg.id}" data-kind="${state.activeConversation?state.activeConversation.kind:'dm'}" data-conv-id="${state.activeConversation?state.activeConversation.id:''}">
    ${!isMe?renderAvatar(senderProfile,'tiny'):''}
    <div class="msg-bubble ${isCurrent?'highlight':''} ${isPinned?'pinned':''}" ${isEditing?'':'data-action="open-reaction-picker"'} data-msg-id="${msg.id}">
      ${isEditing?'':'<div class="msg-react-hint">Действия···</div>'}
      ${isPinned?'<div class="msg-pin-flag">📌 закреплено</div>':''}
      ${!isMe&&isGroup?`<div class="msg-sender">${esc(msg.senderName||'')}</div>`:''}
      ${bodyHtml}
      <div class="msg-time">${timeAgo(msg.createdAt)}${msg.edited?' · изменено':''}${readTicksHtml(msg,isMe)}</div>
      ${reactionsHtml(msg)}
    </div>
  </div>`;
}

function updateMessagesList(messages){
  messagesCache=messages;const el=document.getElementById('messagesList');if(!el)return;
  const wasAtBottom=el.scrollHeight-el.scrollTop-el.clientHeight<60;
  if(!messages||messages.length===0){el.innerHTML=`<div class="empty-state">Напиши первым!</div>`;return;}
  el.innerHTML=messages.map((m,i)=>renderMessageBubble(m,i)).join('');
  if(state.searchResults.length>0)scrollToSearchResult();
  else if(wasAtBottom)el.scrollTop=el.scrollHeight;
}

// ─── reaction picker ─────────────────────────────────────
function openReactionPicker(msgId,bubbleEl){
  closeReactionPicker();
  const conv=state.activeConversation;if(!conv)return;
  reactionPickerOpen={msgId};
  const isPinned=(state.pinnedMsgs||[]).includes(msgId);
  const msg=messagesCache.find(m=>m.id===msgId);
  const isMe=msg&&msg.senderUid===state.currentUid;
  const picker=document.createElement('div');picker.className='reaction-picker';picker.id='reactionPicker';
  const quickRow=`<div class="rp-quick-row">${REACTION_EMOJIS.map(e=>`<button class="rp-quick-emoji" data-action="pick-reaction" data-emoji="${e}" data-msg-id="${msgId}">${emojiToTwemoji(e)}</button>`).join('')}</div>`;
  const menuItem=(action,icon,label)=>`<button class="rp-menu-item" data-action="${action}" data-msg-id="${msgId}"><span class="rp-menu-icon">${icon}</span><span>${label}</span></button>`;
  const menu=`<div class="rp-menu">
    ${menuItem('reply-to-message','↩️','Ответить')}
    ${menuItem(isPinned?'unpin-message':'pin-message','📌',isPinned?'Открепить':'Закрепить')}
    ${isMe?menuItem('start-edit-message','✏️','Редактировать'):''}
    ${isMe?menuItem('delete-message','🗑️','Удалить'):''}
  </div>`;
  picker.innerHTML=quickRow+menu;
  document.body.appendChild(picker);
  const rect=bubbleEl.getBoundingClientRect();
  const pickerHeight=picker.offsetHeight||260;
  let top=rect.top-pickerHeight-8,left=rect.left;
  if(top<8)top=Math.min(rect.bottom+6,window.innerHeight-pickerHeight-8);
  if(left+240>window.innerWidth)left=window.innerWidth-248;
  picker.style.top=top+'px';picker.style.left=left+'px';
  setTimeout(()=>document.addEventListener('click',closePicker,{once:true,capture:true}),50);
}
function closePicker(e){if(e&&document.getElementById('reactionPicker')?.contains(e.target))return;closeReactionPicker();}
function closeReactionPicker(){const el=document.getElementById('reactionPicker');if(el)el.remove();reactionPickerOpen=null;}
async function toggleReaction(msgId,emoji){
  closeReactionPicker();
  const conv=state.activeConversation;if(!conv)return;
  try{
    const ref=convRef(conv).collection('messages').doc(msgId);
    const doc=await ref.get();const data=doc.data();const reactions=data.reactions||{};
    if(reactions[state.currentUid]===emoji)delete reactions[state.currentUid];else reactions[state.currentUid]=emoji;
    await ref.update({reactions});
  }catch(e){showToast('Не получилось поставить реакцию.');}
}

// ─── pinning ──────────────────────────────────────────────
async function pinMessage(msgId){
  closeReactionPicker();
  const conv=state.activeConversation;if(!conv)return;
  try{
    await convRef(conv).update({pinned:firebase.firestore.FieldValue.arrayUnion(msgId)});
  }catch(e){showToast('Не получилось закрепить.');}
}
async function unpinMessage(msgId){
  closeReactionPicker();
  const conv=state.activeConversation;if(!conv)return;
  try{
    await convRef(conv).update({pinned:firebase.firestore.FieldValue.arrayRemove(msgId)});
  }catch(e){showToast('Не получилось открепить.');}
}
function scrollToPinned(msgId){
  const el=document.getElementById('messagesList');if(!el)return;
  const row=el.querySelector(`.msg-row[data-msg-id="${msgId}"]`);
  if(row)row.scrollIntoView({block:'center',behavior:'smooth'});
  else showToast('Сообщение не загружено (слишком старое).');
}

// ─── reply / edit / delete ─────────────────────────────────
function replyToMessage(msgId){
  closeReactionPicker();
  const msg=messagesCache.find(m=>m.id===msgId);if(!msg)return;
  state.replyingTo={id:msg.id,text:msg.text||(msg.attachment?'📎 '+(msg.attachment.name||'вложение'):''),senderName:msg.senderName||'Друг'};
  render();updateMessagesList(messagesCache);
  const input=document.getElementById('chatTextInput');if(input)input.focus();
}
function cancelReply(){state.replyingTo=null;render();updateMessagesList(messagesCache);}
function startEditMessage(msgId){
  closeReactionPicker();
  const msg=messagesCache.find(m=>m.id===msgId);if(!msg||msg.senderUid!==state.currentUid)return;
  state.editingMsgId=msgId;state.editingText=msg.text||'';
  updateMessagesList(messagesCache);
  const ta=document.querySelector(`.msg-edit-input[data-msg-id="${msgId}"]`);
  if(ta){ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);}
}
function cancelEditMessage(){state.editingMsgId=null;state.editingText='';updateMessagesList(messagesCache);}
async function saveEditMessage(msgId){
  const conv=state.activeConversation;if(!conv)return;
  const ta=document.querySelector(`.msg-edit-input[data-msg-id="${msgId}"]`);
  const text=(ta?ta.value:state.editingText).trim();
  state.editingMsgId=null;state.editingText='';
  if(!text){updateMessagesList(messagesCache);return;}
  try{
    await convRef(conv).collection('messages').doc(msgId).update({text:text.slice(0,2000),edited:true});
  }catch(e){showToast('Не получилось изменить сообщение.');}
}
async function deleteMessage(msgId){
  closeReactionPicker();
  const conv=state.activeConversation;if(!conv)return;
  if(!window.confirm('Удалить это сообщение?'))return;
  try{await convRef(conv).collection('messages').doc(msgId).delete();}
  catch(e){showToast('Не получилось удалить сообщение.');}
}

// ─── online presence ─────────────────────────────────────
function startOnlinePresence(){
  stopOnlinePresence();
  const upd=()=>{if(!state.currentUid)return;db.collection('profiles').doc(state.currentUid).update({lastSeen:firebase.firestore.FieldValue.serverTimestamp()}).catch(()=>{});};
  upd();onlineHeartbeatTimer=setInterval(upd,ONLINE_TTL-5000);
  onlineUnsub=db.collection('profiles').onSnapshot(snap=>{
    snap.forEach(doc=>{const d=doc.data();if(d.lastSeen)onlineMap[doc.id]=tsMs(d.lastSeen);});
    if(state.view==='directory')render();
    else if(state.view==='chats'&&state.activeConversation)refreshThreadHeader();
    else if(state.view==='chats'&&!state.activeConversation)render();
  });
}
function refreshThreadHeader(){
  const c=state.activeConversation;if(!c)return;
  const online=visibleOnline(c.peerUid);const lsText=visibleLastSeen(c.peerUid);
  const statusStr=online?'онлайн':(lsText||'');
  const statusEl=document.querySelector('.thread-status');if(statusEl)statusEl.textContent=statusStr;
  const wrap=document.querySelector('.thread-header .avatar-wrap.small');
  if(wrap){const dot=wrap.querySelector('.online-dot');if(online&&!dot)wrap.insertAdjacentHTML('beforeend','<div class="online-dot"></div>');else if(!online&&dot)dot.remove();}
}
function stopOnlinePresence(){clearInterval(onlineHeartbeatTimer);if(onlineUnsub){onlineUnsub();onlineUnsub=null;}}

// ─── auth actions ────────────────────────────────────────
async function handleRegister(email,password,confirm,displayName){
  state.errorMsg='';email=(email||'').trim().toLowerCase();displayName=(displayName||'').trim();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){state.errorMsg='Введи настоящий email.';render();return;}
  if(!displayName){state.errorMsg='Укажи имя.';render();return;}
  if((password||'').length<6){state.errorMsg='Пароль минимум 6 символов.';render();return;}
  if(password!==confirm){state.errorMsg='Пароли не совпадают.';render();return;}
  state.busy=true;render();
  try{
    const cred=await auth.createUserWithEmailAndPassword(email,password);
    await db.collection('profiles').doc(cred.user.uid).set({email,displayName:displayName.slice(0,30),avatarEmoji:'☁️',status:'',createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
  }catch(e){state.busy=false;state.errorMsg=mapErr(e);render();}
}
async function handleLogin(email,password){
  state.errorMsg='';email=(email||'').trim().toLowerCase();
  if(!email||!password){state.errorMsg='Заполни email и пароль.';render();return;}
  state.busy=true;render();
  try{await auth.signInWithEmailAndPassword(email,password);}
  catch(e){state.busy=false;state.errorMsg=mapErr(e);render();}
}
function handleLogout(){if(callState.status!=='idle')hangupCall();auth.signOut();}
async function handleSaveProfile(displayName,status){
  state.errorMsg='';state.saveMsg='';displayName=(displayName||'').trim();
  if(!displayName){state.errorMsg='Имя не может быть пустым.';render();return;}
  state.busy=true;render();
  // если есть загруженное фото — берём его, иначе всегда берём выбранный эмодзи
  const avatarToSave=customAvatarBase64||selectedEmoji;
  try{
    await db.collection('profiles').doc(state.currentUid).set({
      email:state.currentEmail,displayName:displayName.slice(0,30),
      status:(status||'').slice(0,140),
      avatarEmoji:avatarToSave,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    },{merge:true});
  }catch(e){state.busy=false;state.errorMsg='Не получилось сохранить. Если загружено фото — попробуй уменьшить его размер.';render();return;}
  state.busy=false;
  state.currentProfile={...state.currentProfile,displayName,status,avatarEmoji:avatarToSave};
  avatarDirty=false;
  state.saveMsg='Сохранено!';render();
}

// ─── directory sub ───────────────────────────────────────
function subscribeDirectory(){
  state.busy=!state.directoryLoaded;render();
  if(directoryUnsub)directoryUnsub();
  directoryUnsub=db.collection('profiles').onSnapshot(snap=>{
    const profiles=[];snap.forEach(doc=>profiles.push({uid:doc.id,...doc.data()}));
    state.directory=profiles;state.directoryLoaded=true;state.busy=false;state.errorMsg='';
    if(state.view==='directory')render();
  },err=>{state.errorMsg=mapErr(err);state.busy=false;if(state.view==='directory')render();});
}
function unsubscribeDirectory(){if(directoryUnsub){directoryUnsub();directoryUnsub=null;}}

// ─── privacy ──────────────────────────────────────────────
async function setPrivacy(value){
  if(!state.currentUid)return;
  try{
    await db.collection('profiles').doc(state.currentUid).set({allowMessagesFrom:value},{merge:true});
    if(state.currentProfile)state.currentProfile.allowMessagesFrom=value;
    showToast(value==='friends'?'Теперь тебе могут писать первыми только друзья.':'Теперь тебе могут писать все.');
    render();
  }catch(e){showToast('Не получилось сохранить настройку.');}
}
async function setOnlineVisibility(value){
  if(!state.currentUid)return;
  try{
    await db.collection('profiles').doc(state.currentUid).set({showOnlineTo:value},{merge:true});
    if(state.currentProfile)state.currentProfile.showOnlineTo=value;
    showToast('Настройка статуса сохранена ✓');
    render();
  }catch(e){showToast('Не получилось сохранить настройку.');}
}

// ─── friends ──────────────────────────────────────────────
function friendPairId(a,b){return[a,b].sort().join('_');}
function subscribeFriends(){
  if(friendsUnsub)friendsUnsub();state.friendsLoaded=false;
  friendsUnsub=db.collection('friends').where('users','array-contains',state.currentUid).onSnapshot(snap=>{
    const ids=[];snap.forEach(doc=>{const d=doc.data();const other=(d.users||[]).find(u=>u!==state.currentUid);if(other)ids.push(other);});
    state.friends=ids;state.friendsLoaded=true;
    if(state.view==='directory'||state.view==='new-group')render();
  },()=>{state.friendsLoaded=true;});
}
function unsubscribeFriends(){if(friendsUnsub){friendsUnsub();friendsUnsub=null;}}
async function addFriend(uid,name,emoji){
  if(!uid||uid===state.currentUid)return;
  try{
    await db.collection('friends').doc(friendPairId(state.currentUid,uid)).set({
      users:[state.currentUid,uid],
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),
      info:{[state.currentUid]:{name:state.currentProfile.displayName,emoji:state.currentProfile.avatarEmoji},[uid]:{name,emoji}}
    });
    showToast('Добавлено в друзья ✓');
  }catch(e){showToast('Не получилось добавить в друзья.');}
}
async function removeFriend(uid){
  if(!uid)return;
  try{await db.collection('friends').doc(friendPairId(state.currentUid,uid)).delete();showToast('Убрано из друзей.');}
  catch(e){showToast('Не получилось убрать из друзей.');}
}

// ─── conversations ───────────────────────────────────────
function openConversation(peerUid,peerName,peerEmoji){
  const alreadyChatting=state.dmList.some(c=>c.peerUid===peerUid);
  if(!alreadyChatting){
    const peerProfile=state.directory.find(p=>p.uid===peerUid);
    const peerPrivacy=(peerProfile&&peerProfile.allowMessagesFrom)||'everyone';
    if(peerPrivacy==='friends'&&!state.friends.includes(peerUid)){
      showToast(`${peerName} принимает сообщения только от друзей. Добавь в друзья, чтобы написать первым.`);
      return;
    }
  }
  state.activeConversation={kind:'dm',id:convId(state.currentUid,peerUid),peerUid,peerName,peerEmoji};
  state.searchOpen=false;state.searchQuery='';state.searchResults=[];state.searchIdx=0;state.pinnedMsgs=[];state.peerTyping=false;state.peerLastReadMs=0;
  state.view='chats';render();subscribeThread();subscribeConvMeta();
}
function openGroup(g){
  state.activeConversation={kind:'group',id:g.id,name:g.name,emoji:g.emoji,members:g.members,membersInfo:g.membersInfo||{},createdBy:g.createdBy||'',description:g.description||''};
  state.searchOpen=false;state.searchQuery='';state.searchResults=[];state.searchIdx=0;state.pinnedMsgs=g.pinned||[];state.peerTyping=false;
  state.view='chats';render();subscribeThread();subscribeConvMeta();
}
function subscribeThread(){
  if(dmThreadUnsub)dmThreadUnsub();
  const conv=state.activeConversation;if(!conv)return;
  dmThreadUnsub=convRef(conv).collection('messages').orderBy('createdAt','desc').limit(200)
    .onSnapshot(snap=>{
      const msgs=[];snap.forEach(doc=>msgs.push({id:doc.id,...doc.data()}));msgs.reverse();
      msgs.forEach(msg=>{
        if(msg.senderUid!==state.currentUid&&!lastSeenMsg[msg.id]){
          lastSeenMsg[msg.id]=true;
          if(document.hidden||!document.hasFocus())sendNativeNotification('CloudMe · '+(msg.senderName||'Друг'),msg.text?msg.text.slice(0,80):'Новое сообщение');
        }
      });
      if(state.searchQuery.trim())runSearch();else updateMessagesList(msgs);
      if(conv.kind==='dm'){
        convRef(conv).set({[`lastRead.${state.currentUid}`]:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}).catch(()=>{});
      }
    },err=>{const el=document.getElementById('messagesList');if(el)el.innerHTML=`<div class="empty-state">${esc(mapErr(err))}</div>`;});
}
function unsubscribeDmThread(){if(dmThreadUnsub){dmThreadUnsub();dmThreadUnsub=null;}}
function subscribeConvMeta(){
  if(convMetaUnsub)convMetaUnsub();
  const conv=state.activeConversation;if(!conv)return;
  convMetaUnsub=convRef(conv).onSnapshot(doc=>{
    const data=doc.data();if(!data)return;
    state.pinnedMsgs=data.pinned||[];
    const typing=data.typing||{};
    const otherTyping=Object.entries(typing).some(([uid,ts])=>uid!==state.currentUid&&Date.now()-tsMs(ts)<5000);
    state.peerTyping=otherTyping;
    if(conv.kind==='dm'){
      const lastRead=data.lastRead||{};
      const peerReadMs=tsMs(lastRead[conv.peerUid]);
      if(peerReadMs!==state.peerLastReadMs){state.peerLastReadMs=peerReadMs;updateMessagesList(messagesCache);}
    }
    refreshThreadExtras();
  });
}
function unsubscribeConvMeta(){if(convMetaUnsub){convMetaUnsub();convMetaUnsub=null;}}
function refreshThreadExtras(){
  if(state.view!=='chats'||!state.activeConversation)return;
  const ti=document.getElementById('typingIndicator');
  if(ti){
    const conv=state.activeConversation;
    const who=conv.kind==='group'?'Кто-то печатает…':`${esc(conv.peerName)} печатает…`;
    ti.textContent=state.peerTyping?who.replace(/<[^>]+>/g,s=>s):'';
    ti.innerHTML=state.peerTyping?who:'';
  }
  const pinnedWrap=document.querySelector('.pinned-bar');
  const newPinnedHtml=renderPinnedBar();
  if(newPinnedHtml&&!pinnedWrap){
    const searchPanel=document.querySelector('.search-panel');
    const anchor=searchPanel||document.querySelector('.thread-header');
    if(anchor)anchor.insertAdjacentHTML('afterend',newPinnedHtml);
  }else if(pinnedWrap){
    if(!newPinnedHtml)pinnedWrap.remove();
    else pinnedWrap.outerHTML=newPinnedHtml;
  }
}
function subscribeDmList(){
  if(dmListUnsub)dmListUnsub();state.dmListLoaded=false;
  dmListUnsub=db.collection('conversations').where('participants','array-contains',state.currentUid).onSnapshot(snap=>{
    const list=[];
    snap.forEach(doc=>{
      const data=doc.data();const peerUid=(data.participants||[]).find(u=>u!==state.currentUid);
      const info=(data.participantsInfo&&data.participantsInfo[peerUid])||{};
      list.push({peerUid,peerName:info.name||'Без имени',peerEmoji:info.emoji||'☁️',lastMessage:data.lastMessage||'',lastMessageAt:data.lastMessageAt});
    });
    state.dmList=list;state.dmListLoaded=true;rebuildChatList();
    if(state.view==='chats'&&!state.activeConversation)render();
  },()=>{state.dmListLoaded=true;rebuildChatList();if(state.view==='chats'&&!state.activeConversation)render();});
}
function unsubscribeDmList(){if(dmListUnsub){dmListUnsub();dmListUnsub=null;}}
function subscribeGroupList(){
  if(groupListUnsub)groupListUnsub();state.groupListLoaded=false;
  groupListUnsub=db.collection('groups').where('members','array-contains',state.currentUid).onSnapshot(snap=>{
    const list=[];
    snap.forEach(doc=>{const d=doc.data();list.push({id:doc.id,name:d.name||'Группа',emoji:d.emoji||'👥',description:d.description||'',members:d.members||[],membersInfo:d.membersInfo||{},createdBy:d.createdBy||'',lastMessage:d.lastMessage||'',lastMessageAt:d.lastMessageAt,pinned:d.pinned||[]});});
    state.groupList=list;state.groupListLoaded=true;rebuildChatList();
    if(state.activeConversation&&state.activeConversation.kind==='group'){
      const fresh=list.find(g=>g.id===state.activeConversation.id);
      if(fresh){state.activeConversation={...state.activeConversation,...fresh,kind:'group'};if(state.view==='group-info')render();}
      else if(state.view==='group-info'||state.view==='chats'){
        // группу удалили или нас исключили
        if(state.activeConversation.id===((state.viewingGroup&&state.viewingGroup.id)||null)){state.view='chats';state.activeConversation=null;render();}
      }
    }
    if(state.view==='chats'&&!state.activeConversation)render();
  },()=>{state.groupListLoaded=true;rebuildChatList();if(state.view==='chats'&&!state.activeConversation)render();});
}
function unsubscribeGroupList(){if(groupListUnsub){groupListUnsub();groupListUnsub=null;}}

// ─── typing ──────────────────────────────────────────────
function notifyTyping(){
  const conv=state.activeConversation;if(!conv)return;
  convRef(conv).set({[`typing.${state.currentUid}`]:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}).catch(()=>{});
  clearTimeout(typingTimeout);
  typingTimeout=setTimeout(()=>{convRef(conv).set({[`typing.${state.currentUid}`]:firebase.firestore.FieldValue.delete()},{merge:true}).catch(()=>{});},3000);
}
function clearTypingNow(){
  const conv=state.activeConversation;if(!conv)return;
  clearTimeout(typingTimeout);
  convRef(conv).set({[`typing.${state.currentUid}`]:firebase.firestore.FieldValue.delete()},{merge:true}).catch(()=>{});
}

async function sendMessage(text,attachment){
  text=(text||'').trim();if(!text&&!attachment)return;
  const errEl=document.getElementById('chatError');if(errEl)errEl.textContent='';
  const conv=state.activeConversation;if(!conv)return;
  const message={senderUid:state.currentUid,senderName:state.currentProfile.displayName,senderEmoji:state.currentProfile.avatarEmoji,text:text.slice(0,2000),createdAt:firebase.firestore.FieldValue.serverTimestamp(),reactions:{}};
  if(attachment)message.attachment=attachment;
  if(state.replyingTo)message.replyTo={id:state.replyingTo.id,senderName:state.replyingTo.senderName,text:state.replyingTo.text};
  const preview=text?text.slice(0,60):(attachment?'📎 '+(attachment.name||'вложение'):'');
  try{
    await convRef(conv).collection('messages').add(message);
    clearTypingNow();
    state.replyingTo=null;
    const replyBar=document.querySelector('.reply-preview-bar');if(replyBar)replyBar.remove();
    if(conv.kind==='group'){
      await db.collection('groups').doc(conv.id).set({lastMessage:preview,lastMessageAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    }else{
      await db.collection('conversations').doc(conv.id).set({participants:[state.currentUid,conv.peerUid],participantsInfo:{[state.currentUid]:{name:state.currentProfile.displayName,emoji:state.currentProfile.avatarEmoji},[conv.peerUid]:{name:conv.peerName,emoji:conv.peerEmoji}},lastMessage:preview,lastMessageAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    }
  }catch(e){if(errEl)errEl.textContent='Не получилось отправить.';}
}

// ─── attachments upload ──────────────────────────────────
async function handleFileSelected(file){
  if(!file)return;
  const conv=state.activeConversation;if(!conv)return;
  if(file.size>25*1024*1024){showToast('Файл больше 25 МБ — слишком большой.');return;}
  state.uploadingFile=true;showToast('Загружаем файл…');
  try{
    const path=`attachments/${conv.id}/${Date.now()}_${file.name}`.replace(/\s+/g,'_');
    const ref=storage.ref().child(path);
    await ref.put(file);
    const url=await ref.getDownloadURL();
    const attachment={type:attachKindFromMime(file.type),url,name:file.name,size:file.size};
    await sendMessage('',attachment);
    showToast('Отправлено ✓');
  }catch(e){showToast('Не получилось загрузить файл.');}
  state.uploadingFile=false;
}

// ─── groups: create ───────────────────────────────────────
function openNewGroupView(){
  groupDraft={name:'',selectedUids:new Set()};selectedGroupEmoji='👥';state.errorMsg='';
  state.view='new-group';render();
}
async function submitNewGroup(){
  const nameInput=document.getElementById('groupNameInput');
  const name=(nameInput?nameInput.value:groupDraft.name||'').trim();
  if(!name){state.errorMsg='Дай группе название.';render();return;}
  if(groupDraft.selectedUids.size===0){state.errorMsg='Выбери хотя бы одного друга.';render();return;}
  state.busy=true;state.errorMsg='';render();
  const membersInfo={[state.currentUid]:{name:state.currentProfile.displayName,emoji:state.currentProfile.avatarEmoji}};
  state.directory.forEach(p=>{if(groupDraft.selectedUids.has(p.uid))membersInfo[p.uid]={name:p.displayName||p.email,emoji:p.avatarEmoji||'☁️'};});
  try{
    const ref=await db.collection('groups').add({
      name:name.slice(0,40),emoji:selectedGroupEmoji,
      members:[state.currentUid,...Array.from(groupDraft.selectedUids)],
      membersInfo,createdBy:state.currentUid,
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),
      lastMessage:'Группа создана',lastMessageAt:firebase.firestore.FieldValue.serverTimestamp(),
      typing:{},pinned:[]
    });
    state.busy=false;
    openGroup({id:ref.id,name:name.slice(0,40),emoji:selectedGroupEmoji,members:[state.currentUid,...Array.from(groupDraft.selectedUids)],pinned:[]});
  }catch(e){state.busy=false;state.errorMsg='Не получилось создать группу.';render();}
}


// ─── video calls ─────────────────────────────────────────
function ensureCallOverlay(){let el=document.getElementById('callOverlayRoot');if(!el){el=document.createElement('div');el.id='callOverlayRoot';document.body.appendChild(el);}return el;}
function renderCallOverlay(){
  const el=ensureCallOverlay();
  if(callState.status==='idle'){el.innerHTML='';el.style.display='none';return;}
  el.style.display='flex';
  if(callState.status==='incoming'){el.innerHTML=`<div class="call-card"><div class="call-avatar-big">${callState.peerEmoji}</div><div class="call-title">Звонит ${esc(callState.peerName)}</div><div class="call-actions"><button class="cbtn decline" data-action="call-decline">Отклонить</button><button class="cbtn accept" data-action="call-accept">Принять</button></div></div>`;return;}
  if(callState.status==='calling'){el.innerHTML=`<div class="call-card"><div class="call-avatar-big">${callState.peerEmoji}</div><div class="call-title">Звоним ${esc(callState.peerName)}…</div><video id="localVideoSmall" class="local-only-video" autoplay muted playsinline></video><div class="call-actions"><button class="cbtn decline" data-action="call-hangup">Отменить</button></div></div>`;const v=document.getElementById('localVideoSmall');if(v&&callState.localStream)v.srcObject=callState.localStream;return;}
  if(callState.status==='in-call'){el.innerHTML=`<div class="call-card in-call"><div class="remote-wrap"><video id="remoteVideo" class="remote-video" autoplay playsinline></video><video id="localVideoPip" class="pip-video" autoplay muted playsinline></video></div><div class="call-title">${esc(callState.peerName)}</div><div class="call-actions"><button class="cbtn icon" id="callMuteBtn" data-action="call-toggle-mute">🎤</button><button class="cbtn icon" id="callCamBtn" data-action="call-toggle-cam">📷</button><button class="cbtn decline" data-action="call-hangup">Завершить</button></div></div>`;const rv=document.getElementById('remoteVideo');const lv=document.getElementById('localVideoPip');if(rv&&callState.remoteStream)rv.srcObject=callState.remoteStream;if(lv&&callState.localStream)lv.srcObject=callState.localStream;}
}
function resetCallState(){callState={status:'idle',callId:null,peerUid:null,peerName:'',peerEmoji:'☁️',pc:null,localStream:null,remoteStream:null,unsubs:[],role:null,offer:null};if(callRingTimeout){clearTimeout(callRingTimeout);callRingTimeout=null;}}
function cleanupPeer(){if(callState.pc){try{callState.pc.close();}catch(e){}}if(callState.localStream){callState.localStream.getTracks().forEach(t=>{try{t.stop();}catch(e){}});}callState.unsubs.forEach(u=>{if(u)try{u();}catch(e){}});if(callRingTimeout){clearTimeout(callRingTimeout);callRingTimeout=null;}}
async function cleanupCallDoc(callId){try{const ref=db.collection('calls').doc(callId);for(const col of['callerCandidates','calleeCandidates']){const snap=await ref.collection(col).get();await Promise.all(snap.docs.map(d=>d.ref.delete()));}await ref.delete();}catch(e){}}
async function startCall(peerUid,peerName,peerEmoji){
  if(callState.status!=='idle'){showToast('Уже идёт звонок.');return;}
  let localStream;try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});}catch(e){showToast('Нет доступа к камере.');return;}
  const callId=db.collection('calls').doc().id;const pc=new RTCPeerConnection(RTC_CONFIG);
  localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  const remoteStream=new MediaStream();pc.ontrack=e=>{e.streams[0].getTracks().forEach(t=>remoteStream.addTrack(t));};
  pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState)&&callState.status==='in-call'){showToast('Звонок прервался.');hangupCall();}};
  callState={status:'calling',callId,peerUid,peerName,peerEmoji,pc,localStream,remoteStream,role:'caller',unsubs:[]};renderCallOverlay();
  pc.onicecandidate=e=>{if(e.candidate)db.collection('calls').doc(callId).collection('callerCandidates').add(e.candidate.toJSON()).catch(()=>{});};
  try{const offer=await pc.createOffer();await pc.setLocalDescription(offer);await db.collection('calls').doc(callId).set({callerUid:state.currentUid,callerName:state.currentProfile.displayName,callerEmoji:state.currentProfile.avatarEmoji,calleeUid:peerUid,offer:{type:offer.type,sdp:offer.sdp},status:'ringing',createdAt:firebase.firestore.FieldValue.serverTimestamp()});}
  catch(e){showToast('Не получилось начать звонок.');cleanupPeer();resetCallState();renderCallOverlay();return;}
  const unsubCall=db.collection('calls').doc(callId).onSnapshot(async doc=>{const data=doc.data();if(!data)return;if(data.answer&&callState.status==='calling'){try{await pc.setRemoteDescription(new RTCSessionDescription(data.answer));callState.status='in-call';renderCallOverlay();}catch(e){}}if(data.status==='declined'){showToast('Звонок отклонён.');endCallRemote();}if(data.status==='ended'&&callState.status!=='idle'){endCallRemote();}});
  callState.unsubs.push(unsubCall);
  const unsubCand=db.collection('calls').doc(callId).collection('calleeCandidates').onSnapshot(snap=>{snap.docChanges().forEach(ch=>{if(ch.type==='added')pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(()=>{});});});callState.unsubs.push(unsubCand);
  callRingTimeout=setTimeout(()=>{if(callState.status==='calling'){showToast('Никто не ответил.');hangupCall();}},30000);
}
function subscribeIncomingCalls(){
  if(incomingCallUnsub)incomingCallUnsub();
  incomingCallUnsub=db.collection('calls').where('calleeUid','==',state.currentUid).where('status','==','ringing').onSnapshot(snap=>{
    snap.docChanges().forEach(ch=>{
      if(ch.type==='added'&&callState.status==='idle'){
        const data=ch.doc.data();const callId=ch.doc.id;
        callState={status:'incoming',callId,peerUid:data.callerUid,peerName:data.callerName,peerEmoji:data.callerEmoji,offer:data.offer,pc:null,localStream:null,remoteStream:null,role:'callee',unsubs:[]};
        renderCallOverlay();sendNativeNotification('CloudMe · Входящий звонок','Звонит '+data.callerName);
        const unsub=db.collection('calls').doc(callId).onSnapshot(d=>{const dd=d.data();if((!dd||dd.status==='ended'||dd.status==='declined')&&callState.callId===callId&&callState.status==='incoming'){resetCallState();renderCallOverlay();}});callState.unsubs.push(unsub);
      }
    });
  });
}
function unsubscribeIncomingCalls(){if(incomingCallUnsub){incomingCallUnsub();incomingCallUnsub=null;}}
async function acceptCall(){
  if(callState.status!=='incoming')return;
  let localStream;try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});}catch(e){showToast('Нет доступа к камере.');declineCall();return;}
  const pc=new RTCPeerConnection(RTC_CONFIG);localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
  const remoteStream=new MediaStream();pc.ontrack=e=>{e.streams[0].getTracks().forEach(t=>remoteStream.addTrack(t));};
  pc.onconnectionstatechange=()=>{if(['failed','disconnected','closed'].includes(pc.connectionState)&&callState.status==='in-call'){showToast('Звонок прервался.');hangupCall();}};
  pc.onicecandidate=e=>{if(e.candidate)db.collection('calls').doc(callState.callId).collection('calleeCandidates').add(e.candidate.toJSON()).catch(()=>{});};
  try{await pc.setRemoteDescription(new RTCSessionDescription(callState.offer));const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await db.collection('calls').doc(callState.callId).update({answer:{type:answer.type,sdp:answer.sdp},status:'accepted'});}
  catch(e){showToast('Не получилось принять.');resetCallState();renderCallOverlay();return;}
  callState.pc=pc;callState.localStream=localStream;callState.remoteStream=remoteStream;callState.status='in-call';renderCallOverlay();
  const unsubCand=db.collection('calls').doc(callState.callId).collection('callerCandidates').onSnapshot(snap=>{snap.docChanges().forEach(ch=>{if(ch.type==='added')pc.addIceCandidate(new RTCIceCandidate(ch.doc.data())).catch(()=>{});});});callState.unsubs.push(unsubCand);
  const unsubDoc=db.collection('calls').doc(callState.callId).onSnapshot(doc=>{const data=doc.data();if(data&&data.status==='ended'&&callState.status!=='idle'){endCallRemote();}});callState.unsubs.push(unsubDoc);
}
async function declineCall(){if(callState.status!=='incoming')return;const cid=callState.callId;try{await db.collection('calls').doc(cid).update({status:'declined'});}catch(e){}cleanupPeer();resetCallState();renderCallOverlay();}
async function hangupCall(){const cid=callState.callId,st=callState.status;cleanupPeer();resetCallState();renderCallOverlay();if(cid&&(st==='calling'||st==='in-call')){try{await db.collection('calls').doc(cid).update({status:'ended'});await cleanupCallDoc(cid);}catch(e){}}}
function endCallRemote(){cleanupPeer();resetCallState();renderCallOverlay();}
function toggleMute(){if(!callState.localStream)return;const t=callState.localStream.getAudioTracks()[0];if(t){t.enabled=!t.enabled;const btn=document.getElementById('callMuteBtn');if(btn)btn.textContent=t.enabled?'🎤':'🔇';}}
function toggleCam(){if(!callState.localStream)return;const t=callState.localStream.getVideoTracks()[0];if(t){t.enabled=!t.enabled;const btn=document.getElementById('callCamBtn');if(btn)btn.textContent=t.enabled?'📷':'🚫';}}

// ─── auth state listener ────────────────────────────────
auth.onAuthStateChanged(async user=>{
  if(user){
    state.busy=true;state.errorMsg='';render();
    let profile=null;try{const doc=await db.collection('profiles').doc(user.uid).get();if(doc.exists)profile=doc.data();}catch(e){}
    state.busy=false;state.currentUid=user.uid;state.currentEmail=user.email;
    state.currentProfile=profile||{displayName:user.email,avatarEmoji:'☁️',status:''};
    selectedEmoji=state.currentProfile.avatarEmoji&&!state.currentProfile.avatarEmoji.startsWith('data:')?state.currentProfile.avatarEmoji:'☁️';
    customAvatarBase64=state.currentProfile.avatarEmoji&&state.currentProfile.avatarEmoji.startsWith('data:')?state.currentProfile.avatarEmoji:null;
    state.view='directory';render();
    subscribeDirectory();subscribeIncomingCalls();startOnlinePresence();subscribeDmList();subscribeGroupList();subscribeFriends();
  } else {
    unsubscribeDirectory();unsubscribeDmThread();unsubscribeConvMeta();unsubscribeDmList();unsubscribeGroupList();unsubscribeIncomingCalls();unsubscribeFriends();
    stopOnlinePresence();cleanupPeer();resetCallState();renderCallOverlay();
    state.view='auth';state.currentUid=null;state.currentEmail=null;state.currentProfile=null;state.activeConversation=null;customAvatarBase64=null;
    render();
  }
});

// ─── events ─────────────────────────────────────────────
document.addEventListener('click',e=>{
  // ── эмодзи (проверяем ДО data-action чтобы не блокировался) ──
  const emojiBtn=e.target.closest('.emoji-btn[data-emoji]');
  if(emojiBtn){
    selectedEmoji=emojiBtn.dataset.emoji;
    customAvatarBase64=null; // убираем фото, переключаемся на эмодзи
    avatarDirty=true;ensureAvatarHint();
    document.querySelectorAll('.emoji-btn').forEach(b=>b.classList.remove('selected'));
    emojiBtn.classList.add('selected');
    // обновляем превью аватара
    const preview=document.querySelector('.avatar-preview-emoji');
    if(preview) preview.textContent=selectedEmoji;
    // скрываем img-превью если было
    const imgPreview=document.querySelector('.avatar-preview-img');
    if(imgPreview){
      // заменяем img-блок на эмодзи-блок
      imgPreview.outerHTML=`<div class="avatar-preview-emoji">${selectedEmoji}</div>`;
    }
    // убираем кнопку "убрать фото" если была
    const removeBtn=document.querySelector('.remove-photo-btn');
    if(removeBtn) removeBtn.remove();
    // меняем лейбл
    const sectionLabel=document.querySelector('.emoji-section-label');
    if(sectionLabel) sectionLabel.textContent='Или выбери эмодзи:';
    return;
  }

  const btn=e.target.closest('[data-action]');if(!btn)return;
  const action=btn.dataset.action;

  if(action==='nav-directory'){unsubscribeDmThread();unsubscribeConvMeta();state.view='directory';state.errorMsg='';render();}
  else if(action==='nav-chats'){unsubscribeDmThread();unsubscribeConvMeta();state.activeConversation=null;state.view='chats';render();}
  else if(action==='nav-profile'){
    unsubscribeDmThread();unsubscribeConvMeta();
    profileDraft={displayName:state.currentProfile.displayName,status:state.currentProfile.status};
    selectedEmoji=state.currentProfile.avatarEmoji&&!state.currentProfile.avatarEmoji.startsWith('data:')?state.currentProfile.avatarEmoji:'☁️';
    customAvatarBase64=state.currentProfile.avatarEmoji&&state.currentProfile.avatarEmoji.startsWith('data:')?state.currentProfile.avatarEmoji:null;
    avatarDirty=false;
    state.view='profile';state.errorMsg='';state.saveMsg='';render();
  }
  else if(action==='logout'){handleLogout();}
  else if(action==='nav-settings'){unsubscribeDmThread();unsubscribeConvMeta();state.view='settings';state.errorMsg='';render();}
  else if(action==='toggle-theme'){state.theme=state.theme==='dark'?'light':'dark';applyTheme();render();}
  else if(action==='set-theme'){state.theme=btn.dataset.theme;applyTheme();render();}
  else if(action==='set-chat-font'){state.chatFontSize=btn.dataset.size;applyChatFontSize();render();}
  else if(action==='open-group-info'){openGroupInfo();}
  else if(action==='close-group-info'){state.view='chats';render();}
  else if(action==='pick-group-edit-emoji'){groupEditDraft.emoji=btn.dataset.emoji;render();}
  else if(action==='save-group-edit'){saveGroupEdit();}
  else if(action==='leave-group'){leaveGroup();}
  else if(action==='delete-group'){deleteGroup();}
  else if(action==='set-auth-mode'){state.authMode=btn.dataset.mode;state.errorMsg='';render();}
  else if(action==='remove-photo'){
    customAvatarBase64=null;avatarDirty=true;
    // если в профиле было фото — сбрасываем на дефолтный эмодзи
    if(state.currentProfile&&state.currentProfile.avatarEmoji&&state.currentProfile.avatarEmoji.startsWith('data:')){
      selectedEmoji='☁️';
    }
    render();
  }
  else if(action==='dm-back'){unsubscribeDmThread();unsubscribeConvMeta();state.activeConversation=null;state.searchOpen=false;state.searchQuery='';state.searchResults=[];render();}
  else if(action==='open-dm'){openConversation(btn.dataset.uid,btn.dataset.name,btn.dataset.peerEmoji);}
  else if(action==='open-group'){const g=state.groupList.find(x=>x.id===btn.dataset.gid);if(g)openGroup(g);}
  else if(action==='new-group'){openNewGroupView();}
  else if(action==='cancel-new-group'){state.view='chats';state.errorMsg='';render();}
  else if(action==='submit-new-group'){submitNewGroup();}
  else if(action==='pick-group-emoji'){selectedGroupEmoji=btn.dataset.emoji;document.querySelectorAll('.emoji-grid .emoji-btn').forEach(b=>{if(GROUP_EMOJIS.includes(b.dataset.emoji))b.classList.toggle('selected',b.dataset.emoji===selectedGroupEmoji);});}
  else if(action==='start-call'){if(state.activeConversation&&state.activeConversation.kind!=='group')startCall(state.activeConversation.peerUid,state.activeConversation.peerName,state.activeConversation.peerEmoji);}
  else if(action==='toggle-search'){state.searchOpen=!state.searchOpen;if(!state.searchOpen){state.searchQuery='';state.searchResults=[];updateMessagesList(messagesCache);}render();if(state.searchOpen){const si=document.getElementById('msgSearchInput');if(si)si.focus();}}
  else if(action==='close-search'){state.searchOpen=false;state.searchQuery='';state.searchResults=[];updateMessagesList(messagesCache);render();}
  else if(action==='search-prev'){if(state.searchResults.length){state.searchIdx=(state.searchIdx-1+state.searchResults.length)%state.searchResults.length;updateMessagesList(messagesCache);scrollToSearchResult();const sc=document.querySelector('.search-count');if(sc)sc.textContent=`${state.searchIdx+1}/${state.searchResults.length}`;}}
  else if(action==='search-next'){if(state.searchResults.length){state.searchIdx=(state.searchIdx+1)%state.searchResults.length;updateMessagesList(messagesCache);scrollToSearchResult();const sc=document.querySelector('.search-count');if(sc)sc.textContent=`${state.searchIdx+1}/${state.searchResults.length}`;}}
  else if(action==='call-accept'){acceptCall();}
  else if(action==='call-decline'){declineCall();}
  else if(action==='call-hangup'){hangupCall();}
  else if(action==='call-toggle-mute'){toggleMute();}
  else if(action==='call-toggle-cam'){toggleCam();}
  else if(action==='open-reaction-picker'){const row=btn.closest('.msg-row');if(!row)return;openReactionPicker(btn.dataset.msgId,btn);}
  else if(action==='pick-reaction'){toggleReaction(btn.dataset.msgId,btn.dataset.emoji);}
  else if(action==='toggle-reaction'){toggleReaction(btn.dataset.msgId,btn.dataset.emoji);}
  else if(action==='pin-message'){pinMessage(btn.dataset.msgId);}
  else if(action==='unpin-message'){unpinMessage(btn.dataset.msgId);}
  else if(action==='scroll-to-pinned'){scrollToPinned(btn.dataset.msgId);}
  else if(action==='reply-to-message'){replyToMessage(btn.dataset.msgId);}
  else if(action==='cancel-reply'){cancelReply();}
  else if(action==='start-edit-message'){startEditMessage(btn.dataset.msgId);}
  else if(action==='cancel-edit-message'){cancelEditMessage();}
  else if(action==='save-edit-message'){saveEditMessage(btn.dataset.msgId);}
  else if(action==='delete-message'){deleteMessage(btn.dataset.msgId);}
  else if(action==='add-friend'){addFriend(btn.dataset.uid,btn.dataset.name,btn.dataset.peerEmoji);}
  else if(action==='remove-friend'){removeFriend(btn.dataset.uid);}
  else if(action==='apply-crop'){applyCrop();}
  else if(action==='cancel-crop'){cancelCrop();}
  else if(action==='open-attach'){const fi=document.getElementById('chatFileInput');if(fi)fi.click();}
});

// ── загрузка фото профиля / файлов в чат ──
document.addEventListener('change',async e=>{
  if(e.target.id==='avatarFileInput'){
    const file=e.target.files&&e.target.files[0];if(!file)return;
    openAvatarCropper(file);
    e.target.value='';
  }
  if(e.target.id==='chatFileInput'){
    const file=e.target.files&&e.target.files[0];if(!file)return;
    handleFileSelected(file);
    e.target.value='';
  }
  if(e.target.dataset&&e.target.dataset.action==='toggle-group-member'){
    const uid=e.target.dataset.uid;
    if(e.target.checked)groupDraft.selectedUids.add(uid);else groupDraft.selectedUids.delete(uid);
  }
  if(e.target.dataset&&e.target.dataset.action==='set-privacy'){
    setPrivacy(e.target.value);
  }
  if(e.target.dataset&&e.target.dataset.action==='set-online-visibility'){
    setOnlineVisibility(e.target.value);
  }
});

document.addEventListener('input',e=>{
  if(e.target.closest('[data-form="auth"]')&&e.target.name)authDraft[e.target.name]=e.target.value;
  if(e.target.id==='statusInput'){profileDraft.status=e.target.value;const c=document.getElementById('statusCount');if(c)c.textContent=e.target.value.length+'/140';}
  if(e.target.closest('[data-form="profile"]')&&e.target.name==='displayName')profileDraft.displayName=e.target.value;
  if(e.target.id==='groupNameInput')groupDraft.name=e.target.value;
  if(e.target.id==='searchInput'){state.search=e.target.value;const cp=e.target.selectionStart;render();const ni=document.getElementById('searchInput');if(ni){ni.focus();ni.setSelectionRange(cp,cp);}}
  if(e.target.id==='msgSearchInput'){state.searchQuery=e.target.value;runSearch();const sc=document.querySelector('.search-count');if(sc)sc.textContent=state.searchResults.length?`${state.searchIdx+1}/${state.searchResults.length}`:'';;}
  if(e.target.id==='chatTextInput')notifyTyping();
});

document.addEventListener('keydown',e=>{
  if(e.target.classList&&e.target.classList.contains('msg-edit-input')&&e.key==='Enter'){
    e.preventDefault();saveEditMessage(e.target.dataset.msgId);
  }
  if(e.target.classList&&e.target.classList.contains('msg-edit-input')&&e.key==='Escape'){
    cancelEditMessage();
  }
});

document.addEventListener('submit',e=>{
  e.preventDefault();const form=e.target;
  if(form.dataset.form==='auth'){const d=new FormData(form);const email=d.get('email'),password=d.get('password');if(state.authMode==='login')handleLogin(email,password);else handleRegister(email,password,d.get('confirm'),d.get('displayName'));}
  else if(form.dataset.form==='profile'){const d=new FormData(form);handleSaveProfile(d.get('displayName'),d.get('status'));}
  else if(form.dataset.form==='chat-message'){const input=document.getElementById('chatTextInput');const text=input?input.value:'';if(!text.trim())return;sendMessage(text);if(input)input.value='';clearTypingNow();}
});

render();
