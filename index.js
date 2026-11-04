function syncBrandWordmarks(){
  const halloween=document.body.dataset.theme==="halloween";
  document.querySelectorAll(".brand-wordmarks").forEach((wrap)=>{
    const active=wrap.querySelector(halloween?".brand-wordmark-halloween":".brand-wordmark");
    const fallback=wrap.querySelector(".brand-text-fallback");
    const loaded=!!(active&&active.complete&&active.naturalWidth>0);
    wrap.querySelectorAll("img.brand-wordmark,img.brand-wordmark-halloween").forEach((img)=>{img.hidden=img!==active||!loaded});
    if(fallback)fallback.hidden=loaded;
  });
}
document.addEventListener("load",(event)=>{if(event.target.matches?.("img.brand-wordmark,img.brand-wordmark-halloween"))syncBrandWordmarks()},true);
document.addEventListener("error",(event)=>{if(event.target.matches?.("img.brand-wordmark,img.brand-wordmark-halloween"))syncBrandWordmarks()},true);
new MutationObserver(syncBrandWordmarks).observe(document.body,{attributes:true,attributeFilter:["data-theme"]});
syncBrandWordmarks();
const API_BASE = 'https://cursa-guk5.onrender.com';
const SUPABASE_URL = 'https://rpsvuygarxlnqpxtwuzq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hIAivAUZ0fCx9KlHsj4YVg_kc2TkPzB';
let supabaseAuth = null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const tokenKey = 'flowtix_access_token';
const PROFILE_ROUTE = /^\/profile\/?$/.test(window.location.pathname);
const PUBLIC_PROFILE_MATCH = window.location.pathname.match(/^\/profile\/([^/]+)\/?$/);
const PUBLIC_PROFILE_ROUTE = Boolean(PUBLIC_PROFILE_MATCH);
const PUBLIC_PROFILE_HANDLE = PUBLIC_PROFILE_MATCH ? decodeURIComponent(PUBLIC_PROFILE_MATCH[1]) : '';
const DASHBOARD_ROUTE = /^\/dashboard\/?$/.test(window.location.pathname);
const NOTIFICATIONS_ROUTE = /^\/notifications\/?$/.test(window.location.pathname);
const MESSAGES_ROUTE = /^\/messages\/?$/.test(window.location.pathname);
const ADMIN_ROUTE = /^\/admin\/?$/.test(window.location.pathname);
const ACCOUNT_ROUTE = PROFILE_ROUTE || PUBLIC_PROFILE_ROUTE || DASHBOARD_ROUTE || NOTIFICATIONS_ROUTE || MESSAGES_ROUTE || ADMIN_ROUTE;
if (ACCOUNT_ROUTE) {
  document.body.classList.add('account-page');
  $('.hero').hidden = true;
  $('#events').hidden = true;
  $('.footer').hidden = true;
  $('#workspace').hidden = false;
}
let user = null;
let headerWalletBalance = null;
let headerWalletRequest = null;
let ticketScannerStream = null;
let ticketScannerFrame = 0;
let ticketScannerBusy = false;
let notificationsChannel = null;
let notificationsChannelUserId = null;
let notificationsConnection = 'CONNECTING';
let notificationUnreadCount=0,notificationCountUserId=null,notificationCountLoading=false;
let notificationFeedOffset=0,notificationFeedHasMore=false,notificationFeedLoading=false,notificationFeedGeneration=0;
let events = [];
let organizerEvents = [];
let categories = [];
let activeCategory = '';
let selectedCalendarDate = localDateKey(new Date());
let calendarMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let currentFilteredEvents = [];
let selectedMapEventId = null;
let searchTimer;
let seatPickerEventId=null;
let seatPickerState=null;
let selectedSeatId=null;
let seatPickerCountdownTimer=null;
let seatPickerPollTimer=null;
const currentAccessToken = async () => {
  if (supabaseAuth) {
    try {
      const { data, error } = await supabaseAuth.auth.getSession();
      if (!error && data.session?.access_token) {
        sessionStorage.setItem(tokenKey, data.session.access_token);
        return data.session.access_token;
      }
    } catch (error) {
      console.warn('Could not refresh the cached Supabase session:', error);
    }
  }
  return sessionStorage.getItem(tokenKey);
};
const api = async (path, options = {}) => {
  let token = await currentAccessToken();
  const request = (accessToken) => fetch(API_BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}), ...(options.headers || {}) }
  });
  let response = await request(token);
  if (response.status === 401 && supabaseAuth) {
    try {
      const { data, error } = await supabaseAuth.auth.refreshSession();
      if (!error && data.session?.access_token) {
        token = data.session.access_token;
        sessionStorage.setItem(tokenKey, token);
        supabaseAuth.realtime.setAuth(token);
        response = await request(token);
      }
    } catch (error) {
      console.warn('Supabase session refresh failed:', error);
    }
  }
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data.code === 'ACCOUNT_BLOCKED') {
      if (user) { user.is_blocked = true; renderAccountMenu(); }
      document.querySelectorAll('.money-overlay').forEach(node=>node.remove());document.body.classList.remove('money-dialog-open');
      showBlockedAccountModal();
    }
    const error = new Error(data.error || 'Запрос не выполнен (' + response.status + ')');
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
};
const esc = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function autosizeTextarea(field){
  if(!field||field.tagName!=='TEXTAREA')return;
  if(!field.hasAttribute('maxlength')){
    field.maxLength=field.name==='description'?10000:field.name==='rules'?5000:2000;
  }
  field.style.height='auto';
  const max=360;
  field.style.height=Math.min(field.scrollHeight,max)+'px';
  field.style.overflowY=field.scrollHeight>max?'auto':'hidden';
}
function configureTextareas(root=document){root.querySelectorAll('textarea').forEach(autosizeTextarea)}
document.addEventListener('input',event=>{
  if(event.target.matches('textarea'))autosizeTextarea(event.target);
  if(event.target.id==='reviewComment'){const counter=$('#reviewCharCount');if(counter)counter.textContent=event.target.value.length+' / 1000'}
});
const textareaObserver=new MutationObserver(records=>{
  for(const record of records)for(const node of record.addedNodes){
    if(node.nodeType!==1)continue;
    if(node.matches('textarea'))autosizeTextarea(node);
    configureTextareas(node);
  }
});
textareaObserver.observe(document.body,{childList:true,subtree:true});
configureTextareas();
const money = (amount) => Number(amount || 0) === 0 ? 'Бесплатно' : new Intl.NumberFormat('ru-RU').format(Number(amount)) + ' ₸';
const eventStatusLabel = (status) => ({
  draft:'Черновик', pending_moderation:'На модерации', published:'Опубликовано',
  rejected:'Отклонено', cancelled:'Отменено', completed:'Завершено'
}[status] || status || 'Статус не указан');
const ticketStatusLabel = (status) => ({
  valid:'Действителен', used:'Использован', expired:'Недействителен', refunded:'Возврат оформлен', cancelled:'Аннулирован'
}[status] || 'Статус уточняется');
async function loadQrCodeLibrary(){
  if(window.QRCode)return window.QRCode;
  if(!window.flowtixQrCodePromise)window.flowtixQrCodePromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/qrcode.min.js';script.async=true;script.onload=()=>resolve(window.QRCode);script.onerror=()=>reject(new Error('Не удалось загрузить генератор QR-кода'));document.head.append(script)});
  return window.flowtixQrCodePromise;
}
async function loadQrScannerFallback(){
  if(window.jsQR)return window.jsQR;
  if(!window.flowtixJsQrPromise)window.flowtixJsQrPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/jsQR.js';script.async=true;script.onload=()=>window.jsQR?resolve(window.jsQR):reject(new Error('QR-декодер не загрузился'));script.onerror=()=>reject(new Error('Не удалось загрузить QR-декодер'));document.head.append(script)});
  return window.flowtixJsQrPromise;
}
async function renderTicketQrCodes(){
  const nodes=$$('[data-ticket-qr]');if(!nodes.length)return;
  try{const QR=await loadQrCodeLibrary();nodes.forEach(node=>{node.replaceChildren();new QR(node,{text:node.dataset.ticketQr,width:96,height:96,colorDark:'#17121d',colorLight:'#ffffff',correctLevel:QR.CorrectLevel.M})})}
  catch(error){nodes.forEach(node=>{node.textContent='QR недоступен';node.classList.add('ticket-qr-error')});console.error(error)}
}
function refreshHeaderWalletLabel(){const label=$('#headerWalletAmount');if(label)label.textContent=headerWalletBalance===null?'Баланс':walletMoney(headerWalletBalance)}
async function refreshHeaderWalletBalance(){
  if(!signedIn()||user?.is_blocked||headerWalletRequest)return headerWalletRequest;
  headerWalletRequest=api('/api/wallet').then(data=>{headerWalletBalance=Number(data.balance||0);refreshHeaderWalletLabel()}).catch(error=>console.warn('Header wallet balance unavailable:',error.message)).finally(()=>{headerWalletRequest=null});
  return headerWalletRequest;
}
function accountMenuIcon(kind){
 const paths={messages:'<path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.5-3.7A7.2 7.2 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z"/><path d="M8 11h8M8 14h5"/>',profile:'<circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',workspace:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',notifications:'<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',wallet:'<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 9h18M16 14h2"/><path d="M6 6V4.5A1.5 1.5 0 0 1 7.5 3H19"/>',admin:'<path d="M12 3 20 6v5.5c0 4.6-3 7.7-8 9.5-5-1.8-8-4.9-8-9.5V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',logout:'<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>'};
 return '<svg class="account-menu-icon icon-'+kind+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[kind]+'</svg>';
}
function decorateAccountMenu(){
 const icons={profile:'profile',workspace:'workspace',notifications:'notifications',messages:'messages',admin:'admin',logout:'logout'};
 $$( '#profileDropdown [role="menuitem"]' ).forEach(button=>{const action=button.dataset.accountAction;const kind=action==='wallet'?'wallet':icons[action];if(kind&&!button.querySelector('.account-menu-icon'))button.insertAdjacentHTML('afterbegin',accountMenuIcon(kind))});
 updateNotificationBadge();
}
async function eventCoverDataUrl(file) {
  if (!file || !/^image\/(?:jpeg|png|webp)$/.test(file.type)) throw new Error('Выберите изображение JPG, PNG или WebP');
  if (typeof createImageBitmap !== 'function') {
    if (file.size > 1400000) throw new Error('Этот браузер не может сжать изображение. Выберите файл меньше 1,4 МБ.');
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать изображение'));reader.readAsDataURL(file)});
  }
  const bitmap=await createImageBitmap(file);
  const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let blob=null;
  for(const quality of [.86,.78,.68,.58,.5]) {
    blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));
    if(blob&&blob.size<=2*1024*1024)break;
  }
  if(!blob||blob.size>2*1024*1024)throw new Error('Изображение слишком большое даже после сжатия');
  return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось подготовить изображение'));reader.readAsDataURL(blob)});
}
async function uploadEventCover(file) {
  const dataUrl=await eventCoverDataUrl(file);
  const result=await api('/api/uploads/event-cover',{method:'POST',body:JSON.stringify({dataUrl})});
  return result.url;
}
let toastTimer;
function toast(message) {
 const el=$('#toast');if(!el)return;
 const text=String(message??'');
 const kind=/не удалось|ошиб|недоступ|не получилось|нельзя|превышает/i.test(text)?'error':/сохран|обновл|добавлен|удален|одобрен|отправлен|выполнен|оформлен|изменен/i.test(text)?'success':'info';
 const icons={
  success:'<path d="m5 12 4 4L19 6"/>',
  error:'<path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="9"/>',
  info:'<path d="M12 11v5m0-8h.01"/><circle cx="12" cy="12" r="9"/>'
 };
 const icon=document.createElement('span');icon.className='toast-icon';icon.setAttribute('aria-hidden','true');
 icon.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+icons[kind]+'</svg>';
 const copy=document.createElement('span');copy.className='toast-message';copy.textContent=text;
 const close=document.createElement('button');close.type='button';close.className='toast-close';close.setAttribute('aria-label','Закрыть уведомление');close.textContent='×';
 close.addEventListener('click',()=>el.classList.remove('show'),{once:true});
 el.replaceChildren(icon,copy,close);el.dataset.kind=kind;el.setAttribute('role',kind==='error'?'alert':'status');el.setAttribute('aria-live',kind==='error'?'assertive':'polite');
 el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),4000);
}
function empty(message = 'Когда появятся данные, они отобразятся в этом разделе.') { return '<div class="empty-state"><span class="empty-star">✳</span><h3>Пока здесь тихо</h3><p>'+esc(message)+'</p></div>'; }
function setBusy(button, busy, text) { if (!button) return; button.disabled = busy; if (busy) { button.dataset.label = button.textContent; button.textContent = text || 'Сохраняем…'; } else if (button.dataset.label) button.textContent = button.dataset.label; }
function signedIn() { return Boolean(user && sessionStorage.getItem(tokenKey)); }
function ensureBlockedAccountModal(){
  if($('#blockedAccountOverlay'))return;
  document.body.insertAdjacentHTML('beforeend','<div class="overlay blocked-account-overlay" id="blockedAccountOverlay" hidden><section class="dialog blocked-account-dialog" role="dialog" aria-modal="true" aria-labelledby="blockedAccountTitle" aria-describedby="blockedAccountText"><button class="dialog-close" type="button" data-blocked-dismiss aria-label="Закрыть">×</button><div class="blocked-account-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 20 6v5.7c0 5-3.4 8.1-8 9.8-4.6-1.7-8-4.8-8-9.8V6l8-3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 8v5m0 3h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></div><p class="eyebrow">FLOWTIX · ДОСТУП</p><h2 id="blockedAccountTitle">Аккаунт заблокирован</h2><p id="blockedAccountText" class="blocked-account-copy">Для этого аккаунта временно закрыты действия и личные разделы. Главная страница и просмотр мероприятий остаются доступны.</p><div class="blocked-account-note"><strong>Можно продолжить просмотр</strong><span>Поиск, категории и подробности мероприятий работают в режиме просмотра.</span></div><div class="blocked-account-actions"><button class="button button-light" type="button" data-blocked-dismiss>Продолжить просмотр</button><button class="button button-dark" type="button" data-blocked-logout>Выйти и войти в другой аккаунт</button></div></section></div>');
}
function showBlockedAccountModal(){
  ensureBlockedAccountModal();
  const modal=$('#blockedAccountOverlay');
  modal.hidden=false;
  document.body.classList.add('blocked-modal-open');
  modal.querySelector('[data-blocked-dismiss]')?.focus({preventScroll:true});
}
function hideBlockedAccountModal(){
  const modal=$('#blockedAccountOverlay');
  if(modal)modal.hidden=true;
  document.body.classList.remove('blocked-modal-open');
}
function isAllowedBlockedRead(target){
  return Boolean(target.closest('#searchForm,#searchInput,#cityInput,#categoryBar,[data-category],[data-details],[data-period],[data-calendar-date],[data-calendar-shift],[data-map-event],[data-close="eventModal"],#eventModal,a[href="#"],a[href="#events"],a[href^="https://"],a[href^="http://"],a[href^="mailto:"],a[href^="tel:"]'));
}
document.addEventListener('click',(event)=>{
  if(!signedIn()||user?.is_blocked!==true)return;
  const target=event.target instanceof Element?event.target:null;
  if(!target||target.closest('#blockedAccountOverlay')||isAllowedBlockedRead(target))return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showBlockedAccountModal();
},true);
document.addEventListener('submit',(event)=>{
  if(!signedIn()||user?.is_blocked!==true||event.target?.id==='searchForm')return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showBlockedAccountModal();
},true);
function putAvatar(node,url,name){
  if(!node)return;
  node.replaceChildren();
  if(url){
    const image=document.createElement('img');
    image.src=url;image.alt='';image.loading='lazy';
    image.onerror=()=>{node.replaceChildren();node.textContent=(String(name||'F').trim()[0]||'F').toUpperCase()};
    node.append(image);
  }else node.textContent=(String(name||'F').trim()[0]||'F').toUpperCase();
}
function updateNotificationBadge(){
 const button=$('#profileDropdown [data-account-action="notifications"]');if(!button)return;
 let badge=button.querySelector('.notification-count-badge');
 if(!badge){badge=document.createElement('span');badge.className='notification-count-badge';badge.setAttribute('aria-hidden','true');button.append(badge)}
 const count=Math.max(0,Number(notificationUnreadCount)||0);
 badge.textContent=count>99?'99+':String(count);badge.hidden=count===0;
 button.setAttribute('aria-label',count?('Уведомления, непрочитанных: '+count):'Уведомления');
}
async function refreshNotificationUnreadCount(){
 if(!signedIn()||!user?.id||notificationCountLoading)return;
 const owner=user.id;notificationCountLoading=true;
 try{const data=await api('/api/notifications/unread-count');if(user?.id===owner){notificationCountUserId=owner;notificationUnreadCount=Number(data.count)||0;updateNotificationBadge()}}
 catch(error){console.warn('Unread notification count unavailable:',error.message)}
 finally{notificationCountLoading=false}
}
function renderAccountMenu(){
  const active=signedIn();
  const blocked=active&&user.is_blocked===true;
  $('#authOpen').hidden=active;
  $('#profileMenuWrap').hidden=!active;
  if(!$('#headerWalletBalance'))$('.account-actions')?.insertAdjacentHTML('afterbegin','<button id="headerWalletBalance" class="header-wallet-balance" type="button" data-open-wallet aria-label="Открыть баланс"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 9h18M16 14h2M6 6V4.5A1.5 1.5 0 0 1 7.5 3H19"/></svg><span id="headerWalletAmount">Баланс</span></button>');
  $('#headerWalletBalance').hidden=!active||blocked;
  refreshHeaderWalletLabel();
  $('#workspaceNav').hidden=!active||blocked;
  const adminLink=$('#profileAdminLink');
  if(adminLink)adminLink.hidden=!active||blocked||user.is_root_admin!==true;
  const trigger=$('#profileMenuToggle');
  if(trigger){trigger.title=blocked?'Аккаунт заблокирован — нажмите, чтобы узнать подробности':'';trigger.setAttribute('aria-label',blocked?'Аккаунт заблокирован':'Открыть меню аккаунта');trigger.classList.toggle('is-account-blocked',blocked)}
  if(!active)return;
  if(!$('#walletMenuButton'))$('#profileDropdown .profile-identity')?.insertAdjacentHTML('afterend','<button id="walletMenuButton" type="button" role="menuitem" data-account-action="wallet" data-open-wallet>Баланс</button>');
  if(!$('#messagesMenuButton'))$('#walletMenuButton')?.insertAdjacentHTML('afterend','<button id="messagesMenuButton" type="button" role="menuitem" data-account-action="messages">Личные сообщения</button>');
  decorateAccountMenu();
  if(notificationCountUserId!==user.id){notificationCountUserId=user.id;notificationUnreadCount=0;updateNotificationBadge();void refreshNotificationUnreadCount()}
  if(headerWalletBalance===null)void refreshHeaderWalletBalance();
  const displayName=blocked?'Доступ ограничен':(user.full_name||user.email||'Участник FlowTix');
  const handle=blocked?'аккаунт заблокирован':(user.username||String(user.email||'user').split('@')[0]);
  ['#profileName','#profileMenuName'].forEach((selector)=>{const node=$(selector);if(node)node.textContent=displayName});
  ['#profileUsername','#profileMenuUsername'].forEach((selector)=>{const node=$(selector);if(node)node.textContent='@'+handle});
  putAvatar($('#profileAvatar'),user.avatar_url,displayName);
  putAvatar($('#profileMenuAvatar'),user.avatar_url,displayName);
}
function authOpen(mode='login') { $('#authModal').hidden=false; setAuthMode(mode); }
function authClose() { $('#authModal').hidden=true; }
function setAuthMode(mode) {
  const register=mode==='register';
  $$('[data-auth]').forEach((tab)=>tab.classList.toggle('active',tab.dataset.auth===mode));
  $('#nameWrap').hidden=!register;
  $('#name').required=register;
  $('#password').autocomplete=register?'new-password':'current-password';
  $('#authSubmit').textContent=register?'Создать аккаунт':'Войти в FlowTix';
  $('#authTitle').textContent=register?'Создай свой FlowTix':'С возвращением';
  $('.auth-intro').textContent=register?'Создай аккаунт, чтобы находить события по душе.':'Войди, чтобы сохранять события и билеты в одном месте.';
  $('#authError').textContent='';
}
function eventCard(event) {
  const title=esc(event.title), id=esc(event.id), image=event.cover_image || event.cover;
  const fav=signedIn() && (user.favorites||[]).includes(event.id);
  const date=[event.start_date,event.start_time].filter(Boolean).join(' · ');
  const place=[event.venues?.city,event.venues?.name].filter(Boolean).join(' · ');
  const address=event.location_address||event.venues?.address||'';
  const price=event.current_price ?? event.base_price;
  return '<article class="event-card"><div class="event-image">'+(image?'<img src="'+esc(image)+'" alt="" loading="lazy">':'')+
    '<span class="event-category">'+esc(event.event_categories?.name || event.category || 'Мероприятие')+'</span><button class="fav-button '+(fav?'active':'')+'" data-favorite="'+id+'" aria-label="Избранное">'+(fav?'♥':'♡')+'</button></div>'+
    '<div class="event-info"><div class="event-date">'+esc(date || 'Дата уточняется')+'</div><h3>'+title+'</h3><div class="event-place">⌖ '+esc(place || address || 'Место уточняется')+'</div>'+(place&&address?'<div class="event-address">'+esc(address)+'</div>':'')+(event.users?.id?'<button type="button" class="event-organizer-chip" data-profile-open="'+esc(event.users.id)+'"><span class="profile-avatar">'+(event.users.avatar_url?'<img src="'+esc(event.users.avatar_url)+'" alt="">':esc((event.users.full_name||'О')[0]))+'</span><span><small>Организатор</small><b>'+esc(event.users.full_name||event.users.username||'Профиль')+'</b></span><span class="profile-chip-arrow">↗</span></button>':'')+
    '<div class="event-foot"><span class="event-price">'+esc(money(price))+'</span><div class="event-actions"><button class="button button-light" data-details="'+id+'">Подробнее</button><button class="button button-dark" data-register="'+id+'">Участвовать</button></div></div></div></article>';
}
function localDateKey(date) {
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
function dateFromKey(key) {
  const [year,month,day]=String(key||'').slice(0,10).split('-').map(Number);
  return year&&month&&day?new Date(year,month-1,day):new Date(NaN);
}
function shiftDate(date,days) { const next=new Date(date);next.setDate(next.getDate()+days);return next; }
function eventDateKey(event) { return String(event.start_date||'').slice(0,10); }
function eventLocationQuery(event) {
  return [event.location_address,event.venues?.address,event.venues?.name,event.venues?.city].filter(Boolean).join(', ');
}
function renderCalendar(source) {
  const grid=$('#calendarGrid');if(!grid)return;
  const year=calendarMonthDate.getFullYear(),month=calendarMonthDate.getMonth();
  $('#calendarMonth').textContent=new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(calendarMonthDate);
  const firstOffset=(new Date(year,month,1).getDay()+6)%7,daysInMonth=new Date(year,month+1,0).getDate();
  const countByDate=new Map();
  source.forEach(event=>{const key=eventDateKey(event);if(key)countByDate.set(key,(countByDate.get(key)||0)+1)});
  const cells=[];
  for(let index=0;index<42;index++){
    const day=index-firstOffset+1;
    if(day<1||day>daysInMonth){cells.push('<span class="calendar-day calendar-day-empty" aria-hidden="true"></span>');continue}
    const key=localDateKey(new Date(year,month,day)),count=countByDate.get(key)||0;
    cells.push('<button type="button" class="calendar-day '+(selectedCalendarDate===key?'selected ':'')+(count?'has-events':'')+'" data-calendar-date="'+key+'" aria-label="'+esc(new Intl.DateTimeFormat('ru-RU',{dateStyle:'full'}).format(dateFromKey(key))+(count?', событий: '+count:''))+'"><span>'+day+'</span>'+(count?'<small>'+count+'</small>':'')+'</button>');
  }
  grid.innerHTML=cells.join('');
  const selected=dateFromKey(selectedCalendarDate);
  $('#calendarEvents').innerHTML='<div class="calendar-events-heading"><b>'+esc(new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(selected))+'</b><span class="event-count">'+(source.filter(e=>eventDateKey(e)===selectedCalendarDate).length||0)+' событий</span></div>'+
    (source.some(e=>eventDateKey(e)===selectedCalendarDate)?'<div class="events-grid">'+source.filter(e=>eventDateKey(e)===selectedCalendarDate).map(eventCard).join('')+'</div>':empty('На эту дату опубликованных мероприятий нет.'));
}
function renderMap(source,preferredId=null) {
  const root=$('#mapContent');if(!root)return;
  const locations=source.filter(event=>eventLocationQuery(event));
  const selected=locations.find(event=>String(event.id)===String(preferredId||selectedMapEventId))||locations[0];
  selectedMapEventId=selected?.id||null;
  if(!selected){root.innerHTML=empty('Для отображения карты у мероприятий должен быть указан адрес.');return}
  const query=eventLocationQuery(selected),encoded=encodeURIComponent(query);
  const cards=locations.map(event=>'<button type="button" class="map-event '+(String(event.id)===String(selected.id)?'active':'')+'" data-map-event="'+esc(event.id)+'"><b>'+esc(event.title)+'</b><span>'+esc([event.venues?.city,event.location_address||event.venues?.address].filter(Boolean).join(' · '))+'</span></button>').join('');
  root.innerHTML='<div class="map-frame"><iframe title="Карта: '+esc(selected.title)+'" src="https://maps.google.com/maps?q='+encoded+'&output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe><a class="map-open-link" href="https://www.google.com/maps/search/?api=1&query='+encoded+'" target="_blank" rel="noopener noreferrer">Открыть в Картах ↗</a></div><div class="map-event-list">'+cards+'</div>';
}
function renderEvents() {
  if(ACCOUNT_ROUTE)return;
  const query=$('#searchInput').value.trim().toLocaleLowerCase('ru');
  const city=$('#cityInput').value.trim().toLocaleLowerCase('ru');
  const today=localDateKey(new Date());
  const allUpcoming=events.filter(e=>eventDateKey(e)>=today);
  const filtered=allUpcoming.filter((e)=>{
    const text=[e.title,e.description,e.location_address,e.venues?.address,e.event_categories?.name,e.venues?.city,e.venues?.name].join(' ').toLocaleLowerCase('ru');
    return (!query||text.includes(query))&&(!city||(e.venues?.city||'').toLocaleLowerCase('ru').includes(city))&&(!activeCategory||e.category_id===activeCategory);
  }).sort((a,b)=>(eventDateKey(a)+String(a.start_time||'')).localeCompare(eventDateKey(b)+String(b.start_time||'')));
  currentFilteredEvents=filtered;
  const tomorrow=localDateKey(shiftDate(new Date(),1));
  const endOfWeek=shiftDate(new Date(),(7-new Date().getDay())%7);
  const weekEnd=localDateKey(endOfWeek);
  $('#todayCount').textContent=filtered.filter(e=>eventDateKey(e)===today).length;
  $('#tomorrowCount').textContent=filtered.filter(e=>eventDateKey(e)===tomorrow).length;
  $('#weekCount').textContent=filtered.filter(e=>eventDateKey(e)>=today&&eventDateKey(e)<=weekEnd).length;
  $('#eventCount').textContent=filtered.length+' '+plural(filtered.length,['событие','события','событий']);
  $('#eventsGrid').innerHTML=filtered.length?filtered.map(eventCard).join(''):empty(events.length?'По этим фильтрам предстоящих событий нет.':'Опубликованных мероприятий пока нет.');

  const location=(city||user?.city||'').trim();
  const nearby=location?filtered.filter(e=>(e.venues?.city||'').toLocaleLowerCase('ru').includes(location.toLocaleLowerCase('ru'))):[];
  $('#nearbyCaption').textContent=location?'Город: '+location:'Выбери город в поиске';
  $('#nearbyEventsGrid').innerHTML=nearby.length?nearby.slice(0,3).map(eventCard).join(''):empty(location?'В этом городе ближайших мероприятий пока нет.':'Укажи город в поле поиска, чтобы увидеть события рядом.');
  $('#popularSection').hidden=!filtered.length;
  const popular=[...filtered].sort((a,b)=>Number(b.popularity_score||0)-Number(a.popularity_score||0)||(eventDateKey(a)).localeCompare(eventDateKey(b))).slice(0,3);
  $('#popularEventsGrid').innerHTML=popular.map(eventCard).join();
  $('#newSection').hidden=!filtered.length;
  const newest=[...filtered].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0)).slice(0,3);
  $('#newEventsGrid').innerHTML=newest.map(eventCard).join();
  const preferences=(user?.preferences?.categories||[]).map(value=>String(value).toLocaleLowerCase('ru'));
  const favoriteIds=new Set((user?.favorites||[]).map(String));
  const favoriteCategories=new Set(filtered.filter(e=>favoriteIds.has(String(e.id))).map(e=>String(e.category_id)));
  const personalized=filtered.filter(e=>preferences.includes(String(e.category_id).toLocaleLowerCase('ru'))||preferences.includes(String(e.event_categories?.name||'').toLocaleLowerCase('ru'))||favoriteCategories.has(String(e.category_id)));
  const recommendations=(personalized.length?personalized:popular).slice(0,3);
  $('#recommendedSection').hidden=!recommendations.length;
  $('#recommendationCaption').textContent=personalized.length?'Подобрано для вас':'Популярное сейчас';
  $('#recommendedEventsGrid').innerHTML=recommendations.map(eventCard).join();

  if(!selectedCalendarDate)selectedCalendarDate=today;
  renderCalendar(filtered);
  renderMap(filtered);
}
function plural(n,forms){const x=n%100,y=x%10;return forms[(x>10&&x<20)?2:y>1&&y<5?1:y===1?0:2]}
async function loadCategories() {
  try { const r=await api('/api/categories'); categories=r.categories||[]; $('#categoryBar').innerHTML='<button class="category active" data-category="">Все события</button>'+categories.map(c=>'<button class="category" data-category="'+esc(c.id)+'">'+esc(c.name)+'</button>').join(''); }
  catch { /* category filters are optional; the event list remains live */ }
}
async function loadEvents() {
  $('#connectionState').textContent='';
  try {
    const params=new URLSearchParams();
    if($('#searchInput').value.trim())params.set('q',$('#searchInput').value.trim());
    if($('#cityInput').value.trim())params.set('city',$('#cityInput').value.trim());
    const result=await api('/api/events'+(params.size?'?'+params:''));
    events=result.events||[];
    renderEvents();
  } catch(error) {
    events=[];
    renderEvents();
    $('#connectionState').textContent='Не удалось загрузить каталог: '+error.message;
  }
}
function setEventModalOpen(open) {
  const modal=$('#eventModal');
  if(!modal)return;
  modal.hidden=!open;
  document.body.classList.toggle('event-modal-open',open);
  if(open)modal.scrollTop=0;
  if(!open){
    clearInterval(seatPickerCountdownTimer);clearInterval(seatPickerPollTimer);
    seatPickerCountdownTimer=null;seatPickerPollTimer=null;
    seatPickerEventId=null;seatPickerState=null;selectedSeatId=null;
  }
}
function openEvent(id) {
  api('/api/events/'+encodeURIComponent(id)).then(({event:e})=>{
    const image=e.cover_image||'';
    const organizer=e.users?.id?e.users:(e.organizer_id?{id:e.organizer_id}:null);
    const team=(e.event_staff_assignments||[]).filter(a=>a.status==='assigned'&&a.employee?.users?.id).map(a=>a.employee.users);
    const teamMarkup=team.length?'<div class="event-team"><h3>Команда мероприятия</h3><div class="event-team-list">'+team.map(person=>'<button type="button" class="event-organizer-chip" data-profile-open="'+esc(person.id)+'"><span class="profile-avatar">'+(person.avatar_url?'<img src="'+esc(person.avatar_url)+'" alt="">':esc((person.full_name||'С')[0]))+'</span><span><small>Сотрудник мероприятия</small><b>'+esc(person.full_name||person.username||'Профиль')+'</b></span><span class="profile-chip-arrow">↗</span></button>').join('')+'</div></div>':'';
    $('#eventDialog').innerHTML='<div class="event-hero">'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<button class="dialog-close" data-close="eventModal" aria-label="Закрыть">×</button></div><div class="event-dialog-content"><p class="eyebrow dark-eyebrow">'+esc(e.event_categories?.name||'Мероприятие')+'</p><h2>'+esc(e.title)+'</h2><p><b>'+esc([e.start_date,e.start_time].filter(Boolean).join(' · '))+'</b> · '+esc([e.venues?.city,e.venues?.name,e.location_address||e.venues?.address].filter(Boolean).join(', '))+'</p>'+(organizer?'<button type="button" class="event-organizer-chip event-organizer-chip-detail" data-profile-open="'+esc(organizer.id)+'"><span class="profile-avatar">'+(organizer.avatar_url?'<img src="'+esc(organizer.avatar_url)+'" alt="">':esc((organizer.full_name||'О')[0]))+'</span><span><small>Организатор · открыть профиль</small><b>'+esc(organizer.full_name||organizer.username||'Профиль организатора')+'</b></span><span class="profile-chip-arrow">Смотреть ↗</span></button>':'')+(organizer?'<a class="button button-light button-small event-full-profile-link" href="/profile/'+encodeURIComponent(organizer.username||organizer.id)+'">Открыть полный профиль ↗</a>':'')+'<p>'+esc(e.description||'Описание не добавлено.')+'</p><p>'+esc(money(e.current_price??e.base_price))+' · Осталось мест: '+esc(e.available_seats??'—')+' · Возраст: '+esc(e.age_limit||'Для всех')+'</p>'+(e.contact_email||e.contact_phone?'<p>Контакты: '+esc([e.contact_email,e.contact_phone].filter(Boolean).join(' · '))+'</p>':'')+(e.rules?'<div class="workspace-card"><h3>Правила посещения</h3><p>'+esc(e.rules)+'</p></div>':'')+'<div class="workspace-card"><h3>Программа мероприятия</h3>'+renderEventProgram(e.event_program||[])+'</div>'+teamMarkup+'<div class="inline-actions"><button class="button button-dark" data-register="'+esc(e.id)+'">Участвовать</button><button class="button button-light" data-report="'+esc(e.id)+'">Пожаловаться</button></div><div id="reportForm"></div></div>';
    setEventModalOpen(true);
  }).catch(e=>toast(e.message));
}
function renderEventPreview(e) {
 const location=[e.venues?.city,e.venues?.name,e.location_address||e.venues?.address].filter(Boolean).join(', ');
 const image=e.cover_image||'';
 $('#eventDialog').innerHTML='<div class="event-hero">'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<button class="dialog-close" data-close="eventModal" aria-label="Закрыть">×</button></div><div class="event-dialog-content"><p class="eyebrow dark-eyebrow">ПРЕДПРОСМОТР · '+esc(eventStatusLabel(e.status||'draft'))+'</p><h2>'+esc(e.title||'Название мероприятия')+'</h2><p><b>'+esc([e.start_date,e.start_time].filter(Boolean).join(' · ')||'Дата и время не указаны')+'</b>'+(location?' · '+esc(location):'')+'</p><p>'+esc(e.description||'Описание не добавлено.')+'</p><p>'+esc(money(e.base_price))+' · Вместимость: '+esc(e.total_seats||'—')+' · '+esc(e.age_limit||'Для всех')+'</p>'+(e.contact_email||e.contact_phone?'<p>Контакты: '+esc([e.contact_email,e.contact_phone].filter(Boolean).join(' · '))+'</p>':'')+(e.rules?'<p><b>Правила:</b> '+esc(e.rules)+'</p>':'')+'<div class="workspace-card"><h3>Программа</h3>'+renderEventProgram(e.event_program||[])+'</div>'+'<p class="preview-note">Предпросмотр виден только организатору. Событие появится в каталоге после модерации.</p></div>';
 setEventModalOpen(true);
}
function openOrganizerPreview(id) {
 const event=organizerEvents.find(item=>String(item.id)===String(id));
 if(event)renderEventPreview(event);
}
function previewNewEvent(form) {
 if(!form.reportValidity())return;
 const data=Object.fromEntries(new FormData(form)), select=form.querySelector('[data-venue-select]'), option=select?.selectedOptions[0];
 const cover=form.querySelector('#createCoverPreview img')?.src||'';
 let program=[];try{program=collectProgramDraft(form.querySelector('#eventProgramList'))}catch(error){toast(error.message);return}renderEventPreview({...data,status:'draft',base_price:Number(data.base_price||0),total_seats:Number(data.total_seats||0),cover_image:cover,event_program:program,event_categories:categories.find(c=>String(c.id)===String(data.category_id)),venues:option?.value?{name:option.textContent.split(' · ')[0],address:option.dataset.address||''}:null});
}
async function completeRegistration(id,seatId=null) {
  try {
    const result=await api('/api/registrations',{method:'POST',body:JSON.stringify({eventId:id,...(seatId?{seatId}:{})})});
    if(result.balance!==undefined){headerWalletBalance=Number(result.balance||0);refreshHeaderWalletLabel()}
    const event=events.find(item=>String(item.id)===String(id));
    const visualFree=Number(event?.current_price??event?.base_price??0)>0&&Number(result.ticket?.price_paid||0)===0;
    const seatLabel=result.ticket?.seat_label&&result.ticket.seat_label!=='Без места'?' · место '+result.ticket.seat_label:'';
    setEventModalOpen(false);
    toast((visualFree?'Билет без оплаты · ':'Билет оформлен · ')+result.ticket.ticket_number+seatLabel);
    await loadEvents();
  }catch(error){toast(error.message)}
}
const seatTypeLabels={standard:'Обычное',vip:'VIP',business:'Бизнес',free:'Бесплатное',accessible:'Доступное'};
function seatButton(seat){
  const labels={available:'Свободно',mine:'Ваша бронь',reserved:'Забронировано',occupied:'Занято'};
  const selected=selectedSeatId===seat.id;
  const disabled=seat.status==='reserved'||seat.status==='occupied';
  return '<button type="button" class="seat-place seat-type-'+esc(seat.seat_type)+' '+(selected?'is-selected ':'')+'seat-state-'+esc(seat.status)+'" data-seat-id="'+esc(seat.id)+'" aria-label="'+esc(seat.row_label+seat.seat_number+' · '+(seatTypeLabels[seat.seat_type]||'Место')+' · '+(labels[seat.status]||''))+'" title="'+esc(seat.row_label+seat.seat_number+' · '+(seatTypeLabels[seat.seat_type]||'Место')+' · '+(labels[seat.status]||''))+'" '+(disabled?'disabled':'')+'><span>'+esc(seat.seat_number)+'</span></button>';
}
function renderSeatPicker(){
  const root=$('#eventDialog');if(!root||!seatPickerState)return;
  const event=events.find(item=>String(item.id)===String(seatPickerEventId))||{};
  const seats=seatPickerState.seats||[];
  const byRow=new Map();
  seats.forEach(seat=>{const row=String(seat.row_label||'');if(!byRow.has(row))byRow.set(row,[]);byRow.get(row).push(seat)});
  const rows=[...byRow.entries()].map(([label,items])=>'<div class="seat-row"><span class="seat-row-label">'+esc(label)+'</span><div class="seat-row-items">'+items.map(seatButton).join('')+'</div><span class="seat-row-label">'+esc(label)+'</span></div>').join('');
  const selected=seats.find(seat=>seat.id===selectedSeatId);
  const expiry=selected?.reserved_until||null;
  const basePrice=Number(event.current_price??event.base_price??0);
  const selectedMultiplier=selected?Number(selected.price_multiplier||1):null;
  const selectedPrice=selected?Math.round((basePrice*selectedMultiplier+Number.EPSILON)*100)/100:null;
  const statusText=selected?(expiry?'Бронь держится 10 минут после выбора.':'Место выбрано.'):'Выбери свободное место на схеме зала.';
  root.className='dialog event-dialog seat-map-dialog';
  root.innerHTML='<div class="seat-picker-head"><div><p class="eyebrow dark-eyebrow">ВЫБОР МЕСТА</p><h2>'+esc(event.title||'Мероприятие')+'</h2><p>'+esc([event.start_date,event.start_time,event.venues?.name,event.venues?.city].filter(Boolean).join(' · '))+'</p></div><button class="dialog-close" data-close="eventModal" aria-label="Закрыть">×</button></div><div class="seat-picker-content"><div class="seat-picker-summary"><div><span class="seat-summary-dot available"></span>Свободно</div><div><span class="seat-summary-dot reserved"></span>На удержании</div><div><span class="seat-summary-dot occupied"></span>Занято</div></div><div class="seat-map-scroll"><div class="seat-stage">СЦЕНА</div><div class="seat-type-legend">'+['standard','vip','business','free','accessible'].filter(type=>seats.some(seat=>seat.seat_type===type)).map(type=>'<span><i class="seat-type-swatch seat-type-'+type+'"></i>'+seatTypeLabels[type]+'</span>').join('')+'</div><div class="seat-rows">'+(rows||'<p class="seat-empty">Схема этого зала пока не настроена.</p>')+'</div></div><div class="seat-picker-footer"><div class="seat-selection-copy"><b>'+(selected?esc(selected.row_label+selected.seat_number)+' · '+esc(seatTypeLabels[selected.seat_type]||'Место'):'Место не выбрано')+'</b><strong class="seat-price-total">'+(selected?(selectedPrice>0?money(selectedPrice):'Бесплатно'):'Базовая цена: '+(basePrice>0?money(basePrice):'Бесплатно'))+(selected&&selectedMultiplier!==1?' · × '+esc(String(selectedMultiplier).replace('.',',')):'')+'</strong><span id="seatHoldStatus">'+esc(statusText)+'</span><span id="seatHoldCountdown" aria-live="polite"></span></div><button class="button button-accent" data-confirm-seat '+(selected?'':'disabled')+'>Зарегистрироваться</button></div></div>';
  clearInterval(seatPickerCountdownTimer);
  if(expiry)seatPickerCountdownTimer=setInterval(()=>{
    const seconds=Math.max(0,Math.ceil((new Date(expiry).getTime()-Date.now())/1000));
    const countdown=$('#seatHoldCountdown');
    if(countdown)countdown.textContent=seconds?('Осталось: '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')):'Бронь истекла — выберите место заново.';
    if(!seconds){clearInterval(seatPickerCountdownTimer);selectedSeatId=null;void refreshSeatPicker();}
  },1000);
}
async function refreshSeatPicker(){
  if(!seatPickerEventId)return;
  try{
    const state=await api('/api/events/'+encodeURIComponent(seatPickerEventId)+'/seats');
    if(!state.seatSelectionRequired){seatPickerState=null;return}
    seatPickerState=state;
    const ownHold=(state.seats||[]).find(seat=>seat.id===selectedSeatId&&seat.status==='mine');
    if(selectedSeatId&&!ownHold)selectedSeatId=null;
    renderSeatPicker();
  }catch(error){toast(error.message)}
}
async function reserveSelectedSeat(seatId){
  if(!seatPickerEventId)return;
  try{
    const {reservation}=await api('/api/seat-reservations',{method:'POST',body:JSON.stringify({eventId:seatPickerEventId,seatId})});
    selectedSeatId=seatId;
    const selected=(seatPickerState?.seats||[]).find(seat=>seat.id===seatId);
    if(selected){selected.status='mine';selected.reserved_until=reservation.reserved_until}
    renderSeatPicker();
  }catch(error){toast(error.message);await refreshSeatPicker()}
}
async function register(id) {
  if(!signedIn())return authOpen();
  seatPickerEventId=String(id);selectedSeatId=null;
  try{
    const state=await api('/api/events/'+encodeURIComponent(id)+'/seats');
    if(!state.seatSelectionRequired)return completeRegistration(id);
    seatPickerState=state;
    $('#eventDialog').scrollTop=0;
    renderSeatPicker();setEventModalOpen(true);
    clearInterval(seatPickerPollTimer);
    seatPickerPollTimer=setInterval(()=>void refreshSeatPicker(),15000);
  }catch(error){toast(error.message)}
}async function toggleFavorite(id) {
  if(!signedIn())return authOpen();
  const has=(user.favorites||[]).includes(id);
  try {
    await api('/api/favorites/'+encodeURIComponent(id),{method:has?'DELETE':'POST'});
    user.favorites=has?user.favorites.filter(x=>x!==id):[...(user.favorites||[]),id];
    renderEvents();toast(has?'Убрали из избранного':'Добавили в избранное');
  } catch(error){toast(error.message)}
}
async function loadSession(authUser=null) {
  const token=await currentAccessToken();
  if(!token){user=null;renderAccountMenu();return false}
  let account=null;
  let profileError=null;
  try{
    const result=await api('/api/me');
    account=result.user;
  }catch(error){
    profileError=error;
    if(!authUser&&supabaseAuth){
      try{const {data,error:sessionError}=await supabaseAuth.auth.getSession();if(!sessionError&&data.session?.user)authUser=data.session.user}catch{}
    }
    if(!authUser){
      console.error('Account profile could not be loaded:',error);
      if(error.status===401){
        sessionStorage.removeItem(tokenKey);
        if(supabaseAuth)try{await supabaseAuth.auth.signOut({scope:'local'})}catch{}
        user=null;renderAccountMenu();return false;
      }
      renderAccountMenu();
      toast('Сессия сохранена, но сервер временно недоступен. Попробуй обновить страницу позже.');
      return Boolean(sessionStorage.getItem(tokenKey));
    }
    const email=authUser.email||'';
    const base=email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,15)||'user';
    account={
      id:authUser.id,email,full_name:authUser.user_metadata?.full_name||authUser.user_metadata?.name||'',
      username:authUser.user_metadata?.username||base+'_'+String(authUser.id||'').slice(0,8),
      avatar_url:authUser.user_metadata?.avatar_url||authUser.user_metadata?.picture||null,
      phone:null,city:'',role:'visitor',preferences:{}
    };
  }
  user={...account,favorites:[]};
  applyTheme(user.preferences?.theme||localStorage.getItem(themeKey)||'rose',{save:!user.preferences?.theme&&!profileError});
  renderAccountMenu();
  if(user.is_blocked){
    $('#profileDropdown').hidden=true;
    renderEvents();
    return true;
  }
  void subscribeToNotifications();
  try{
    const fav=await api('/api/favorites');
    user.favorites=(fav.favorites||[]).map((item)=>item.event_id);
  }catch(error){console.warn('Favorites are temporarily unavailable:',error.message)}
  renderEvents();
  return true;
}
async function logoutAccount(){
  clearChatRealtime();
  sessionStorage.removeItem(tokenKey);
  try{
    if(notificationsChannel&&supabaseAuth)await supabaseAuth.removeChannel(notificationsChannel);
    notificationsChannel=null;notificationsChannelUserId=null;
    if(supabaseAuth)await supabaseAuth.auth.signOut();
  }catch(error){console.warn('Sign-out cleanup failed:',error)}
  user=null;headerWalletBalance=null;notificationUnreadCount=0;notificationCountUserId=null;updateNotificationBadge();refreshHeaderWalletLabel();
  renderAccountMenu();
  $('#workspace').hidden=true;
  $('#profileDropdown').hidden=true;
  $('#profileMenuToggle').setAttribute('aria-expanded','false');
  renderEvents();
  toast('Вы вышли из аккаунта');
}
function showWorkspace() {
  if(!signedIn())return authOpen();
  if(user?.is_root_admin===true)return window.location.assign('/admin/');
  $('#workspace').hidden=false;
  $('#workspaceRefresh').textContent='Обновить данные ↻';
  $('#workspace').scrollIntoView({behavior:'smooth'});
  $('#workspaceTitle').textContent=({visitor:'Ваш FlowTix',organizer:'Кабинет организатора',staff:'Кабинет сотрудника',moderator:'Модерация',admin:'Управление FlowTix'})[user.role]||'Кабинет';
  const view={visitor:visitorView,organizer:organizerView,staff:staffView,moderator:moderatorView,admin:adminView}[user.role];
  $('#workspaceContent').innerHTML=view?'<div class="workspace-card"><p>Загружаем данные аккаунта…</p></div>':empty('Для аккаунта не назначена роль.');
  if(view)view();
}
function themePickerMarkup(){
  const current=document.body.dataset.theme||'rose';
  return '<div class="theme-picker"><button class="theme-select" type="button" data-theme-select-button aria-haspopup="listbox" aria-expanded="false"><span class="theme-picker-icon" aria-hidden="true">✦</span><span data-theme-label>'+esc(themeNames[current]||themeNames.rose)+'</span><span class="theme-chevron" aria-hidden="true"></span></button><div class="theme-menu" data-theme-menu role="listbox" aria-label="Тема оформления" hidden>'+
    [['rose','Нежно-розовая','rose-swatch'],['sky','Нежно-голубая','sky-swatch'],['dark','Ночная','dark-swatch'],['halloween','Хэллоуинская','halloween-swatch']].map(([value,label,swatch])=>'<button type="button" role="option" data-theme-option="'+value+'" aria-selected="'+(current===value)+'"><span class="theme-swatch '+swatch+'"></span><span>'+label+'</span><span class="theme-check">✓</span></button>').join('')+
    '</div></div>';
}
function showSettings(){
  if(!signedIn())return authOpen();
  $('#workspace').hidden=false;
  $('#workspaceTitle').textContent='Профиль и настройки';
  $('#workspaceRefresh').textContent=PROFILE_ROUTE?'← На главную':'← В кабинет';
  $('#workspaceContent').innerHTML='<div class="settings-layout"><div class="workspace-card settings-intro"><p class="eyebrow dark-eyebrow">ТВОЙ FLOWTIX</p><h3>Твой профиль</h3><p>Настрой, как ты будешь отображаться в FlowTix. Изменения профиля сохраняются в аккаунте.</p></div><div class="workspace-card"><form id="profileSettingsForm" class="form-grid settings-form"><div class="wide avatar-editor"><span id="profileAvatarPreview" class="profile-avatar profile-avatar-large"></span><div class="avatar-copy"><b>Фото профиля</b><p>JPG, PNG или WebP · до 2 МБ</p><label class="button button-light avatar-upload-button">Загрузить фото<input id="avatarInput" type="file" accept="image/jpeg,image/png,image/webp" hidden></label></div></div><label>Отображаемое имя<input name="full_name" value="'+esc(user.full_name||'')+'" required maxlength="120" autocomplete="name"></label><label>Юзернейм<input name="username" value="'+esc(user.username||'')+'" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username"><small>Латинские буквы, цифры и _</small></label><label>Email аккаунта<input value="'+esc(user.email||'')+'" disabled></label><label>Город<input name="city" value="'+esc(user.city||'')+'" maxlength="100" placeholder="Например, Алматы"></label><label>Телефон<input name="phone" type="tel" value="'+esc(user.phone||'')+'" maxlength="40" autocomplete="tel" placeholder="+7 ..."></label><label class="wide">О себе<textarea name="about" rows="4" maxlength="1000" placeholder="Расскажи, какие события тебе интересны">'+esc(user.preferences?.about||'')+'</textarea></label><div class="wide settings-theme"><div><b>Оформление</b><p>Выбранная тема сохраняется в аккаунте и на этом устройстве.</p></div>'+themePickerMarkup()+'</div><div class="wide form-actions"><button class="button button-accent" type="submit">Сохранить профиль</button></div></form></div><div class="workspace-card profile-links-card" id="profileLinksCard"><p>Загружаем ссылки…</p></div></div>';
  putAvatar($('#profileAvatarPreview'),user.avatar_url,user.full_name);
  void loadMyProfileLinks();
  $('#workspace').scrollIntoView({behavior:'smooth'});
}
let chatRealtimeChannels=[],chatListChannel=null,chatThreadChannel=null;
let activeChatId=null, activeChatOtherId=null, activeChatOtherUsername='', activeChatMessages=[], activeChatHasMore=false, activeChatLoading=false;
function clearChatRealtime(){if(supabaseAuth)chatRealtimeChannels.forEach(channel=>supabaseAuth.removeChannel(channel));chatRealtimeChannels=[];chatListChannel=null;chatThreadChannel=null}
function profileLinkIcon(platform){
 const paths={telegram:'<path d="m21 3-4 18-6-6-3 3 1-6 8-7-10 5-4-1 18-6Z"/>',youtube:'<rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10 9 5 3-5 3V9Z"/>',instagram:'<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/><path d="M17.5 6.5h.01"/>',tiktok:'<path d="M14 4v10a4 4 0 1 1-4-4"/><path d="M14 4c1 3 2.5 4.5 5 5"/>',vk:'<path d="M4 7h4c.4 3 1.5 4.5 2.5 4.5V7h3.5v4.5C16 11.4 17.3 10 18 7h3c-.5 2.5-2 4.7-3.5 6 1.8 1.3 3 2.7 4 5h-4c-.9-1.6-1.9-2.6-3.5-3v3H13C8 18 5 14 4 7Z"/>',discord:'<path d="M7 6c3-1.5 7-1.5 10 0l2 10c-2 1.5-3 2-5 2l-.8-1.3M5 16 7 6M8 14h.01M16 14h.01M8 17c2 1 6 1 8 0"/>',x:'<path d="m4 4 16 16M20 4 4 20M7 4h3l7 16h-3L7 4Z"/>'};
 return '<svg class="profile-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(paths[platform]||'<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/>')+'</svg>';
}
async function loadMyProfileLinks(){
 const box=$('#profileLinksCard');if(!box)return;
 try{
  const [{links=[]},{users:blockedUsers=[]}]=await Promise.all([api('/api/me/profile-links'),api('/api/me/blocks')]);
  box.innerHTML='<div class="profile-links-head"><div><p class="eyebrow dark-eyebrow">СОЦИАЛЬНЫЕ ССЫЛКИ</p><h3>Ссылки в профиле</h3><p>Сначала ссылка проверяется главным администратором. До одобрения её видите только вы.</p></div></div><form id="profileLinkForm" class="profile-link-add"><label>Ссылка на соцсеть или сайт<input name="url" type="url" maxlength="2048" required placeholder="https://t.me/…"></label><button class="button button-accent" type="submit">Отправить на проверку</button></form><div class="profile-link-list">'+(links.length?links.map(link=>'<div class="profile-link-row"><span class="profile-link-platform">'+profileLinkIcon(link.platform)+'</span><a href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+esc(link.url)+'</a><span class="link-status status-'+esc(link.status)+'">'+({pending:'На модерации',approved:'Подтверждена',rejected:'Отклонена'}[link.status]||'На модерации')+'</span><button type="button" class="button button-light button-small" data-remove-own-link="'+esc(link.id)+'">Удалить</button></div>').join(''):empty('Ссылок пока нет. Добавь первую — она появится после проверки.'))+'</div><div class="my-blocked-users"><h4>Заблокированные пользователи</h4>'+(blockedUsers.length?blockedUsers.map(person=>'<div class="profile-link-row"><span class="profile-avatar">'+(person.avatar_url?'<img src="'+esc(person.avatar_url)+'" alt="">':esc((person.full_name||'F')[0]))+'</span><span class="blocked-person-name">'+esc(person.full_name||person.username||'Пользователь')+' · @'+esc(person.username||'—')+'</span><button type="button" class="button button-light button-small" data-own-unblock="'+esc(person.id)+'">Разблокировать</button></div>').join(''):'<p>Заблокированных пользователей нет.</p>')+'</div>';
 }catch(error){box.innerHTML='<h3>Ссылки в профиле</h3><p class="connection-state">'+esc(error.message)+'</p>'}
}
async function openPublicProfile(id){
 try{
  const {profile:p}=await api('/api/profiles/'+encodeURIComponent(id));
  let blocks=[];if(signedIn())try{blocks=(await api('/api/me/blocks')).blocks||[]}catch{}
  const isBlocked=blocks.includes(id);
  document.querySelector('#publicProfileModal')?.remove();
  const wrap=document.createElement('div');wrap.id='publicProfileModal';wrap.className='overlay profile-modal-overlay';wrap.innerHTML='<section class="dialog profile-modal" role="dialog" aria-modal="true"><button class="dialog-close" type="button" data-profile-close>×</button><div class="profile-modal-hero"><span id="publicProfileAvatar" class="profile-avatar profile-avatar-large"></span><p class="eyebrow dark-eyebrow">'+esc(({visitor:'УЧАСТНИК',organizer:'ОРГАНИЗАТОР',staff:'СОТРУДНИК',moderator:'МОДЕРАТОР',admin:'АДМИНИСТРАТОР'})[p.role]||'ПРОФИЛЬ FLOWTIX')+'</p><h2>'+esc(p.full_name||'Участник FlowTix')+'</h2><span class="profile-modal-username">@'+esc(p.username||'user')+'</span></div>'+(p.city?'<p class="profile-modal-city">'+esc(p.city)+'</p>':'')+(p.about?'<p class="profile-modal-about">'+esc(p.about)+'</p>':'')+'<div class="profile-modal-links">'+(p.links||[]).map(link=>'<a class="profile-social-link" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+profileLinkIcon(link.platform)+'<span>'+esc(link.platform==='website'?'Сайт':link.platform)+'</span><b>↗</b></a>').join('')+'</div><div class="profile-modal-actions"><a class="button button-light" href="/profile/'+encodeURIComponent(p.username||p.id)+'">Полный профиль ↗</a>'+(signedIn()&&user.id!==p.id?'<button class="button button-accent" data-request-chat="'+esc(p.id)+'">Запросить личный чат</button><button class="button button-light" data-toggle-user-block="'+esc(p.id)+'" data-blocked="'+isBlocked+'">'+(isBlocked?'Разблокировать':'Заблокировать')+'</button>':'')+'</div></section>';
  document.body.append(wrap);putAvatar($('#publicProfileAvatar',wrap),p.avatar_url,p.full_name);
 }catch(error){toast(error.message)}
}
async function publicProfilePage(){
 $('#workspace').hidden=false;$('#workspaceTitle').textContent='Профиль пользователя';$('#workspaceRefresh').textContent='← На главную';
 $('#workspaceContent').innerHTML='<div class="workspace-card"><p>Загружаем профиль…</p></div>';
 try{
  const {profile:p}=await api('/api/profiles/'+encodeURIComponent(PUBLIC_PROFILE_HANDLE));
  let blocks=[];if(signedIn())try{blocks=(await api('/api/me/blocks')).blocks||[]}catch{}
  const isBlocked=blocks.includes(p.id),role=({visitor:'Посетитель',organizer:'Организатор',staff:'Сотрудник мероприятия',moderator:'Модератор',admin:'Администратор'})[p.role]||'Участник FlowTix';
  const links=(p.links||[]).map(link=>'<a class="profile-social-link" href="'+esc(link.url)+'" target="_blank" rel="noopener noreferrer">'+profileLinkIcon(link.platform)+'<span>'+esc(link.platform==='website'?'Сайт':link.platform)+'</span><b>↗</b></a>').join('');
  const hosted=(p.events||[]).map(event=>'<article class="public-profile-event"><div><small>'+esc([event.start_date,event.start_time].filter(Boolean).join(' · '))+'</small><h4>'+esc(event.title)+'</h4><p>'+esc([event.venues?.city,event.venues?.name,event.location_address||event.venues?.address].filter(Boolean).join(' · ')||'Адрес не указан')+'</p></div><button class="button button-light button-small" type="button" data-details="'+esc(event.id)+'">Подробнее</button></article>').join('');
  $('#workspaceContent').innerHTML='<section class="workspace-card public-profile-page"><header class="public-profile-header"><span id="fullPublicProfileAvatar" class="profile-avatar profile-avatar-large"></span><div class="public-profile-identity"><p class="eyebrow dark-eyebrow">'+esc(role.toLocaleUpperCase('ru-RU'))+'</p><h2>'+esc(p.full_name||'Участник FlowTix')+'</h2><span class="profile-modal-username">@'+esc(p.username||'user')+'</span></div>'+(p.city?'<span class="public-profile-city">'+esc(p.city)+'</span>':'')+'</header>'+(p.about?'<section class="public-profile-about"><h3>О себе</h3><p>'+esc(p.about)+'</p></section>':'')+(links?'<section class="public-profile-social"><h3>Ссылки</h3><div class="profile-modal-links">'+links+'</div></section>':'')+'<section class="public-profile-events"><h3>Мероприятия организатора</h3>'+(hosted?'<div class="public-profile-event-list">'+hosted+'</div>':'<p>Опубликованных мероприятий пока нет.</p>')+'</section><div class="profile-modal-actions">'+(signedIn()&&user.id!==p.id?'<button class="button button-accent" data-request-chat="'+esc(p.id)+'">Запросить личный чат</button><button class="button button-light" data-toggle-user-block="'+esc(p.id)+'" data-blocked="'+isBlocked+'">'+(isBlocked?'Разблокировать':'Заблокировать')+'</button>':'')+'<a class="button button-light" href="/">На главную</a></div></section>';
  putAvatar($('#fullPublicProfileAvatar'),p.avatar_url,p.full_name);
 }catch(error){$('#workspaceContent').innerHTML='<div class="workspace-card"><h2>Профиль не найден</h2><p class="connection-state">'+esc(error.message)+'</p><a class="button button-light" href="/">На главную</a></div>'}
}
async function openAdminUserProfile(id){
 try{
  const {profile:p}=await api('/api/admin/users/'+encodeURIComponent(id)+'/profile');
  document.querySelector('#adminUserProfileModal')?.remove();
  const linkRows=(p.links||[]).map(link=>'<div class="profile-link-row"><span>'+profileLinkIcon(link.platform)+'</span><input class="admin-link-edit-input" data-admin-link-url="'+esc(link.id)+'" value="'+esc(link.url)+'" aria-label="Ссылка профиля"><span class="link-status status-'+esc(link.status)+'">'+({pending:'На модерации',approved:'Подтверждена',rejected:'Отклонена'}[link.status]||link.status)+'</span><button class="button button-light button-small" data-admin-link-save="'+esc(link.id)+'">Сохранить</button><button class="button button-danger button-small" data-admin-link-delete="'+esc(link.id)+'">Удалить</button></div>').join('')||'<p>Ссылок нет</p>';
  const wrap=document.createElement('div');wrap.id='adminUserProfileModal';wrap.className='overlay profile-modal-overlay admin-user-modal-overlay';
  wrap.innerHTML='<section class="dialog admin-user-modal" role="dialog" aria-modal="true"><button class="dialog-close" type="button" data-admin-profile-close>×</button><p class="eyebrow dark-eyebrow">УПРАВЛЕНИЕ АККАУНТОМ</p><h2>Профиль пользователя</h2><div class="admin-profile-heading"><span id="adminProfileAvatar" class="profile-avatar profile-avatar-large"></span><div><b>'+esc(p.full_name||'Без имени')+'</b><small>'+esc(p.email)+'</small><span>'+esc(p.is_blocked?'Заблокирован':'Активен')+' · '+esc(p.is_root_admin?'Главный администратор':({visitor:'Посетитель',organizer:'Организатор',staff:'Сотрудник мероприятия',moderator:'Модератор',admin:'Администратор'}[p.role]||'Пользователь'))+'</span></div></div><form id="adminUserProfileForm" data-user-id="'+esc(id)+'" class="form-grid"><label>Отображаемое имя<input name="full_name" maxlength="120" value="'+esc(p.full_name||'')+'"></label><label>Юзернейм<input name="username" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" value="'+esc(p.username||'')+'"></label><label>Телефон<input name="phone" maxlength="40" value="'+esc(p.phone||'')+'"></label><label>Город<input name="city" maxlength="100" value="'+esc(p.city||'')+'"></label><label class="wide">О себе<textarea name="about" maxlength="1000" rows="3">'+esc(p.about||'')+'</textarea></label><label class="wide">Аватар (PNG/JPG/WebP, до 2 МБ)<input id="adminAvatarFile" type="file" accept="image/png,image/jpeg,image/webp"></label><button class="button button-accent" type="submit">Сохранить профиль</button></form><form id="adminBalanceForm" data-user-id="'+esc(id)+'" class="admin-balance-form"><h3>Баланс · '+esc(walletMoney(p.balance))+'</h3><label>Изменение в ₸ (+ начислить / − списать)<input name="amount" type="number" step="0.01" required></label><label>Комментарий<input name="note" maxlength="240" placeholder="Причина корректировки"></label><button class="button button-light" type="submit">Изменить баланс</button></form><div class="admin-profile-links"><h3>Социальные ссылки</h3>'+linkRows+'<form id="adminProfileLinkForm" data-user-id="'+esc(id)+'" class="profile-link-add"><label>Добавить ссылку<input type="url" name="url" maxlength="2048" required placeholder="https://…"></label><button class="button button-accent button-small" type="submit">Добавить и одобрить</button></form></div><div class="profile-modal-actions"><button class="button '+(p.is_blocked?'button-light':'button-danger')+'" data-admin-profile-block="'+esc(id)+'" data-blocked="'+p.is_blocked+'" '+(p.is_root_admin?'disabled':'')+'>'+(p.is_blocked?'Разблокировать аккаунт':'Заблокировать аккаунт')+'</button></div></section>';
  document.body.append(wrap);putAvatar($('#adminProfileAvatar',wrap),p.avatar_url,p.full_name);
 }catch(error){toast(error.message)}
}
function messageBubble(message){
 return '<article class="chat-message '+(message.sender_id===user?.id?'is-mine':'')+'" data-chat-message="'+esc(message.id)+'"><p>'+esc(message.body)+'</p><time>'+esc(new Date(message.created_at).toLocaleString('ru',{hour:'2-digit',minute:'2-digit'}))+'</time></article>';
}
function renderChatList(conversations){
 const list=$('#chatConversationList');if(!list)return;
 const entries=conversations.filter(x=>x.status==='active'||x.status==='pending');
 list.innerHTML=entries.length?entries.map(c=>{
   const incoming=c.status==='pending'&&c.request_by!==user.id,avatar=c.other?.avatar_url?'<img src="'+esc(c.other.avatar_url)+'" alt="">':esc((c.other?.full_name||'F')[0]);
   const unreadCount=Math.max(0,Number(c.unreadCount)||0);
   return '<article class="chat-list-item '+(c.id===activeChatId?'active':'')+'"><button type="button" data-chat-open="'+esc(c.id)+'" data-chat-other="'+esc(c.other?.id||'')+'" data-chat-username="'+esc(c.other?.username||'')+'" class="chat-list-main"><span class="profile-avatar">'+avatar+'</span><span><b>'+esc(c.other?.full_name||c.other?.username||'Пользователь')+'</b><small>'+(incoming?'Запрос на переписку':c.status==='pending'?'Ожидает подтверждения':esc(c.lastMessage?.body||'Откройте переписку'))+'</small></span>'+(unreadCount?'<span class="chat-unread-badge" aria-label="'+unreadCount+' непрочитанных сообщений">'+(unreadCount>99?'99+':unreadCount)+'</span>':'')+'</button>'+(incoming?'<div class="chat-request-actions"><button class="button button-accent button-small" data-chat-request-action="accept" data-chat-id="'+esc(c.id)+'">Принять</button><button class="button button-light button-small" data-chat-request-action="decline" data-chat-id="'+esc(c.id)+'">Отклонить</button></div>':'')+'</article>';
 }).join(''):empty('Здесь появятся личные переписки и запросы на чат.');
}
async function refreshConversations(){
 try{const {conversations=[]}=await api('/api/messages/conversations');renderChatList(conversations);return conversations}
 catch(error){const list=$('#chatConversationList');if(list)list.innerHTML='<p class="connection-state">'+esc(error.message)+'</p>';return []}
}
async function openChatConversation(id){
 activeChatId=id;activeChatMessages=[];activeChatHasMore=false;if(chatThreadChannel&&supabaseAuth)supabaseAuth.removeChannel(chatThreadChannel);chatThreadChannel=null;
 const messages=$('#chatMessages'),composer=$('#chatComposer');
 if(messages)messages.innerHTML='<div class="chat-loading">Загружаем сообщения…</div>';
 const data=await api('/api/messages/conversations/'+encodeURIComponent(id)+'/messages');
 activeChatMessages=data.messages||[];activeChatHasMore=Boolean(data.hasMore);
 if(messages){messages.innerHTML=activeChatMessages.map(messageBubble).join('')||'<div class="chat-empty">Пока нет сообщений. Начните переписку.</div>';messages.scrollTop=messages.scrollHeight;
  document.querySelector('.messages-workspace')?.classList.add('has-active-chat');
   messages.onscroll=()=>{if(messages.scrollTop<40&&activeChatHasMore&&!activeChatLoading)void loadOlderChatMessages(messages)};
 }
 if(composer)composer.hidden=false;
 const clear=$('[data-clear-chat]');if(clear)clear.dataset.clearCount=String(data.clearCount||0);
 const badge=$('#chatClearCount');if(badge)badge.textContent=(data.clearCount||0)+'/2 очистили';
 const chatItem=document.querySelector('[data-chat-open="'+CSS.escape(id)+'"]');
 activeChatOtherId=chatItem?.dataset.chatOther||null;
 activeChatOtherUsername=chatItem?.dataset.chatUsername||'';
 const profileLink=$('#chatProfileLink');if(profileLink){profileLink.hidden=!activeChatOtherId;profileLink.href='/profile/'+encodeURIComponent(activeChatOtherUsername||activeChatOtherId||'')}
 const header=$('#chatActiveHeader');if(header){header.hidden=false;header.querySelector('h3').textContent=document.querySelector('[data-chat-open="'+CSS.escape(id)+'"] b')?.textContent||'Переписка'}
 const channel=supabaseAuth?.channel('flowtix-conversation-'+id)
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'direct_messages',filter:'conversation_id=eq.'+id},payload=>{
     const msg=payload.new;if(!msg||activeChatMessages.some(x=>x.id===msg.id))return;
     activeChatMessages.push(msg);$('#chatMessages')?.insertAdjacentHTML('beforeend',messageBubble(msg));const box=$('#chatMessages');if(box)box.scrollTop=box.scrollHeight;
      if(msg.sender_id!==user?.id&&document.visibilityState==='visible'){void api('/api/messages/conversations/'+encodeURIComponent(id)+'/read',{method:'PATCH'}).then(()=>refreshConversations()).catch(error=>console.warn('Could not mark chat read:',error.message))}
   })
   .subscribe();
 if(channel)chatRealtimeChannels.push(channel);
 if(supabaseAuth){
   const token=sessionStorage.getItem(tokenKey);if(token)await supabaseAuth.realtime.setAuth(token);
 }
 await refreshConversations();
}
async function loadOlderChatMessages(box){
 if(!activeChatMessages.length||activeChatLoading)return;
 activeChatLoading=true;const oldHeight=box.scrollHeight,oldTop=box.scrollTop;
 try{
  const before=activeChatMessages[0].created_at;
  const {messages=[],hasMore}=await api('/api/messages/conversations/'+encodeURIComponent(activeChatId)+'/messages?before='+encodeURIComponent(before));
  if(messages.length){activeChatMessages=[...messages,...activeChatMessages];box.insertAdjacentHTML('afterbegin',messages.map(messageBubble).join(''));box.scrollTop=box.scrollHeight-oldHeight+oldTop}
  activeChatHasMore=Boolean(hasMore);
 }catch(error){toast(error.message)}finally{activeChatLoading=false}
}
function messagesView(){
 if(!signedIn())return authOpen();
 $('#workspace').hidden=false;$('#workspaceTitle').textContent='Личные сообщения';$('#workspaceRefresh').textContent='Обновить';$('#workspace').scrollIntoView({behavior:'smooth'});
 $('#workspaceContent').innerHTML='<section class="messages-workspace"><aside class="chat-sidebar"><div class="chat-sidebar-heading"><div><p class="eyebrow dark-eyebrow">FLOWTIX DIRECT</p><h3>Сообщения</h3></div><span class="chat-live-dot">Realtime</span></div><div id="chatConversationList" class="chat-conversation-list"><div class="chat-loading">Загружаем запросы и переписки…</div></div></aside><section class="chat-panel"><header id="chatActiveHeader" class="chat-active-header" hidden><div class="chat-active-title"><button class="button button-light button-small chat-back-button" data-chat-back type="button">← Список</button><h3>Открой переписку</h3><small id="chatClearCount">0/2 очистили</small></div><div class="chat-actions"><a id="chatProfileLink" class="button button-light button-small" href="#" hidden>Профиль ↗</a><button class="button button-light button-small" type="button" data-clear-chat>Очистить у меня</button><button class="button button-danger button-small" type="button" data-block-chat>Заблокировать</button></div></header><div id="chatMessages" class="chat-messages"><div class="chat-empty">Выбери переписку слева.</div></div><form id="chatComposer" class="chat-composer" hidden><div><textarea name="body" maxlength="512" rows="1" required placeholder="Написать сообщение…"></textarea><small><span id="chatCharCount">0</span>/512</small></div><button class="button button-accent" type="submit">Отправить</button></form></section></section>';
 void refreshConversations().then(conversations=>{
   const targetId=new URLSearchParams(window.location.search).get('conversation');
   if(!targetId)return;
   const target=conversations.find(item=>item.id===targetId);
   if(target?.status==='active'&&!activeChatId)void openChatConversation(targetId).catch(error=>toast(error.message));
   else if(target){const row=document.querySelector('[data-chat-open="'+CSS.escape(targetId)+'"]')?.closest('.chat-list-item');row?.scrollIntoView({behavior:'smooth',block:'center'});row?.classList.add('is-notification-target')}
  });
 if(supabaseAuth){
  clearChatRealtime();const token=sessionStorage.getItem(tokenKey);if(token)supabaseAuth.realtime.setAuth(token);
  chatListChannel=supabaseAuth.channel('flowtix-conversation-list-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'direct_conversations'},()=>void refreshConversations()).subscribe();
  chatRealtimeChannels.push(chatListChannel);
 }
}

async function uploadProfileAvatar(input){
  const file=input.files?.[0];if(!file)return;
  const allowed=['image/jpeg','image/png','image/webp'];
  if(!allowed.includes(file.type)||file.size>2097152){toast('Выбери JPG, PNG или WebP до 2 МБ');input.value='';return}
  const saveButton=$('#profileSettingsForm [type="submit"]');setBusy(saveButton,true,'Загружаем фото…');
  try{
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Не удалось прочитать изображение'));reader.readAsDataURL(file)});
    const imageData=dataUrl.split(',')[1];
    const result=await api('/api/me/avatar',{method:'POST',body:JSON.stringify({contentType:file.type,imageData})});
    user.avatar_url=result.avatar_url;
    renderAccountMenu();
    putAvatar($('#profileAvatarPreview'),user.avatar_url,user.full_name);
    toast('Фото профиля обновлено');
  }catch(error){toast(error.message||'Не удалось загрузить фото')}
  finally{setBusy(saveButton,false);input.value=''}
}
async function visitorView() {
  try {
    const [ticketData,favoriteData,reviewData]=await Promise.all([api('/api/tickets/mine'),api('/api/favorites'),api('/api/reviews/mine')]);
    const tickets=ticketData.tickets||[], favorites=favoriteData.favorites||[], reviews=reviewData.reviews||[];
    const reviewedEvents=new Set(reviews.map(review=>String(review.event_id)));
    const eligible=[...new Map(tickets.filter(ticket=>['valid','used'].includes(ticket.status)).map(ticket=>[String(ticket.event_id),ticket])).values()];
    const pendingReviews=eligible.filter(ticket=>!reviewedEvents.has(String(ticket.event_id)));
    const ticketCards=tickets.length?'<div class="flow-ticket-list">'+tickets.map(ticket=>{
      const event=ticket.events||{}, place=[event.venues?.name,event.venues?.city].filter(Boolean).join(' · '), status=ticket.is_expired?'expired':(ticket.status||'valid');
      const qr=esc(JSON.stringify({v:1,eventId:ticket.event_id,ticketNumber:ticket.ticket_number}));
      return '<article class="flow-ticket"><div class="flow-ticket-main"><div class="flow-ticket-kicker">FLOWTIX · БИЛЕТ</div><span class="flow-ticket-status status-'+esc(status)+'">'+esc(ticketStatusLabel(status))+'</span><h4>'+esc(event.title||'Мероприятие')+'</h4><div class="flow-ticket-meta">'+esc([event.start_date,event.start_time].filter(Boolean).join(' · ')||'Дата уточняется')+(place?' · '+esc(place):'')+(event.location_address?' · '+esc(event.location_address):'')+'</div><div class="flow-ticket-category">'+esc(event.event_categories?.name||'Мероприятие')+' · '+esc(user?.full_name||user?.username||'Участник')+'</div><div class="flow-ticket-number"><small>НОМЕР БИЛЕТА</small><strong>'+esc(ticket.ticket_number||'—')+'</strong></div></div><div class="flow-ticket-stub"><span class="flow-ticket-seat-label">ВАШЕ МЕСТО</span><strong>'+esc(ticket.seat_label&&ticket.seat_label!=='Без места'?ticket.seat_label:'Без места')+'</strong><div class="flow-ticket-qr" data-ticket-qr="'+qr+'" aria-label="QR-код билета"></div><small class="flow-ticket-qr-hint">Покажите QR на входе</small><span class="flow-ticket-perforation" aria-hidden="true"></span></div></article>';
    }).join('')+'</div>':empty('Зарегистрируйся на мероприятие — билет появится здесь.');
    const reviewForm=pendingReviews.length
      ?'<form id="reviewForm" class="review-form"><label>Мероприятие<select name="eventId" required>'+pendingReviews.map(ticket=>'<option value="'+esc(ticket.event_id)+'">'+esc(ticket.events?.title||'Мероприятие')+'</option>').join('')+'</select></label><fieldset class="review-rating-field"><legend>Твоя оценка</legend><div class="review-star-options" role="radiogroup" aria-label="Оценка от 1 до 5 звёзд">'+[1,2,3,4,5].map(value=>'<label class="review-star-option" data-review-star="'+value+'"><input type="radio" name="rating" value="'+value+'" required><span aria-hidden="true">★</span><small class="visually-hidden">'+value+' из 5</small></label>').join('')+'</div></fieldset><label>Комментарий<textarea id="reviewComment" name="comment" rows="3" maxlength="1000" minlength="1" required placeholder="Поделись впечатлениями — до 1000 символов"></textarea></label><div class="review-form-footer"><span id="reviewCharCount">0 / 1000</span><button class="button button-dark">Опубликовать отзыв</button></div></form>'
      :empty(eligible.length?'Ты уже оставил отзыв на каждое посещённое мероприятие.':'Для отзыва сначала нужен билет на мероприятие.');
    const reviewHistory=reviews.length?'<div class="review-history">'+reviews.map(review=>{
      const score=Math.max(0,Math.min(5,Math.round(Number(review.overall_rating)||0)));
      return '<article class="review-history-card"><div><strong>'+esc(review.events?.title||'Мероприятие')+'</strong><span class="review-history-stars" aria-label="'+score+' из 5">'+('★'.repeat(score))+('☆'.repeat(5-score))+'</span></div><p>'+esc(review.comment||'')+'</p><small>'+esc(review.created_at?new Date(review.created_at).toLocaleDateString('ru-RU'):'')+'</small></article>';
    }).join('')+'</div>':empty('Опубликованные отзывы появятся здесь.');
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Мои билеты</h3>'+ticketCards+'</div><div class="workspace-card"><h3>Избранное ('+favorites.length+')</h3>'+(favorites.length?favorites.map(item=>'<p>'+esc(item.events?.title||'Мероприятие')+'</p>').join(''):empty('Отмечай сердцем мероприятия, чтобы не потерять.'))+'</div><div class="workspace-card"><h3>Оставить отзыв</h3>'+reviewForm+'</div><div class="workspace-card"><h3>Мои отзывы</h3>'+reviewHistory+'</div>';
    void renderTicketQrCodes();
  }catch(error){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(error.message)+'</p>'}
}
function notificationCardMarkup(notice){
 const date=notice.created_at?new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(notice.created_at)):'';
 const actionUrl=typeof notice.action_url==='string'&&notice.action_url.startsWith('/')&&!notice.action_url.startsWith('//')?notice.action_url:null;
 return '<article class="workspace-card notification-card '+(notice.is_read?'':'unread')+'"><div class="notification-card-head"><h3>'+esc(notice.title||'Уведомление FlowTix')+'</h3><span class="status-pill">'+(notice.is_read?'Прочитано':'Новое')+'</span></div><p>'+esc(notice.message||'')+'</p>'+(actionUrl?'<a class="notification-source-link" href="'+esc(actionUrl)+'">Открыть источник <span aria-hidden="true">→</span></a>':'')+(date?'<small>'+esc(date)+'</small>':'')+'</article>';
}
async function loadNotificationPage(){
 if(notificationFeedLoading||!notificationFeedHasMore||!signedIn())return;
 const generation=notificationFeedGeneration,owner=user?.id,offset=notificationFeedOffset;
 notificationFeedLoading=true;
 const sentinel=$('#notificationLoadMore');
 if(sentinel){sentinel.hidden=false;sentinel.textContent='Загружаем ещё уведомления…'}
 try{
   const data=await api('/api/notifications?offset='+offset+'&limit=5');
   if(generation!==notificationFeedGeneration||owner!==user?.id)return;
   const loaded=data.notifications||[];
   const readResults=await Promise.allSettled(loaded.map(notice=>notice.is_read?Promise.resolve():api('/api/notifications/'+encodeURIComponent(notice.id)+'/read',{method:'PATCH'})));
   if(generation!==notificationFeedGeneration||owner!==user?.id)return;
   const notices=loaded.map((notice,i)=>({...notice,is_read:notice.is_read||readResults[i]?.status==='fulfilled'}));
   const list=$('#notificationList');if(!list)return;
   if(offset===0&&!notices.length)list.innerHTML=empty('Уведомлений пока нет. Новые сообщения и события появятся здесь.');
   else if(notices.length)list.insertAdjacentHTML('beforeend',notices.map(notificationCardMarkup).join(''));
   notificationFeedOffset=offset+loaded.length;
   notificationFeedHasMore=Boolean(data.hasMore);
   if(sentinel){sentinel.hidden=!notificationFeedHasMore;sentinel.textContent=notificationFeedHasMore?'Прокрути вниз, чтобы загрузить следующие 5':'Все уведомления загружены'}
   if(loaded.some((notice,i)=>!notice.is_read&&readResults[i]?.status==='fulfilled'))void refreshNotificationUnreadCount();
 }catch(error){
   if(sentinel){sentinel.hidden=false;sentinel.innerHTML='<button class="button button-light button-small" type="button" data-notification-retry>Повторить загрузку</button>'}
   const list=$('#notificationList');if(list&&offset===0)list.innerHTML='<p class="connection-state">'+esc(error.message)+'</p>';
 }finally{notificationFeedLoading=false}
}
async function notificationsView(){
 if(!signedIn())return authOpen();
 $('#workspace').hidden=false;
 $('#workspaceTitle').textContent='Уведомления';
 $('#workspaceRefresh').textContent='Обновить уведомления ↻';
 $('#workspaceContent').innerHTML='<div class="workspace-card"><div class="notification-live"><span class="notification-live-dot '+(notificationsConnection==='SUBSCRIBED'?'is-live':'')+'"></span><span id="notificationsLiveStatus">'+(notificationsConnection==='SUBSCRIBED'?'Подключено · новые уведомления приходят сразу':'Подключаемся к уведомлениям…')+'</span></div><p>Первые 5 уведомлений уже загружены. Прокрути вниз, чтобы увидеть следующие.</p></div><div class="notification-list" id="notificationList"></div><div id="notificationLoadMore" class="notification-load-more" role="status"></div>';
 notificationFeedGeneration++;notificationFeedOffset=0;notificationFeedHasMore=true;notificationFeedLoading=false;
 await loadNotificationPage();
}
window.addEventListener('scroll',()=>{
 if(!NOTIFICATIONS_ROUTE||!notificationFeedHasMore||notificationFeedLoading)return;
 const sentinel=$('#notificationLoadMore');
 if(sentinel&&!sentinel.hidden&&sentinel.getBoundingClientRect().top<window.innerHeight+240)void loadNotificationPage();
},{passive:true});

function renderAccountRoute(){
  if(ADMIN_ROUTE)return adminRoute();
  if(PUBLIC_PROFILE_ROUTE)return publicProfilePage();
  if(PROFILE_ROUTE)return showSettings();
  if(DASHBOARD_ROUTE)return showWorkspace();
  if(NOTIFICATIONS_ROUTE)return notificationsView();
  if(MESSAGES_ROUTE)return messagesView();
}
async function subscribeToNotifications(){
  if(!supabaseAuth||!signedIn()||!user?.id)return;
  if(notificationsChannel&&notificationsChannelUserId===user.id)return;
  const token=sessionStorage.getItem(tokenKey);
  if(!token)return;
  try{
    if(notificationsChannel)await supabaseAuth.removeChannel(notificationsChannel);
    notificationsChannel=null;notificationsChannelUserId=null;
    await supabaseAuth.realtime.setAuth(token);
    notificationsConnection='CONNECTING';
    notificationsChannel=supabaseAuth.channel('flowtix-notifications-'+user.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+user.id},(payload)=>{
         const notice=payload.new;
         if(!notice||notice.user_id!==user.id)return;
         const isDirectMessage=notice.type==='direct_message';
         let openedConversation=false;
         if(isDirectMessage&&notice.action_url){
           try{const target=new URL(notice.action_url,window.location.origin);openedConversation=activeChatId===target.searchParams.get('conversation')}catch{}
         }
         const visibleMessagesPage=isDirectMessage&&MESSAGES_ROUTE&&document.visibilityState==='visible';
         if(visibleMessagesPage){
           if(openedConversation){
             void api('/api/notifications/'+encodeURIComponent(notice.id)+'/read',{method:'PATCH'}).then(()=>refreshNotificationUnreadCount()).catch(()=>{});
           }else{
             notificationUnreadCount++;updateNotificationBadge();
           }
           return;
         }
         notificationUnreadCount++;updateNotificationBadge();
         toast((notice.title||'Новое уведомление')+(notice.message?' · '+notice.message:''));
         if(NOTIFICATIONS_ROUTE)void notificationsView();
       })
       .on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:'user_id=eq.'+user.id},()=>{
        void refreshNotificationUnreadCount();
      })
      .subscribe((status)=>{
        notificationsConnection=status;
        const label=$('#notificationsLiveStatus');
        const dot=$('.notification-live-dot');
        if(label)label.textContent=status==='SUBSCRIBED'?'Подключено · новые уведомления приходят сразу':status==='CHANNEL_ERROR'||status==='TIMED_OUT'?'Нет соединения · переподключаемся…':'Подключаемся к уведомлениям…';
        if(dot)dot.classList.toggle('is-live',status==='SUBSCRIBED');
        if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('Realtime notifications channel status:',status);
      });
    notificationsChannelUserId=user.id;
  }catch(error){
    notificationsConnection='CHANNEL_ERROR';
    console.warn('Could not subscribe to real-time notifications:',error);
  }
}

function createProgramDraftItem(type='activity',isChild=false) {
  const section=type==='section',node=document.createElement('div');
  node.className='program-draft '+(section?'program-section':'program-activity')+(isChild?' program-child':'');
  node.dataset.programItem='';node.dataset.programType=type;node.dataset.programKey=crypto.randomUUID();
  node.innerHTML='<div class="program-draft-heading"><span class="program-type-tag">'+(section?'Секция':'Элемент')+'</span><button type="button" class="button button-quiet button-small" data-remove-program-item>Удалить</button></div><label>Название<input data-program-field="title" maxlength="180" placeholder="'+(section?'Секция №1':'Например, Лекция')+'"></label><div class="program-time-grid"><label>Начало<input data-program-field="start_time" type="time"></label><label>Длительность, минут<input data-program-field="duration_minutes" type="number" min="1" max="1440" placeholder="45"></label></div><div class="program-time-grid"><label>Ведущий<input data-program-field="speaker_name" maxlength="160" placeholder="Имя ведущего"></label><label>Помещение<input data-program-field="room_name" maxlength="120" placeholder="Зал или помещение"></label></div><label>Максимум участников<input data-program-field="max_attendees" type="number" min="1" max="100000" placeholder="Как вместимость мероприятия"></label><label>Описание<textarea data-program-field="description" rows="2" maxlength="2000" placeholder="Коротко о пункте программы"></textarea></label>'+(section?'<button type="button" class="button button-light button-small" data-add-program-child>Добавить элемент в секцию</button><div class="program-children" data-program-children></div>':'');
  return node;
}
function collectProgramDraft(list,parentKey=null) {
  const out=[];
  for(const row of [...list.children].filter(node=>node.matches('[data-program-item]'))){
    const get=(field)=>row.querySelector('[data-program-field="'+field+'"]')?.value?.trim()||'';
    const children=row.querySelector('[data-program-children]'),childRows=children?[...children.children].filter(node=>node.matches('[data-program-item]')):[];
    const explicitCapacity=get('max_attendees'),eventCapacity=Number($('#createEventForm [name="total_seats"]')?.value||1);
    const v={title:get('title'),start_time:get('start_time'),duration_minutes:get('duration_minutes'),speaker_name:get('speaker_name'),room_name:get('room_name'),max_attendees:explicitCapacity||String(eventCapacity),description:get('description')};
    const hasData=v.title||v.start_time||v.duration_minutes||v.speaker_name||v.room_name||v.description||explicitCapacity||childRows.length;
    if(!hasData)continue;
    const duration=Number(v.duration_minutes),capacity=Number(v.max_attendees);
    if(!v.title||!/^\\d{2}:\\d{2}$/.test(v.start_time)||!Number.isInteger(duration)||duration<1||duration>1440||!Number.isInteger(capacity)||capacity<1)throw new Error('Для каждого элемента программы укажи название, время начала, длительность и лимит участников.');

    const start=Number(v.start_time.slice(0,2))*60+Number(v.start_time.slice(3,5)),end=(start+duration)%1440;
    out.push({...v,item_type:row.dataset.programType,client_key:row.dataset.programKey,parent_key:parentKey,duration_minutes:duration,max_attendees:capacity,end_time:String(Math.floor(end/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0')});
    if(children){const nested=collectProgramDraft(children,row.dataset.programKey);if(!nested.length)throw new Error('Добавь хотя бы один заполненный элемент внутрь каждой секции.');out.push(...nested)}
  }
  return out;
}
function renderEventProgram(items=[]) {
  const nodes=new Map(),roots=[];
  for(const item of items)nodes.set(String(item.id||item.client_key),{...item,children:[]});
  for(const node of nodes.values()){const parentId=node.parent_section_id||node.parent_key,parent=parentId&&nodes.get(String(parentId));if(parent)parent.children.push(node);else roots.push(node)}
  const sorted=(list)=>list.sort((a,b)=>String(a.start_time||'').localeCompare(String(b.start_time||'')));
  const render=(node)=>'<li class="agenda-item '+(node.item_type==='section'?'agenda-section':'')+'"><div class="agenda-item-heading"><span class="agenda-time">'+esc([node.start_time,node.end_time].filter(Boolean).join('–'))+'</span><b>'+esc(node.title)+'</b></div><div class="agenda-item-meta"><span>'+esc(node.duration_minutes||'—')+' мин</span>'+(node.speaker_name?'<span>'+esc(node.speaker_name)+'</span>':'')+(node.room_name?'<span>'+esc(node.room_name)+'</span>':'')+(node.max_attendees?'<span>до '+esc(node.max_attendees)+' участников</span>':'')+'</div>'+(node.description?'<p>'+esc(node.description)+'</p>':'')+(node.children.length?'<ol class="agenda-children">'+sorted(node.children).map(render).join('')+'</ol>':'')+'</li>';
  return roots.length?'<ol class="program-agenda">'+sorted(roots).map(render).join('')+'</ol>':'<p>Расписание ещё не добавлено.</p>';
}
async function organizerView() {
  const load=async(path)=>{try{return await api(path)}catch(error){return {error:error.message}}};
  const [ev,venuesData,cats,registrations,employees,hallsData]=await Promise.all([
    load('/api/organizer/events'),load('/api/organizer/venues'),load('/api/categories'),
    load('/api/organizer/registrations'),load('/api/organizer/employees'),load('/api/organizer/halls')
  ]);
  const myEvents=ev.events||[];
  const venues=venuesData.venues||[];
  const categories=cats.categories||[];
  const staff=employees.employees||[];
  const halls=hallsData.halls||[];
  organizerEvents=myEvents;
  const warnings=[ev,venuesData,cats,registrations,employees,hallsData].filter(x=>x.error).map(x=>esc(x.error));
  const warningHtml=warnings.length?'<div class="connection-state organizer-load-warning">Некоторые данные кабинета не загрузились: '+warnings.join(' · ')+'</div>':'';
  const venueOptions=(selected)=>'<option value="">Без площадки</option>'+venues.map(v=>'<option value="'+esc(v.id)+'" data-address="'+esc(v.address||'')+'" '+(String(selected||'')===String(v.id)?'selected':'')+'>'+esc(v.name+' · '+v.city)+'</option>').join('');
  const hallOptions=(selected='',venueId='')=>'<option value="">Без схемы зала · свободная рассадка</option>'+halls.filter(h=>!venueId||String(h.venue_id)===String(venueId)).map(h=>'<option value="'+esc(h.id)+'" data-venue-id="'+esc(h.venue_id||'')+'" '+(String(selected||'')===String(h.id)?'selected':'')+'>'+esc(h.name+' · '+(h.venues?.name||'Площадка')+' · '+h.total_capacity+' мест')+'</option>').join('');
  const categoryOptions='<option value="">Выберите категорию</option>'+categories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
  const venueForm='<div class="workspace-card organizer-venue-card" id="organizerVenues"><div class="workspace-card-heading"><div><p class="eyebrow dark-eyebrow">СНАЧАЛА МЕСТО</p><h3>Площадки</h3></div><span class="event-count">'+venues.length+' площадок</span></div><p class="workspace-help">Создай площадку с городом и адресом. Затем выбери её при создании мероприятия — или укажи отдельный адрес события.</p><form id="createVenueForm" class="form-grid"><label>Название площадки<input name="name" required maxlength="160" placeholder="Например, Конгресс-холл"></label><label>Город<input name="city" required maxlength="100"></label><label class="wide">Адрес площадки<input name="address" required maxlength="240" placeholder="Улица, дом, вход"></label><label class="wide">Описание<textarea name="description" rows="2" maxlength="3000"></textarea></label><div class="wide form-actions"><button class="button button-light">Добавить площадку</button></div></form></div>';
  const createHallForm='<div class="workspace-card organizer-hall-card"><div class="workspace-card-heading"><div><p class="eyebrow dark-eyebrow">СХЕМА ЗАЛА</p><h3>Залы и места</h3></div><span class="event-count">'+halls.length+' схем</span></div><p class="workspace-help">Создай зал для своей площадки. Система подготовит места и интерактивную схему с рядами.</p><form id="createHallForm" class="form-grid"><label>Площадка<select name="venueId" required><option value="">Выбери свою площадку</option>'+venues.filter(v=>v.owner_id===user?.id).map(v=>'<option value="'+esc(v.id)+'">'+esc(v.name+' · '+v.city)+'</option>').join('')+'</select></label><label>Название зала<input name="name" required maxlength="160" placeholder="Например, Большой зал"></label><label>Количество мест<input name="capacity" type="number" min="1" max="2000" value="100" required></label><label>Мест в ряду<input name="cols" type="number" min="1" max="40" value="10" required></label><div class="wide form-actions"><button class="button button-light">Создать схему мест</button></div></form></div>';
  const createForm='<div class="workspace-card"><div class="workspace-card-heading"><div><p class="eyebrow dark-eyebrow">НОВОЕ СОБЫТИЕ</p><h3>Создать мероприятие</h3></div></div><p class="workspace-help">Укажи площадку и адрес, добавь обложку и проверь карточку в предпросмотре. После отправки мероприятие появится после модерации.</p><form id="createEventForm" class="form-grid"><label class="wide">Название<input name="title" required maxlength="180" placeholder="Как называется событие?"></label><label>Категория<select name="category_id">'+categoryOptions+'</select></label><label>Площадка<select name="venue_id" data-venue-select>'+venueOptions('')+'</select></label><label>Схема зала<select name="hall_id" data-hall-select>'+hallOptions()+'</select></label><label class="wide">Адрес мероприятия<input name="location_address" data-event-address required maxlength="500" placeholder="Город, улица, дом, площадка"></label><label>Дата<input name="start_date" type="date" required></label><label>Начало<input name="start_time" type="time" required></label><label>Окончание<input name="end_time" type="time" required></label><label>Возрастное ограничение<select name="age_limit"><option>Для всех</option><option>6+</option><option>12+</option><option>16+</option><option>18+</option></select></label><label>Вместимость<input name="total_seats" type="number" min="1" max="100000" required></label><label>Цена, ₸<input name="base_price" type="number" min="0" step="1" value="0"></label><label>Контактный email<input name="contact_email" type="email" maxlength="254" value="'+esc(user?.email||'')+'" placeholder="organizer@example.com"></label><label>Контактный телефон<input name="contact_phone" type="tel" maxlength="40" value="'+esc(user?.phone||'')+'" placeholder="+7 …"></label><label class="wide">Описание<textarea name="description" rows="4" maxlength="10000" placeholder="Расскажи, что ждёт гостей"></textarea></label><label class="wide">Правила посещения<textarea name="rules" rows="3" maxlength="5000" placeholder="Что гостям нужно знать перед посещением?"></textarea></label><div class="wide workspace-card program-builder"><div class="workspace-card-heading"><div><p class="eyebrow dark-eyebrow">ПРОГРАММА</p><h3>Конструктор программы</h3></div><div class="inline-actions"><button type="button" class="button button-light button-small" data-add-program-item="activity">Добавить элемент</button><button type="button" class="button button-light button-small" data-add-program-item="section">Добавить секцию</button></div></div><p class="workspace-help">Собери программу из верхнеуровневых пунктов и секций с вложенными лекциями, перерывами и практикой.</p><div id="eventProgramList" class="program-draft-list"></div></div><label class="wide cover-file-label">Обложка мероприятия<input id="eventCoverInput" type="file" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG или WebP. Изображение автоматически сожмётся.</small></label><div id="createCoverPreview" class="wide cover-preview" hidden></div><label class="wide">Организатор<input value="'+esc(user?.full_name||'')+' · '+esc(user?.email||'')+'" readonly></label><div class="wide form-actions"><button class="button button-light" type="button" data-preview-create-event>Предпросмотр</button><button class="button button-dark" type="submit">Отправить на модерацию</button></div></form></div>';
  const eventRows=myEvents.map(e=>{
    const venueId=e.venue_id||e.venues?.id||'';
    const venueAddress=e.location_address||e.venues?.address||'';
    const editCategories='<option value="">Без категории</option>'+categories.map(c=>'<option value="'+esc(c.id)+'" '+(String(e.category_id||'')===String(c.id)?'selected':'')+'>'+esc(c.name)+'</option>').join('');
    const programItems=e.event_program||[];
    const programSections=new Map(programItems.filter(item=>item.item_type==='section').map(item=>[String(item.id),item.title]));
    const programEditors=programItems.map(item=>{
      const parentName=item.parent_section_id?programSections.get(String(item.parent_section_id)):'';
      const start=String(item.start_time||'').slice(0,5);
      return '<form class="program-edit-form" data-program-edit="'+esc(item.id)+'"><div class="program-edit-heading"><b>'+esc(item.item_type==='section'?'Секция':'Пункт программы')+(parentName?' · '+esc(parentName):'')+'</b><button type="button" class="button button-quiet button-small" data-program-delete="'+esc(item.id)+'">Удалить</button></div><label>Название<input name="title" value="'+esc(item.title||'')+'" required maxlength="180"></label><div class="program-time-grid"><label>Начало<input name="start_time" type="time" value="'+esc(start)+'" required></label><label>Длительность, минут<input name="duration_minutes" type="number" min="1" max="1440" value="'+esc(item.duration_minutes||45)+'" required></label></div><div class="program-time-grid"><label>Ведущий<input name="speaker_name" value="'+esc(item.speaker_name||'')+'" maxlength="160"></label><label>Помещение<input name="room_name" value="'+esc(item.room_name||'')+'" maxlength="120"></label></div><label>Максимум участников<input name="max_attendees" type="number" min="1" max="100000" value="'+esc(item.max_attendees||e.total_seats||1)+'" required></label><label>Описание<textarea name="description" rows="2" maxlength="2000">'+esc(item.description||'')+'</textarea></label><button class="button button-light button-small" type="submit">Сохранить пункт</button></form>';
    }).join('')||'<p class="workspace-help">В программе пока нет пунктов.</p>';
    return '<details class="event-tools organizer-event-item"><summary><b>'+esc(e.title)+'</b><span class="status-pill">'+esc(eventStatusLabel(e.status))+'</span></summary><div class="event-tools-actions"><span>'+esc([e.venues?.name,e.venues?.city,e.location_address||e.venues?.address].filter(Boolean).join(' · ')||'Адрес не указан')+'</span><button type="button" class="button button-light button-small" data-organizer-preview="'+esc(e.id)+'">Предпросмотр</button></div><form class="event-edit-form form-grid" data-event-edit="'+esc(e.id)+'"><label>Название<input name="title" value="'+esc(e.title)+'" required maxlength="180"></label><label>Категория<select name="category_id">'+editCategories+'</select></label><label>Площадка<select name="venue_id" data-venue-select>'+venueOptions(venueId)+'</select></label><label>Схема зала<select name="hall_id" data-hall-select>'+hallOptions(e.hall_id||'',venueId)+'</select></label><label>Адрес мероприятия<input name="location_address" data-event-address value="'+esc(venueAddress)+'" required maxlength="500"></label><label>Дата<input name="start_date" type="date" value="'+esc(e.start_date)+'" required></label><label>Начало<input name="start_time" type="time" value="'+esc(e.start_time)+'" required></label><label>Окончание<input name="end_time" type="time" value="'+esc(e.end_time)+'" required></label><label>Возрастное ограничение<select name="age_limit">'+['Для всех','6+','12+','16+','18+'].map(age=>'<option '+(String(e.age_limit||'Для всех')===age?'selected':'')+'>'+age+'</option>').join('')+'</select></label><label>Цена, ₸<input name="base_price" type="number" min="0" value="'+esc(e.base_price)+'"></label><label>Контактный email<input name="contact_email" type="email" maxlength="254" value="'+esc(e.contact_email||'')+'"></label><label>Контактный телефон<input name="contact_phone" type="tel" maxlength="40" value="'+esc(e.contact_phone||'')+'"></label><label class="wide">Организатор<input value="'+esc(e.users?.full_name||user?.full_name||'')+' · '+esc(e.users?.email||user?.email||'')+'" readonly></label><label class="wide">Описание<textarea name="description" rows="3">'+esc(e.description||'')+'</textarea></label><label class="wide">Правила посещения<textarea name="rules" rows="3" maxlength="5000">'+esc(e.rules||'')+'</textarea></label><input type="hidden" name="cover_image" value="'+esc(e.cover_image||'')+'"><label class="wide cover-file-label">Заменить обложку<input type="file" data-event-cover-file accept="image/jpeg,image/png,image/webp"><small>Текущая обложка сохранится, если новый файл не выбрать.</small></label><button class="button button-light button-small">Сохранить изменения</button></form><section class="program-management"><div class="workspace-card-heading"><div><p class="eyebrow dark-eyebrow">ПРОГРАММА</p><h4>Элементы и секции</h4></div></div><div class="program-edit-list">'+programEditors+'</div></section><div class="tool-grid"><form class="program-form" data-event="'+esc(e.id)+'"><b>Добавить пункт расписания</b><label>Название<input name="title" placeholder="Тема / пункт программы" required maxlength="180"></label><div class="program-time-grid"><label>Начало<input name="start_time" type="time" required></label><label>Окончание<input name="end_time" type="time" required></label></div><div class="program-time-grid"><label>Спикер<input name="speaker_name" placeholder="Спикер" maxlength="160"></label><label>Зал<input name="room_name" placeholder="Зал" maxlength="120"></label></div><label>Максимум участников<input name="max_attendees" type="number" min="1" max="100000" value="'+esc(e.total_seats||1)+'" required></label><label>Описание<textarea name="description" rows="2" maxlength="2000" placeholder="Описание пункта"></textarea></label><button class="button button-light button-small">Добавить в расписание</button></form><form class="assign-form" data-event="'+esc(e.id)+'"><b>Назначить сотрудника</b><select name="employeeId" required>'+(staff.length?staff.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.users?.full_name||s.users?.email||'Сотрудник')+' · '+esc(s.position)+'</option>').join(''):'<option value="">Нет сотрудников с ролью «Сотрудник»</option>')+'</select><input name="role" placeholder="Роль на событии" value="Контролёр"><button class="button button-light button-small">Назначить</button></form><form class="notify-form" data-event="'+esc(e.id)+'"><b>Уведомить участников</b><input name="title" placeholder="Заголовок" value="'+esc(e.title)+'"><textarea name="message" placeholder="Текст уведомления" required></textarea><button class="button button-light button-small">Отправить уведомление</button></form></div></details>';
  }).join('');
  const participantRows=(registrations.registrations||[]).map(r=>'<tr><td>'+esc(r.ticket_number||'—')+'</td><td>'+esc(r.users?.full_name||r.users?.email||'—')+'</td><td>'+esc(r.events?.title||'—')+'</td><td>'+esc(r.seat_label||'—')+'</td><td>'+esc(eventStatusLabel(r.status))+'</td></tr>').join('');
  $('#workspaceContent').innerHTML=warningHtml+'<div class="stats-grid"><div class="workspace-card"><small>Мои мероприятия</small><h3>'+myEvents.length+'</h3></div><div class="workspace-card"><small>Регистрации</small><h3>'+(registrations.registrations||[]).length+'</h3></div><div class="workspace-card"><small>Площадки</small><h3>'+venues.length+'</h3></div></div>'+venueForm+createHallForm+createForm+'<div class="workspace-card"><h3>Мои мероприятия ('+myEvents.length+')</h3>'+(eventRows||empty(ev.error?'Не удалось загрузить ваши мероприятия.': 'Создайте первое мероприятие с адресом и обложкой.'))+'</div><div class="workspace-card"><h3>Участники ('+(registrations.registrations||[]).length+')</h3>'+(participantRows?'<div class="scroll-table"><table class="data-table"><thead><tr><th>Билет</th><th>Участник</th><th>Мероприятие</th><th>Место</th><th>Статус</th></tr></thead><tbody>'+participantRows+'</tbody></table></div>':empty(registrations.error?'Не удалось загрузить участников.':'Регистраций пока нет.'))+'</div>';
}
function parseTicketQr(raw){
 const text=String(raw||'').trim();
 try{const value=JSON.parse(text);return {ticketNumber:String(value.ticketNumber||value.ticket_number||value.ticket||''),eventId:String(value.eventId||value.event_id||value.event||'')}}catch{}
 try{const url=new URL(text);return {ticketNumber:url.searchParams.get('ticket')||url.searchParams.get('ticketNumber')||'',eventId:url.searchParams.get('event')||url.searchParams.get('eventId')||''}}catch{}
 return {ticketNumber:text,eventId:''};
}
function stopTicketScanner(){
 if(ticketScannerFrame)cancelAnimationFrame(ticketScannerFrame);ticketScannerFrame=0;
 if(ticketScannerStream){ticketScannerStream.getTracks().forEach(track=>track.stop());ticketScannerStream=null}
 const video=$('#ticketScannerVideo');if(video){video.pause();video.srcObject=null;video.hidden=true}
 const button=$('[data-start-ticket-scan]');if(button)button.hidden=false;
 const stop=$('[data-stop-ticket-scan]');if(stop)stop.hidden=true;
}
async function submitTicketCheckIn(form){
 const fields=new FormData(form),raw=String(fields.get('ticket')||''),selectedEventId=String(fields.get('eventId')||'');
 const qr=parseTicketQr(raw),result=$('#scanResult');
 if(!selectedEventId){result.textContent='Сначала выберите мероприятие.';return}
 if(!qr.ticketNumber){result.textContent='QR-код не содержит номера билета.';return}
 result.classList.remove('is-success');result.textContent='Проверяем билет…';ticketScannerBusy=true;
 try{
  const response=await api('/api/staff/tickets/'+encodeURIComponent(qr.ticketNumber)+'/check-in',{method:'POST',body:JSON.stringify({eventId:selectedEventId})});
  result.textContent='Вход отмечен · '+response.ticket.ticket_number;result.classList.add('is-success');toast('Билет проверен');stopTicketScanner();form.elements.ticket.value='';
 }catch(error){result.textContent=error.message}
 finally{ticketScannerBusy=false}
}
async function startTicketScanner(){
 if(!navigator.mediaDevices?.getUserMedia){toast('Браузер не разрешил доступ к камере. Введите номер билета вручную.');return}
 const scanForm=$('#scanForm');if(!scanForm?.elements.eventId?.value){const message=$('#scanResult');if(message)message.textContent='Сначала выберите назначенное мероприятие.';return}
 try{
  const detector=window.BarcodeDetector?new BarcodeDetector({formats:['qr_code']}):null;
  const fallback=detector?null:await loadQrScannerFallback();
  const video=$('#ticketScannerVideo');
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  ticketScannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
  video.srcObject=ticketScannerStream;video.hidden=false;await video.play();
  $('[data-start-ticket-scan]').hidden=true;$('[data-stop-ticket-scan]').hidden=false;
  const scan=async()=>{
   if(!ticketScannerStream||ticketScannerBusy)return;
   try{
    let raw='';
    if(detector){const found=await detector.detect(video);raw=found[0]?.rawValue||''}
    else if(video.videoWidth){canvas.width=Math.max(1,Math.floor(video.videoWidth/2));canvas.height=Math.max(1,Math.floor(video.videoHeight/2));context.drawImage(video,0,0,canvas.width,canvas.height);const pixels=context.getImageData(0,0,canvas.width,canvas.height);raw=fallback(pixels.data,pixels.width,pixels.height,{inversionAttempts:'dontInvert'})?.data||''}
    if(raw){const form=$('#scanForm'),qr=parseTicketQr(raw);stopTicketScanner();if(!qr.ticketNumber){$('#scanResult').textContent='QR-код распознан, но в нём нет номера билета.';return}form.elements.ticket.value=qr.ticketNumber;$('#scanResult').textContent='QR распознан · код билета '+qr.ticketNumber+'. Нажмите «Проверить и отметить вход».';return}
   }catch(error){console.warn('QR scan failed:',error)}
   ticketScannerFrame=requestAnimationFrame(scan);
  };
  ticketScannerFrame=requestAnimationFrame(scan);
 }catch(error){stopTicketScanner();toast(error.name==='NotAllowedError'?'Разрешите доступ к камере.':('Не удалось запустить сканер: '+error.message))}
}
function setStaffEventPicker(form,eventId){
  const value=String(eventId||'');
  const input=form?.elements.eventId;
  const picker=form?.querySelector('[data-staff-event-picker]');
  if(!input||!picker)return;
  input.value=value;
  const selected=picker.querySelector('[data-staff-event-option="'+CSS.escape(value)+'"]');
  const label=picker.querySelector('[data-staff-event-current]');
  if(label)label.textContent=selected?.querySelector('span')?.textContent||'Выберите мероприятие';
  picker.querySelectorAll('[data-staff-event-option]').forEach(option=>option.classList.toggle('is-selected',option===selected));
  const toggle=picker.querySelector('[data-staff-event-toggle]');
  toggle?.setAttribute('aria-expanded','false');
  const menu=picker.querySelector('[data-staff-event-menu]');
  if(menu)menu.hidden=true;
}
const staffParticipantFeeds=new Map();
const staffParticipantObservers=new Map();
async function loadStaffParticipants(eventId,panel,retry=false){
  const key=String(eventId),feed=staffParticipantFeeds.get(key);
  if(!feed||feed.loading)return;
  if(feed.loaded&&!feed.hasMore&&!retry)return;
  if(retry){feed.error=null;feed.loaded=false}
  feed.loading=true;
  const more=panel.querySelector('[data-participants-more]');
  if(more){more.disabled=true;more.textContent='Загружаем…'}
  try{
    const result=await api('/api/staff/events/'+encodeURIComponent(key)+'/participants?offset='+feed.offset);
    feed.rows.push(...(result.participants||[]));
    feed.offset+=result.participants?.length||0;
    feed.total=Number(result.total??feed.rows.length);
    feed.hasMore=Boolean(result.hasMore);
    feed.loaded=true;feed.error=null;
  }catch(error){feed.error=error.message}
  finally{
    feed.loading=false;
    const rows=feed.rows.map(participant=>'<tr><td>'+esc(participant.ticket_number)+'</td><td>'+esc(participant.users?.full_name||participant.users?.email||'Участник')+'</td><td>'+esc(participant.seat_label||'Без места')+'</td><td>'+esc(participant.status==='used'?'Вход отмечен':'Билет действителен')+'</td></tr>').join('');
    const content=panel.querySelector('[data-participant-content]');
    if(content){
      if(feed.error){
        content.innerHTML=(rows?'<div class="scroll-table"><table class="data-table"><thead><tr><th>Билет</th><th>Посетитель</th><th>Место</th><th>Статус</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'')+'<p class="connection-state">Не удалось загрузить список участников. '+esc(feed.error)+'</p><button type="button" class="button button-light button-small" data-retry-participants="'+esc(key)+'">Повторить</button>';
      }else if(!feed.rows.length){
        content.innerHTML=empty('В этом мероприятии пока нет участников.');
      }else{
        content.innerHTML='<div class="scroll-table"><table class="data-table"><thead><tr><th>Билет</th><th>Посетитель</th><th>Место</th><th>Статус</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(feed.hasMore?'<button type="button" class="button button-light button-small staff-participants-more" data-participants-more="'+esc(key)+'">Загрузить ещё 5</button>':'<p class="admin-event-end">Показаны все участники.</p>');
      }
    }
    const count=panel.querySelector('[data-participant-count]');
    if(count)count.textContent='Участники ('+feed.total+')';
    observeStaffParticipantFeed(key,panel);
  }
}
function observeStaffParticipantFeed(eventId,panel){
  staffParticipantObservers.get(String(eventId))?.disconnect();
  const feed=staffParticipantFeeds.get(String(eventId)),button=panel.querySelector('[data-participants-more]');
  if(!feed?.hasMore||!button||!panel.closest('details')?.open)return;
  if('IntersectionObserver'in window){
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadStaffParticipants(eventId,panel)},{rootMargin:'180px'});
    staffParticipantObservers.set(String(eventId),observer);observer.observe(button);
  }
}
document.addEventListener('toggle',(event)=>{
  const card=event.target;
  if(!(card instanceof HTMLDetailsElement)||!card.matches('[data-staff-event-card]'))return;
  const eventId=card.dataset.staffEventCard,panel=card.querySelector('[data-participant-panel]');
  if(card.open){
    const feed=staffParticipantFeeds.get(String(eventId));
    if(feed?.loaded)observeStaffParticipantFeed(eventId,panel);
    else void loadStaffParticipants(eventId,panel);
  }else staffParticipantObservers.get(String(eventId))?.disconnect();
},true);
async function staffView() {
  staffParticipantObservers.forEach(observer=>observer.disconnect());staffParticipantObservers.clear();staffParticipantFeeds.clear();
  try {
    const {assignments=[]}=await api('/api/staff/assignments');
    const assignedEvents=[...new Map(assignments.map(a=>a.events).filter(e=>e?.id).map(e=>[String(e.id),e])).values()];
    const cards=assignedEvents.map(event=>{
      staffParticipantFeeds.set(String(event.id),{offset:0,total:0,rows:[],hasMore:true,loading:false,loaded:false,error:null});
      return '<details class="workspace-card staff-event-card" data-staff-event-card="'+esc(event.id)+'"><summary><span class="staff-event-summary-title">'+esc(event.title||'Мероприятие')+' · '+esc(event.start_date||'')+(event.venues?.name?' · '+esc(event.venues.name):'')+'</span><span class="staff-event-summary-meta" data-participant-count>Участники</span><svg class="staff-event-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><div class="staff-participant-panel" data-participant-panel><div data-participant-content><p class="staff-participant-placeholder">Откройте вкладку, чтобы загрузить список участников.</p></div></div></details>';
    }).join('');
    const eventPicker=assignedEvents.length
      ?'<div class="staff-event-picker" data-staff-event-picker><input type="hidden" name="eventId" value=""><button type="button" class="staff-event-toggle" data-staff-event-toggle aria-expanded="false"><span data-staff-event-current>Выберите мероприятие</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="staff-event-menu" data-staff-event-menu hidden>'+assignedEvents.map(e=>'<button type="button" class="staff-event-option" data-staff-event-option="'+esc(e.id)+'"><span>'+esc(e.title||'Мероприятие')+'</span><small>'+esc([e.start_date,e.start_time,e.venues?.name].filter(Boolean).join(' · '))+'</small></button>').join('')+'</div></div>'
      :'<div class="staff-assignment-empty"><b>Нет назначенных мероприятий</b><span>Попросите организатора или администратора назначить вас сотрудником мероприятия.</span></div>';
    const checkin=assignedEvents.length
      ?'<form id="scanForm" class="staff-checkin-form"><label>Мероприятие'+eventPicker+'</label><label>Код билета<input name="ticket" placeholder="FT-…" autocomplete="off" required></label><div class="staff-checkin-actions"><button class="button button-light" type="button" data-start-ticket-scan>Сканировать QR</button><button class="button button-dark" type="submit">Проверить и отметить вход</button><button class="button button-light" type="button" data-stop-ticket-scan hidden>Остановить камеру</button></div><video id="ticketScannerVideo" class="ticket-scanner-video" playsinline muted hidden></video></form><p id="scanResult" class="ticket-scan-result" role="status" aria-live="polite"></p>'
      :'<div class="staff-checkin-empty">Проверка билетов появится после назначения на мероприятие.</div>';
    $('#workspaceContent').innerHTML=(cards||'<div class="workspace-card staff-assignment-card"><div class="staff-assignment-empty"><b>Пока нет назначенных мероприятий</b><span>Когда организатор добавит вас в команду, здесь появятся мероприятие, список участников и проверка билетов.</span></div></div>')+'<div class="workspace-card staff-checkin-card"><h3>Проверка билета</h3><p>Выберите назначенное мероприятие, отсканируйте QR и проверьте код билета.</p>'+checkin+'</div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
const complaintStatusLabel=(status)=>({new:'Новая',in_review:'В работе',resolved:'Принята',rejected:'Отклонена'}[status]||'Неизвестный статус');
function complaintCardMarkup(c){
 const author=c.users?.full_name||c.users?.username||'Автор не указан';
 const authorMeta=[c.users?.username?'@'+c.users.username:'',c.users?.email||''].filter(Boolean).join(' · ');
 const authorHref='/profile/'+encodeURIComponent(c.users?.username||c.author_id||'');
 const typeName=({event:'мероприятие',user:'пользователь',review:'отзыв',ticket:'билет'})[c.target_type]||'объект';
 const target=c.target||{};
 const targetTitle=target.title||target.full_name||target.ticket_number||(c.target_type==='review'?target.comment:'')||'Объект не найден';
 const targetDate=target.start_date?[target.start_date,target.start_time].filter(Boolean).join(' · '):'';
 const targetAddress=target.venues?[target.venues.city,target.venues.name,target.location_address||target.venues.address].filter(Boolean).join(' · '):'';
 const targetExtra=c.target_type==='event'?[targetDate,targetAddress].filter(Boolean).join(' · '):c.target_type==='user'?[target.username?'@'+target.username:'',target.email].filter(Boolean).join(' · '):c.target_type==='review'?target.events?.title||target.comment||'':c.target_type==='ticket'?target.events?.title||'':'';
 const relatedEventId=c.target_type==='event'?c.target_id:(target.event_id||target.events?.id||null);
 const targetHref=relatedEventId?'/?eventId='+encodeURIComponent(relatedEventId)+'#events':c.target_type==='user'?'/profile/'+encodeURIComponent(target.username||c.target_id||''):'';
 const targetAction=targetHref?'<a class="button button-light button-small" href="'+esc(targetHref)+'">'+(c.target_type==='user'?'Открыть профиль ↗':'Открыть мероприятие ↗')+'</a>':'<span class="complaint-no-target">Переход недоступен</span>';
 const created=c.created_at?new Date(c.created_at).toLocaleString('ru-RU'):'';
 const actions=c.status==='in_review'
  ?'<button type="button" class="button button-accent button-small" data-complaint-action="'+esc(c.id)+'" data-complaint-next="resolved">Одобрить жалобу</button><button type="button" class="button button-danger button-small" data-complaint-action="'+esc(c.id)+'" data-complaint-next="rejected">Отклонить жалобу</button>'
  :'<button type="button" class="button button-light button-small" data-complaint-action="'+esc(c.id)+'" data-complaint-next="in_review">Взять в работу</button>';
 return '<article class="complaint-review-card" data-complaint-card="'+esc(c.id)+'" data-complaint-current="'+esc(c.status||'new')+'"><div class="complaint-review-head"><div><span class="status-pill" data-complaint-status>'+esc(complaintStatusLabel(c.status))+'</span><h4>'+esc(c.reason||'Жалоба')+'</h4><small>'+esc(created)+'</small></div></div><div class="complaint-review-target"><div><small>На что жалоба · '+esc(typeName)+'</small><b>'+esc(targetTitle)+'</b>'+(targetExtra?'<span>'+esc(targetExtra)+'</span>':'')+'</div>'+targetAction+'</div><div class="complaint-review-author"><span><small>Отправитель жалобы</small><b>'+esc(author)+'</b><span>'+esc(authorMeta)+'</span></span><a class="button button-light button-small" href="'+esc(authorHref)+'">Открыть профиль автора ↗</a></div><p class="complaint-review-details">'+esc(c.details||'Подробности не указаны.')+'</p><label class="complaint-review-note">Комментарий к решению<textarea data-complaint-notes="'+esc(c.id)+'" maxlength="1000" rows="2" placeholder="Необязательно. Будет отправлен автору жалобы.">'+esc(c.moderator_notes||'')+'</textarea></label><div class="inline-actions complaint-review-actions">'+actions+'</div></article>';
}
async function moderatorView() {
  try {
    const [ev,complaints,reviews,users]=await Promise.all([api('/api/moderation/events'),api('/api/moderation/complaints'),api('/api/moderation/reviews'),api('/api/moderation/users')]);
    const userRows=(users.users||[]).map(u=>'<div class="workspace-row"><span><b>'+esc(u.full_name||u.email)+'</b><br><small>'+esc(u.email)+' · '+esc(u.role)+'</small></span><button class="button button-light button-small" data-mod-user-block="'+esc(u.id)+'" data-value="'+(!u.is_blocked)+'">'+(u.is_blocked?'Разблокировать':'Заблокировать')+'</button></div>').join('');
    const reviewRows=(reviews.reviews||[]).map(x=>'<div class="workspace-row"><span><b>'+esc(x.events?.title||'Мероприятие')+'</b> · '+esc(x.overall_rating)+'/5<br><small>'+esc(x.users?.email||'')+'</small><p>'+esc(x.comment||'')+'</p></span><button class="button button-danger button-small" data-mod-review="'+esc(x.id)+'">Удалить отзыв</button></div>').join('');
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Мероприятия на проверке</h3>'+((ev.events||[]).length?ev.events.map(e=>'<div class="workspace-row"><b>'+esc(e.title)+'</b><span>'+esc(e.users?.full_name||'Организатор')+'</span><div class="inline-actions"><button class="button button-accent button-small" data-moderate="'+esc(e.id)+'" data-status="published">Одобрить</button><button class="button button-danger button-small" data-moderate="'+esc(e.id)+'" data-status="rejected">Отклонить</button></div></div>').join(''):empty('Очередь проверки пуста.'))+'</div><div class="workspace-card"><h3>Жалобы</h3>'+'<div class="complaint-review-list" data-complaint-list>'+((complaints.complaints||[]).length?complaints.complaints.map(complaintCardMarkup).join(''):empty('Новых жалоб нет.'))+'</div></div><div class="workspace-card"><h3>Отзывы</h3>'+(reviewRows||empty('Отзывов пока нет.'))+'</div><div class="workspace-card"><h3>Пользователи</h3><p>Главный администратор защищён от действий модераторов.</p>'+(userRows||empty('Пользователей нет.'))+'</div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
async function adminRoute(){
  if(!signedIn())return authOpen('login');
  $('#workspace').hidden=false;
  $('#workspaceTitle').textContent='Панель главного администратора';
  $('#workspaceContent').innerHTML='<div class="workspace-card">Проверяем доступ…</div>';
  try{await api('/api/admin/access');await adminView()}
  catch(error){const denied=error.message.includes('главному администратору')||error.message.includes('Недостаточно прав');$('#workspaceContent').innerHTML='<div class="workspace-card"><p class="connection-state">'+esc(denied?'Доступ закрыт. Панель доступна только главному администратору.':error.message)+'</p><a class="button button-light" href="/">На главную</a></div>'}
}
function closeAdminRolePicker(picker){
  picker?.classList.remove('is-open');
  const toggle=picker?.querySelector('[data-role-picker-toggle]');
  toggle?.setAttribute('aria-expanded','false');
  const menu=picker?.querySelector('.role-picker-menu');
  if(menu){menu.hidden=true;menu.style.removeProperty('left');menu.style.removeProperty('top');menu.style.removeProperty('width');menu.style.removeProperty('max-height')}
}
function positionAdminRolePicker(picker){
  const menu=picker?.querySelector('.role-picker-menu');
  if(!menu)return;
  menu.hidden=false;
  const rect=picker.getBoundingClientRect();
  const viewportWidth=window.innerWidth||document.documentElement.clientWidth;
  const viewportHeight=window.innerHeight||document.documentElement.clientHeight;
  const naturalHeight=menu.scrollHeight;
  const below=Math.max(0,viewportHeight-rect.bottom-8);
  const above=Math.max(0,rect.top-8);
  const openAbove=below<Math.min(naturalHeight,320)&&above>below;
  const maxHeight=Math.min(320,viewportHeight-20,Math.max(100,openAbove?above:below));
  const width=Math.min(Math.max(180,rect.width),viewportWidth-20);
  const left=Math.max(10,Math.min(rect.left,viewportWidth-width-10));
  const top=openAbove?Math.max(10,rect.top-maxHeight-7):Math.min(rect.bottom+7,viewportHeight-maxHeight-10);
  menu.style.left=left+'px';
  menu.style.top=top+'px';
  menu.style.width=width+'px';
  menu.style.maxHeight=maxHeight+'px';
}
document.addEventListener('click',(event)=>{
  const target=event.target instanceof Element?event.target:null;
  if(target?.closest('[data-role-picker]'))return;
  document.querySelectorAll('.role-picker.is-open').forEach(closeAdminRolePicker);
},true);
document.addEventListener('scroll',(event)=>{
  if(event.target instanceof Element&&event.target.closest('.role-picker-menu'))return;
  document.querySelectorAll('.role-picker.is-open').forEach(closeAdminRolePicker);
},true);
window.addEventListener('resize',()=>document.querySelectorAll('.role-picker.is-open').forEach(closeAdminRolePicker));


let adminSelectedTab='users';
const adminTicketCache=new Map();
let walletOffset=0;
const walletMoney=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value||0))+' ₸';
function closeMoneyDialog(id){$('#'+id)?.remove();if(!document.querySelector('.money-overlay'))document.body.classList.remove('money-dialog-open')}
function mountMoneyDialog(id,html){
 closeMoneyDialog(id);
 const wrap=document.createElement('div');wrap.id=id;wrap.className='overlay money-overlay';
 wrap.innerHTML='<section class="dialog money-dialog" role="dialog" aria-modal="true"><button type="button" class="dialog-close" data-money-close="'+id+'" aria-label="Закрыть">×</button>'+html+'</section>';
 document.body.append(wrap);document.body.classList.add('money-dialog-open');wrap.querySelector('button')?.focus();wrap.addEventListener('keydown',event=>{if(event.key==='Escape'){closeMoneyDialog(id);return}if(event.key==='Tab'){const controls=[...wrap.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')].filter(x=>!x.hidden);const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}});
}
function openTicketAction(ticket,deleteOnly=false){
 const owner=ticket.users||{};
 mountMoneyDialog('ticketActionModal','<p class="eyebrow">УПРАВЛЕНИЕ БИЛЕТОМ</p><h2>'+(deleteOnly?'Удалить билет?':'Аннулировать билет')+'</h2><div class="ticket-owner"><span class="profile-avatar" id="ticketOwnerAvatar"></span><div><strong>'+esc(owner.full_name||'Участник')+'</strong><small>@'+esc(owner.username||'—')+'</small><small>'+esc(owner.email||'')+'</small></div></div><p>'+esc(ticket.events?.title||'Мероприятие')+'<br><b>'+esc(ticket.ticket_number)+'</b> · '+esc(ticket.seat_label||'Без места')+'</p><form id="ticketActionForm" data-ticket-id="'+esc(ticket.id)+'" data-delete-only="'+deleteOnly+'">'+(deleteOnly?'<p>Запись исчезнет из списка. Сохранённая история операций и возвратов останется в журнале.</p>':'<p>Билет станет недействительным, а занятое место освободится.</p><div class="ticket-action-options"><label><input type="checkbox" name="refund" '+(Number(ticket.price_paid)>0?'checked':'disabled')+'><span><b>Вернуть деньги на баланс</b><small>'+esc(Number(ticket.price_paid)>0?money(ticket.price_paid):'По этому билету деньги не списывались')+'</small></span></label><label><input type="checkbox" name="block" '+(ticket.user_id===user.id?'disabled':'')+'><span><b>Заблокировать аккаунт</b><small>Оставить участнику только просмотр главной</small></span></label><label><input type="checkbox" name="notify" checked><span><b>Уведомить участника</b><small>Сообщить об аннулировании и возврате</small></span></label><label><input type="checkbox" name="deleteRecord"><span><b>Удалить билет</b><small>Убрать запись из списка после аннулирования</small></span></label></div>')+'<p class="form-message" data-money-error></p><button class="button button-danger" type="submit">'+(deleteOnly?'Удалить запись':'Подтвердить аннулирование')+'</button></form>');
 putAvatar($('#ticketOwnerAvatar'),owner.avatar_url,owner.full_name);
}
function walletTransactionRow(t){return '<div class="wallet-transaction"><div><b>'+esc(t.description)+'</b><small>'+esc(new Date(t.created_at).toLocaleString('ru'))+'</small></div><strong class="'+(Number(t.amount)>0?'wallet-credit':'')+'">'+(Number(t.amount)>0?'+':'−')+esc(money(Math.abs(Number(t.amount))))+'</strong></div>'}
async function openWallet(){
 try{
  const data=await api('/api/wallet');walletOffset=data.transactions.length;
  mountMoneyDialog('walletModal','<p class="eyebrow">ТВОЙ FLOWTIX</p><h2>Баланс</h2><div class="wallet-total">'+esc(walletMoney(data.balance))+'</div><p>Оплачивай любые мероприятия с общего баланса.</p><form id="walletTopupForm" data-key="'+crypto.randomUUID()+'"><label>Сумма пополнения<input name="amount" type="number" min="1" max="1000000" step="0.01" inputmode="decimal" placeholder="Например, 5000" required></label><p class="wallet-mode">'+(data.visualTopups?'Визуальный режим: деньги на карту не списываются. Пополнение отмечается в истории как визуальное.':'Платёжный провайдер пока не подключён. Пополнение временно недоступно.')+'</p><p class="form-message" data-money-error></p><button class="button button-dark" type="submit" '+(data.visualTopups?'':'disabled')+'>Пополнить баланс</button></form><h3>История операций</h3><div id="walletTransactions">'+(data.transactions.map(walletTransactionRow).join('')||'<p>Операций пока нет.</p>')+'</div><button class="button button-light" data-wallet-more '+(data.hasMore?'':'hidden')+'>Ещё 10 операций</button>');
 }catch(error){toast(error.message)}
}

async function adminView() {
  const root=$('#workspaceContent');
  try{
    const loadAdminSection=async(path)=>{try{return await api(path)}catch(error){return {error:error.message}}};
    const [stats,users,logs,events,venues,tickets,payments,complaints,reviews,settings,profileLinks]=await Promise.all([
      loadAdminSection('/api/admin/statistics'),loadAdminSection('/api/admin/users'),loadAdminSection('/api/admin/audit-logs'),loadAdminSection('/api/admin/events'),
      loadAdminSection('/api/admin/venues'),loadAdminSection('/api/admin/tickets'),loadAdminSection('/api/admin/payments'),loadAdminSection('/api/admin/complaints'),
      loadAdminSection('/api/admin/reviews'),loadAdminSection('/api/admin/settings'),loadAdminSection('/api/admin/profile-links?offset=0')
    ]);
    const loadErrors=[stats,users,logs,events,venues,tickets,payments,complaints,reviews,settings,profileLinks].filter(x=>x.error).map(x=>esc(x.error));
    const loadWarning=loadErrors.length?'<div class="connection-state">Часть разделов не загрузилась: '+loadErrors.join(' · ')+'</div>':'';
    const roles={visitor:'Посетитель',organizer:'Организатор',staff:'Сотрудник',moderator:'Модератор'};
    const roleIcons={
      visitor:'<svg class="role-picker-icon" data-role="visitor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
      organizer:'<svg class="role-picker-icon" data-role="organizer" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h6"/></svg>',
      staff:'<svg class="role-picker-icon" data-role="staff" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 19 6v5.5c0 4.3-2.8 7.3-7 9-4.2-1.7-7-4.7-7-9V6l7-2.5Z"/><path d="m9 12 2 2 4-4"/></svg>',
      moderator:'<svg class="role-picker-icon" data-role="moderator" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 19 6v5.5c0 4.3-2.8 7.3-7 9-4.2-1.7-7-4.7-7-9V6l7-2.5Z"/><path d="M9 12h6M12 9v6"/></svg>',
      admin:'<svg class="role-picker-icon" data-role="admin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.1 4.3 4.7.7-3.4 3.3.8 4.7-4.2-2.2-4.2 2.2.8-4.7-3.4-3.3 4.7-.7L12 3Z"/><path d="M5 19h14"/></svg>'
    };
    const rolePicker=(id,current)=>id===user.id
      ?'<span class="role-picker-root">'+roleIcons.admin+'<span>Главный администратор</span></span>'
      :'<div class="role-picker" data-role-picker><button class="role-picker-trigger" type="button" data-role-picker-toggle aria-label="Выбрать роль" aria-haspopup="listbox" aria-expanded="false">'+(roleIcons[current]||roleIcons.visitor)+'<span>'+(roles[current]||'Посетитель')+'</span><svg class="role-picker-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="role-picker-menu" role="listbox" aria-label="Роль пользователя" hidden>'+Object.entries(roles).map(([role,label])=>'<button class="role-picker-option" type="button" role="option" aria-selected="'+(role===current)+'" data-role-picker-option data-role-user="'+esc(id)+'" data-role="'+role+'">'+roleIcons[role]+'<span>'+label+'</span>'+(role===current?'<svg class="role-picker-check" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.3 3 3 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>':'')+'</button>').join('')+'</div></div>';
    const renderAdminUser=x=>'<tr><td><button type="button" class="admin-user-profile-button" data-admin-profile-open="'+esc(x.id)+'"><b>'+esc(x.full_name||'—')+'</b><small>'+esc(x.email)+'</small><em>Открыть профиль ↗</em></button></td><td>'+rolePicker(x.id,x.role)+'</td><td>'+(x.is_blocked?'Заблокирован':'Активен')+'</td><td><div class="inline-actions"><button type="button" class="button button-light button-small" data-admin-profile-open="'+esc(x.id)+'">Профиль</button><button class="button button-light button-small" data-block="'+esc(x.id)+'" data-value="'+(!x.is_blocked)+'" '+(x.id===user.id?'disabled':'')+'>'+(x.is_blocked?'Разблокировать':'Заблокировать')+'</button></div></td></tr>';
    const userRows=(users.users||[]).map(renderAdminUser).join('');
    const renderAdminEvent=x=>'<details class="admin-event-item" data-admin-event-item="'+esc(x.id)+'"><summary><span class="admin-event-summary-title"><b>'+esc(x.title||'Мероприятие')+'</b><small>'+esc(x.users?.email||'Организатор не указан')+'</small></span><time>'+esc(x.start_date||'Дата не указана')+'</time><span class="status-pill">'+esc(eventStatusLabel(x.status))+'</span><span class="admin-event-chevron" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="m5 7.5 5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></summary><div class="admin-event-details"><div><small>Организатор</small><b>'+esc(x.users?.full_name||x.users?.email||'—')+'</b></div><div><small>Площадка</small><b>'+esc([x.venues?.name,x.location_address||x.venues?.address,x.venues?.city].filter(Boolean).join(' · ')||'Не указана')+'</b></div><div><small>Свободные места</small><b>'+esc((x.available_seats??'—')+' / '+(x.total_seats??'—'))+'</b></div><div><small>Стоимость</small><b>'+esc(money(x.base_price))+'</b></div><label class="admin-event-status">Статус<select data-event-status="'+esc(x.id)+'">'+['draft','pending_moderation','published','rejected','cancelled','completed'].map(status=>'<option value="'+status+'" '+(x.status===status?'selected':'')+'>'+esc(eventStatusLabel(status))+'</option>').join('')+'</select></label><button type="button" class="button button-danger button-small" data-delete-event="'+esc(x.id)+'">Удалить мероприятие</button></div></details>';
    const eventRows=(events.events||[]).map(renderAdminEvent).join('');
    const venueRows=(venues.venues||[]).map(v=>'<details class="workspace-row"><summary><b>'+esc(v.name)+'</b> · '+esc(v.city)+'</summary><form data-admin-venue="'+esc(v.id)+'" class="form-grid"><label>Название<input name="name" value="'+esc(v.name)+'" required></label><label>Город<input name="city" value="'+esc(v.city)+'" required></label><label class="wide">Адрес<input name="address" value="'+esc(v.address)+'" required></label><label class="wide">Описание<textarea name="description">'+esc(v.description||'')+'</textarea></label><button class="button button-light button-small">Сохранить</button></form></details>').join('');
    (tickets.tickets||[]).forEach(t=>adminTicketCache.set(t.id,t));
    const renderAdminTicket=t=>'<tr><td>'+esc(t.ticket_number)+'</td><td>'+esc(t.events?.title||'—')+'<br><small>'+esc(t.users?.full_name||t.users?.email||'')+'</small></td><td>'+esc(ticketStatusLabel(t.status))+'</td><td>'+esc(money(t.price_paid))+'</td><td><div class="inline-actions"><button class="button button-danger button-small" '+(['valid','used'].includes(t.status)?'data-cancel-ticket':'data-delete-ticket')+'="'+esc(t.id)+'">'+(['valid','used'].includes(t.status)?'Аннулировать':'Удалить')+'</button>'+(t.status==='used'?'<button class="button button-light button-small" data-delete-ticket="'+esc(t.id)+'">Удалить</button>':'')+'</div></td></tr>';
    let loadedAdminTickets=[...(tickets.tickets||[])];
    const ticketRows=loadedAdminTickets.map(renderAdminTicket).join('');
    const paymentRows=(payments.payments||[]).map(p=>'<tr><td>'+esc(new Date(p.created_at).toLocaleString('ru'))+'</td><td>'+esc(p.users?.email||'—')+'</td><td>'+esc(p.tickets?.events?.title||p.tickets?.ticket_number||'—')+'</td><td>'+esc(money(p.amount))+'</td><td>'+esc(p.status)+' · '+esc(p.payment_method||'—')+'</td></tr>').join('');
    const complaintRows=(complaints.complaints||[]).map(complaintCardMarkup).join('')||empty('Жалоб пока нет.');    const reviewRows=(reviews.reviews||[]).map(x=>'<tr><td>'+esc(x.events?.title||'—')+'</td><td>'+esc(x.users?.email||'—')+'</td><td>'+esc(x.overall_rating)+'/5</td><td>'+esc(x.comment||'')+'</td><td><button class="button button-danger button-small" data-delete-review="'+esc(x.id)+'">Удалить</button></td></tr>').join('');
    const s=settings.settings||{};
    const visualPaymentsEnabled=s.visual_payments_enabled===true;
    const settingsForm='<form id="adminSettingsForm" class="form-grid"><label>Название сервиса<input name="site_name" value="'+esc(s.site_name||'FlowTix')+'" required></label><label>Почта поддержки<input name="support_email" type="email" value="'+esc(s.support_email||'')+'"></label><label>Режим обслуживания<select name="maintenance_mode"><option value="false" '+(s.maintenance_mode?'':'selected')+'>Выключен</option><option value="true" '+(s.maintenance_mode?'selected':'')+'>Включён</option></select></label><div class="wide visual-payment-option"><label class="admin-switch"><input type="checkbox" name="visual_payments_enabled" '+(visualPaymentsEnabled?'checked':'')+'><span class="admin-switch-track" aria-hidden="true"></span><span class="admin-switch-copy"><b>Активировать визуальные пополнения баланса</b><small>Пополнение общего баланса без списания денег. Покупка билета списывает его стоимость с баланса.</small></span></label><p class="payment-provider-note">Если выключить режим, пополнение недоступно до подключения провайдера. Уже имеющийся баланс можно тратить на билеты.</p></div><div class="wide"><button class="button button-accent" type="submit">Сохранить настройки</button></div></form>';
    const auditActionLabels={PROFILE_LINK_SUBMITTED:'Ссылка профиля отправлена на модерацию',PROFILE_LINK_APPROVED:'Ссылка профиля подтверждена',PROFILE_LINK_REJECTED:'Ссылка профиля отклонена',PROFILE_LINK_EDITED:'Отредактирована ссылка профиля',ADMIN_PROFILE_LINK_ADDED:'Администратор добавил ссылку в профиль',ADMIN_PROFILE_LINK_DELETED:'Администратор удалил ссылку из профиля',ADMIN_PROFILE_UPDATED:'Администратор изменил профиль пользователя',ADMIN_WALLET_ADJUSTED:'Администратор изменил баланс',CHAT_REQUEST_ACCEPTED:'Запрос на личный чат принят',CHAT_REQUEST_DECLINED:'Запрос на личный чат отклонён',USER_BLOCKED_BY_USER:'Пользователь добавлен в блокировку',REGISTER_FOR_EVENT:'Регистрация на мероприятие',ADMIN_TICKET_CANCELLED:'Билет аннулирован',ADMIN_TICKET_DELETED:'Билет удалён',USER_ROLE_CHANGED:'Изменена роль пользователя',USER_BLOCKED:'Аккаунт заблокирован',USER_UNBLOCKED:'Аккаунт разблокирован',ADMIN_SETTINGS_UPDATED:'Изменены настройки системы',ADMIN_EVENT_STATUS_CHANGED:'Изменён статус мероприятия',STAFF_TICKET_CHECKED_IN:'Билет проверен на входе',TICKET_AUTO_DELETED:'Использованный билет удалён автоматически',COMPLAINT_STATUS_CHANGED:'Изменён статус жалобы'};
    const auditRoleLabels={visitor:'Посетитель',organizer:'Организатор',staff:'Сотрудник',moderator:'Модератор',admin:'Администратор'};
    const auditDetail=(x)=>{
      if(x.detail_label)return x.detail_label;
      const d=x.details||{};
      if(x.action==='COMPLAINT_STATUS_CHANGED')return 'Новый статус: '+complaintStatusLabel(d.to);
      if(x.action==='REGISTER_FOR_EVENT')return [d.event_title,d.amount!=null?(Number(d.amount)>0?'Оплачено '+money(d.amount):'Бесплатно'):''].filter(Boolean).join(' · ');
      if(x.action==='USER_ROLE_CHANGED')return d.role?'Новая роль: '+(auditRoleLabels[d.role]||d.role):'';
      if(x.action==='USER_BLOCKED'||x.action==='USER_UNBLOCKED')return d.email||'';
      if(x.action==='ADMIN_EVENT_STATUS_CHANGED')return d.status?'Статус: '+eventStatusLabel(d.status):'';
      if(x.action==='ADMIN_SETTINGS_UPDATED'){
        const names={site_name:'Название сайта',support_email:'Почта поддержки',maintenance_mode:'Режим обслуживания',visual_payments_enabled:'Визуальные платежи'};
        return Object.keys(d).map(k=>names[k]).filter(Boolean).map(k=>k+': изменено').join(' · ');
      }
      return '';
    };
    const renderAuditRow=(x)=>'<tr><td>'+esc(new Date(x.created_at).toLocaleString('ru'))+'</td><td>'+esc(x.actor_name||'Система')+'</td><td>'+esc(auditActionLabels[x.action]||'Действие в системе')+'</td><td>'+esc([x.entity_label,auditDetail(x)].filter(Boolean).join(' · ')||'—')+'</td></tr>';
    const logsHtml=(logs.logs||[]).map(renderAuditRow).join('');
    const renderProfileLink=x=>'<article class="moderation-link-card" data-profile-link-item="'+esc(x.id)+'"><span class="profile-avatar">'+(x.users?.avatar_url?'<img src="'+esc(x.users.avatar_url)+'" alt="">':esc((x.users?.full_name||'F')[0]))+'</span><div class="moderation-link-user"><b>'+esc(x.users?.full_name||x.users?.username||'Пользователь')+'</b><small>@'+esc(x.users?.username||'—')+' · '+esc(({visitor:'Посетитель',organizer:'Организатор',staff:'Сотрудник',moderator:'Модератор',admin:'Администратор'})[x.users?.role]||'Пользователь')+'</small></div><a href="'+esc(x.url)+'" target="_blank" rel="noopener noreferrer">'+profileLinkIcon(x.platform)+'<span>'+esc(x.url)+'</span></a><span class="link-status status-'+esc(x.status)+'">'+({pending:'На модерации',approved:'Подтверждена',rejected:'Отклонена'}[x.status]||x.status)+'</span>'+(x.status==='pending'?'<button class="button button-accent button-small" data-profile-link-decision="approved" data-link-id="'+esc(x.id)+'">Одобрить</button><button class="button button-danger button-small" data-profile-link-decision="rejected" data-link-id="'+esc(x.id)+'">Отклонить</button>':'')+'</article>';
    let moderationLinksStatus='pending',moderationLinksOffset=(profileLinks.links||[]).length,moderationLinksHasMore=Boolean(profileLinks.hasMore),moderationLinksLoading=false,moderationLinksObserver=null;
    const renderModerationLinksPanel=()=>'<div class="workspace-card"><div class="profile-links-head"><div><h3>Модерация ссылок профиля</h3><p>Проверяй адрес перед публикацией. Одобренные ссылки видны на публичной карточке пользователя.</p></div></div><div class="admin-link-status-tabs">'+[['pending','На модерации'],['approved','Подтверждены'],['rejected','Отклонены']].map(([v,l])=>'<button type="button" class="category '+(v===moderationLinksStatus?'active':'')+'" data-profile-link-filter="'+v+'">'+l+'</button>').join('')+'</div><div id="moderationLinksList">'+((profileLinks.links||[]).map(renderProfileLink).join('')||empty('В этой категории пока нет ссылок.'))+'</div><button id="moderationLinksMore" type="button" class="button button-light button-small" '+(moderationLinksHasMore?'':'hidden')+'>Загрузить ещё 10</button></div>';
    const loadModerationLinks=async(reset=false)=>{
      if(moderationLinksLoading)return;moderationLinksLoading=true;
      try{
       if(reset){moderationLinksOffset=0;moderationLinksHasMore=true;$('#moderationLinksList',panel).innerHTML='<div class="chat-loading">Загружаем ссылки…</div>'}
       const result=await api('/api/admin/profile-links?status='+moderationLinksStatus+'&offset='+moderationLinksOffset);
       const list=$('#moderationLinksList',panel);if(!list)return;
       const rows=(result.links||[]).map(renderProfileLink).join('');
       if(reset)list.innerHTML=rows||empty('В этой категории пока нет ссылок.');else list.insertAdjacentHTML('beforeend',rows);
       moderationLinksOffset+=(result.links||[]).length;moderationLinksHasMore=Boolean(result.hasMore);
       const more=$('#moderationLinksMore',panel);if(more)more.hidden=!moderationLinksHasMore;
       observeModerationLinks();
      }catch(error){toast(error.message)}finally{moderationLinksLoading=false}
    };
    const observeModerationLinks=()=>{moderationLinksObserver?.disconnect();const button=$('#moderationLinksMore',panel);if(!button||button.hidden||!moderationLinksHasMore)return;if('IntersectionObserver'in window){moderationLinksObserver=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting))void loadModerationLinks()},{rootMargin:'180px'});moderationLinksObserver.observe(button)}};
    const panels={
      links:renderModerationLinksPanel(),
      users:'<div class="workspace-card"><h3>Пользователи и роли</h3><p>Роли назначает только главный администратор.</p><div class="scroll-table"><table class="data-table"><thead><tr><th>Участник</th><th>Роль</th><th>Доступ</th><th></th></tr></thead><tbody id="adminUserRows">'+userRows+'</tbody></table></div><button id="adminUserLoadMore" type="button" class="button button-light button-small '+(users.hasMore?'':'is-hidden')+'" '+(users.hasMore?'':'hidden')+'>Загрузить ещё 10</button><p id="adminUserEnd" class="admin-event-end '+(users.hasMore?'is-hidden':'')+'">'+((users.users||[]).length?'Показаны все пользователи.':'Пользователей пока нет.')+'</p></div>',
      events:'<div class="workspace-card"><h3>Мероприятия</h3><p class="workspace-help">Сначала загружаются 10 последних. Листай ниже, чтобы увидеть следующие. Удаление убирает событие из активного списка и сохраняет историю билетов и отзывов.</p><div id="adminEventList" class="admin-event-list">'+(events.error?'<p class="connection-state">'+esc(events.error)+'</p>':eventRows||empty('Активных мероприятий пока нет.'))+'</div><button id="adminEventLoadMore" type="button" class="button button-light button-small '+(events.hasMore?'':'is-hidden')+'">Загрузить ещё 10</button><p id="adminEventEnd" class="admin-event-end '+(events.hasMore?'is-hidden':'')+'">'+((events.events||[]).length?'Показаны все мероприятия.':'')+'</p></div>',
      venues:'<div class="workspace-card"><h3>Площадки</h3>'+(venueRows||empty('Площадок пока нет.'))+'</div>',
      tickets:'<div class="workspace-card"><h3>Билеты</h3>'+(tickets.error?'<p class="connection-state">'+esc(tickets.error)+'</p>':'<div class="scroll-table"><table class="data-table"><thead><tr><th>Номер</th><th>Событие / владелец</th><th>Статус</th><th>Цена</th><th></th></tr></thead><tbody id="adminTicketRows">'+ticketRows+'</tbody></table></div><button type="button" id="adminTicketLoadMore" class="button button-light" '+(tickets.hasMore?'':'hidden')+'>Загрузить ещё 10</button>')+'</div>',
      payments:'<div class="workspace-card"><h3>Платежи</h3><p>Платёжные записи для сверки. Статус не меняется вручную без платёжного провайдера.</p><div class="scroll-table"><table class="data-table"><thead><tr><th>Дата</th><th>Аккаунт</th><th>Билет</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>'+paymentRows+'</tbody></table></div></div>',
      complaints:'<div class="workspace-card"><h3>Жалобы</h3><p class="workspace-help">Новые жалобы можно взять в работу. После решения они удаляются из очереди; автор получит уведомление.</p><div class="complaint-review-list" data-complaint-list>'+complaintRows+'</div></div>',
      reviews:'<div class="workspace-card"><h3>Отзывы</h3><div class="scroll-table"><table class="data-table"><thead><tr><th>Событие</th><th>Автор</th><th>Оценка</th><th>Текст</th><th></th></tr></thead><tbody>'+reviewRows+'</tbody></table></div></div>',
      settings:'<div class="workspace-card"><h3>Настройки системы</h3>'+settingsForm+'</div>',
      logs:'<div class="workspace-card"><h3>Журнал действий</h3><p class="workspace-help">Последние действия. Прокручивай вниз — следующие записи загрузятся автоматически.</p><div class="scroll-table"><table class="data-table"><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Подробности</th></tr></thead><tbody id="adminAuditRows">'+logsHtml+'</tbody></table></div><button id="adminAuditLoadMore" type="button" class="button button-light button-small '+(logs.hasMore?'':'is-hidden')+'" '+(logs.hasMore?'':'hidden')+'>Загрузить ещё 10</button><p id="adminAuditEnd" class="admin-event-end '+(logs.hasMore?'is-hidden':'')+'">'+((logs.logs||[]).length?'Показаны все записи.':'Записей пока нет.')+'</p></div>'
    };
    const tabs=Object.entries({users:'Аккаунты',events:'Мероприятия',venues:'Площадки',tickets:'Билеты',payments:'Платежи',complaints:'Жалобы',reviews:'Отзывы',links:'Ссылки профиля',settings:'Настройки',logs:'Журнал'});
    root.innerHTML=loadWarning+'<div class="stats-grid">'+[['Пользователи',stats.users??'—'],['Мероприятия',stats.events??'—'],['Билеты',stats.tickets??'—'],['Выручка',stats.error?'—':money(stats.revenue)],['Открытые жалобы',stats.openComplaints??'—']].map(x=>'<div class="workspace-card"><small>'+esc(x[0])+'</small><h3>'+esc(x[1])+'</h3></div>').join('')+'</div><div id="adminTabs" class="category-bar">'+tabs.map(([key,label],i)=>'<button type="button" class="category '+(key===adminSelectedTab?'active':'')+'" data-admin-tab="'+key+'">'+label+'</button>').join('')+'</div><div id="adminPanel">'+(panels[adminSelectedTab]||panels.users)+'</div>';
    const panel=$('#adminPanel',root);
    let ticketOffset=loadedAdminTickets.length,ticketHasMore=Boolean(tickets.hasMore),ticketLoading=false,ticketObserver=null;
    const loadMoreTickets=async()=>{
      if(ticketLoading||!ticketHasMore)return;ticketLoading=true;
      const button=panel.querySelector('#adminTicketLoadMore');if(button)button.disabled=true;
      try{const data=await api('/api/admin/tickets?offset='+ticketOffset);(data.tickets||[]).forEach(t=>adminTicketCache.set(t.id,t));loadedAdminTickets.push(...(data.tickets||[]));ticketOffset+=data.tickets.length;ticketHasMore=Boolean(data.hasMore);panel.querySelector('#adminTicketRows')?.insertAdjacentHTML('beforeend',data.tickets.map(renderAdminTicket).join(''));if(button)button.hidden=!ticketHasMore}catch(error){toast(error.message)}finally{ticketLoading=false;if(button)button.disabled=false;observeAdminTicketFeed()}
    };
    const observeAdminTicketFeed=()=>{ticketObserver?.disconnect();const button=panel.querySelector('#adminTicketLoadMore');if(!button||button.hidden||!ticketHasMore)return;if('IntersectionObserver' in window){ticketObserver=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting))void loadMoreTickets()},{rootMargin:'150px'});ticketObserver.observe(button)}};

    let adminUsersOffset=(users.users||[]).length;
    let adminUsersHasMore=Boolean(users.hasMore);
    let adminUsersLoading=false;
    let adminUsersObserver=null;
    const loadMoreAdminUsers=async()=>{
      if(adminUsersLoading||!adminUsersHasMore||!panel.querySelector('#adminUserRows'))return;
      adminUsersLoading=true;
      const button=panel.querySelector('#adminUserLoadMore');
      if(button){button.disabled=true;button.textContent='Загружаем…'}
      try{
        const result=await api('/api/admin/users?offset='+adminUsersOffset);
        const list=panel.querySelector('#adminUserRows');
        if(!list)return;
        if(result.users?.length){list.insertAdjacentHTML('beforeend',result.users.map(renderAdminUser).join(''));adminUsersOffset+=result.users.length}
        adminUsersHasMore=Boolean(result.hasMore);
        if(button){button.hidden=!adminUsersHasMore;button.classList.toggle('is-hidden',!adminUsersHasMore);button.disabled=false;button.textContent='Загрузить ещё 10'}
        const end=panel.querySelector('#adminUserEnd');
        if(end){end.hidden=adminUsersHasMore;end.classList.toggle('is-hidden',adminUsersHasMore);end.textContent='Показаны все пользователи.'}
        observeAdminUserFeed();
      }catch(error){toast(error.message);if(button){button.disabled=false;button.textContent='Повторить загрузку'}}
      finally{adminUsersLoading=false}
    };
    const observeAdminUserFeed=()=>{
      adminUsersObserver?.disconnect();
      const button=panel.querySelector('#adminUserLoadMore');
      if(!button||button.hidden||!adminUsersHasMore)return;
      if('IntersectionObserver' in window){adminUsersObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadMoreAdminUsers()},{rootMargin:'220px'});adminUsersObserver.observe(button)}
    };
    let adminAuditOffset=(logs.logs||[]).length,adminAuditHasMore=Boolean(logs.hasMore),adminAuditLoading=false,adminAuditObserver=null;
    const loadMoreAdminAudit=async()=>{
      if(adminAuditLoading||!adminAuditHasMore||!panel.querySelector('#adminAuditRows'))return;
      adminAuditLoading=true;const button=panel.querySelector('#adminAuditLoadMore');
      if(button){button.disabled=true;button.textContent='Загружаем…'}
      try{
        const result=await api('/api/admin/audit-logs?offset='+adminAuditOffset);
        const rows=panel.querySelector('#adminAuditRows');if(!rows)return;
        if(result.logs?.length){rows.insertAdjacentHTML('beforeend',result.logs.map(renderAuditRow).join(''));adminAuditOffset+=result.logs.length}
        adminAuditHasMore=Boolean(result.hasMore);
        if(button){button.hidden=!adminAuditHasMore;button.disabled=false;button.textContent='Загрузить ещё 10'}
        const end=panel.querySelector('#adminAuditEnd');if(end){end.hidden=adminAuditHasMore;end.textContent='Показаны все записи.'}
        observeAdminAuditFeed();
      }catch(error){toast(error.message);if(button){button.disabled=false;button.textContent='Повторить загрузку'}}
      finally{adminAuditLoading=false}
    };
    const observeAdminAuditFeed=()=>{
      adminAuditObserver?.disconnect();
      const button=panel.querySelector('#adminAuditLoadMore');
      if(!button||button.hidden||!adminAuditHasMore)return;
      if('IntersectionObserver' in window){adminAuditObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadMoreAdminAudit()},{rootMargin:'220px'});adminAuditObserver.observe(button)}
    };
    let adminEventsOffset=(events.events||[]).length;
    let adminEventsHasMore=Boolean(events.hasMore);
    let adminEventsLoading=false;
    let adminEventsObserver=null;
    const loadMoreAdminEvents=async()=>{
      if(adminEventsLoading||!adminEventsHasMore||!panel.querySelector('#adminEventList'))return;
      adminEventsLoading=true;
      const button=panel.querySelector('#adminEventLoadMore');
      if(button){button.disabled=true;button.textContent='Загружаем…'}
      try{
        const result=await api('/api/admin/events?offset='+adminEventsOffset);
        const list=panel.querySelector('#adminEventList');
        if(!list)return;
        if(result.events?.length){list.insertAdjacentHTML('beforeend',result.events.map(renderAdminEvent).join(''));adminEventsOffset+=result.events.length}
        adminEventsHasMore=Boolean(result.hasMore);
        if(button){button.hidden=!adminEventsHasMore;button.disabled=false;button.textContent='Загрузить ещё 10'}
        const end=panel.querySelector('#adminEventEnd');
        if(end){end.hidden=adminEventsHasMore;end.textContent='Показаны все мероприятия.'}
        observeAdminEventFeed();
      }catch(error){toast(error.message);if(button){button.disabled=false;button.textContent='Повторить загрузку'}}
      finally{adminEventsLoading=false}
    };
    const observeAdminEventFeed=()=>{
      adminEventsObserver?.disconnect();
      const button=panel.querySelector('#adminEventLoadMore');
      if(!button||button.hidden||!adminEventsHasMore)return;
      if('IntersectionObserver' in window){adminEventsObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadMoreAdminEvents()},{rootMargin:'220px'});adminEventsObserver.observe(button)}
    };

    observeAdminUserFeed();
    observeAdminTicketFeed();
    if(adminSelectedTab==='logs')observeAdminAuditFeed();
    if(adminSelectedTab==='links')observeModerationLinks();
    root.onchange=async(e)=>{
      if(e.target.matches('[data-event-status]')){try{await api('/api/admin/events/'+e.target.dataset.eventStatus,{method:'PATCH',body:JSON.stringify({status:e.target.value})});toast('Статус мероприятия обновлён');const item=e.target.closest('[data-admin-event-item]');const pill=item?.querySelector('summary .status-pill');if(pill)pill.textContent=eventStatusLabel(e.target.value);if(e.target.value==='cancelled'){item?.remove();adminEventsOffset=Math.max(0,adminEventsOffset-1)}}catch(x){toast(x.message);await adminView()}}
        };
    root.onclick=async(e)=>{
      const tab=e.target.closest('[data-admin-tab]');
      if(tab){adminSelectedTab=tab.dataset.adminTab;$$('[data-admin-tab]',root).forEach(x=>x.classList.toggle('active',x===tab));panel.innerHTML=panels[tab.dataset.adminTab]||'';if(tab.dataset.adminTab==='events')observeAdminEventFeed();if(tab.dataset.adminTab==='users')observeAdminUserFeed();if(tab.dataset.adminTab==='logs')observeAdminAuditFeed();if(tab.dataset.adminTab==='links')observeModerationLinks();if(tab.dataset.adminTab==='tickets'){const rows=panel.querySelector('#adminTicketRows'),more=panel.querySelector('#adminTicketLoadMore');if(rows)rows.innerHTML=loadedAdminTickets.map(renderAdminTicket).join('');if(more)more.hidden=!ticketHasMore;observeAdminTicketFeed()}return}
      if(e.target.closest('#adminTicketLoadMore')){await loadMoreTickets();return}
      if(e.target.closest('#adminUserLoadMore')){await loadMoreAdminUsers();observeAdminUserFeed();return}
      if(e.target.closest('#adminEventLoadMore')){await loadMoreAdminEvents();observeAdminEventFeed();return}
      if(e.target.closest('#adminAuditLoadMore')){await loadMoreAdminAudit();return}
      if(e.target.closest('#moderationLinksMore')){await loadModerationLinks();return}
      const linkFilter=e.target.closest('[data-profile-link-filter]');if(linkFilter){moderationLinksStatus=linkFilter.dataset.profileLinkFilter;$('[data-profile-link-filter]',panel).forEach(x=>x.classList.toggle('active',x===linkFilter));await loadModerationLinks(true);return}
      const linkDecision=e.target.closest('[data-profile-link-decision]');if(linkDecision){try{await api('/api/admin/profile-links/'+encodeURIComponent(linkDecision.dataset.linkId),{method:'PATCH',body:JSON.stringify({status:linkDecision.dataset.profileLinkDecision})});toast(linkDecision.dataset.profileLinkDecision==='approved'?'Ссылка одобрена':'Ссылка отклонена');await loadModerationLinks(true)}catch(error){toast(error.message)}return}
      const profileOpen=e.target.closest('[data-admin-profile-open]');if(profileOpen){void openAdminUserProfile(profileOpen.dataset.adminProfileOpen);return}
      const deleteEvent=e.target.closest('[data-delete-event]');
      if(deleteEvent){
        if(!confirm('Убрать мероприятие из активной системы? Билеты и отзывы сохранятся в истории.'))return;
        try{
          await api('/api/admin/events/'+encodeURIComponent(deleteEvent.dataset.deleteEvent),{method:'DELETE'});
          deleteEvent.closest('[data-admin-event-item]')?.remove();
          adminEventsOffset=Math.max(0,adminEventsOffset-1);
          toast('Мероприятие убрано из активного списка; история сохранена');
          if(!panel.querySelector('[data-admin-event-item]')&&!adminEventsHasMore)panel.querySelector('#adminEventList').innerHTML=empty('Активных мероприятий пока нет.');
        }catch(error){toast(error.message)}
        return
      }
      const toggle=e.target.closest('[data-role-picker-toggle]');
      if(toggle){const picker=toggle.closest('[data-role-picker]');const open=!picker.classList.contains('is-open');root.querySelectorAll('.role-picker.is-open').forEach(closeAdminRolePicker);if(open){picker.classList.add('is-open');toggle.setAttribute('aria-expanded','true');positionAdminRolePicker(picker)}return}
      const roleOption=e.target.closest('[data-role-picker-option]');
      if(roleOption){const picker=roleOption.closest('[data-role-picker]');closeAdminRolePicker(picker);try{await api('/api/admin/users/'+roleOption.dataset.roleUser+'/role',{method:'PATCH',body:JSON.stringify({role:roleOption.dataset.role})});toast('Роль обновлена');await adminView()}catch(x){toast(x.message);await adminView()}return}
      if(!e.target.closest('[data-role-picker]'))root.querySelectorAll('.role-picker.is-open').forEach(x=>{x.classList.remove('is-open');x.querySelector('[data-role-picker-toggle]')?.setAttribute('aria-expanded','false');x.querySelector('.role-picker-menu').hidden=true});
      const block=e.target.closest('[data-block]');if(block){try{await api('/api/admin/users/'+block.dataset.block+'/block',{method:'PATCH',body:JSON.stringify({blocked:block.dataset.value==='true'})});toast('Доступ обновлён');await adminView()}catch(x){toast(x.message)}return}
      const cancel=e.target.closest('[data-cancel-ticket]');if(cancel){const ticket=adminTicketCache.get(cancel.dataset.cancelTicket);if(ticket)openTicketAction(ticket);return}
      const delTicket=e.target.closest('[data-delete-ticket]');if(delTicket){const ticket=adminTicketCache.get(delTicket.dataset.deleteTicket);if(ticket)openTicketAction(ticket,true);return}
      const review=e.target.closest('[data-delete-review]');if(review&&confirm('Удалить отзыв?')){try{await api('/api/admin/reviews/'+review.dataset.deleteReview,{method:'DELETE'});toast('Отзыв удалён');await adminView()}catch(x){toast(x.message)}}
    };
    root.onsubmit=async(e)=>{
      if(e.target.matches('[data-admin-venue]')){e.preventDefault();try{await api('/api/admin/venues/'+e.target.dataset.adminVenue,{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Площадка обновлена');await adminView()}catch(x){toast(x.message)}}
      if(e.target.id==='adminProfileLinkForm'){e.preventDefault();const form=e.target;try{await api('/api/admin/users/'+encodeURIComponent(form.dataset.userId)+'/profile-links',{method:'POST',body:JSON.stringify({url:form.elements.url.value})});toast('Ссылка добавлена и опубликована');await openAdminUserProfile(form.dataset.userId)}catch(error){toast(error.message)}return}
  if(e.target.id==='adminUserProfileForm'){e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;try{const payload=Object.fromEntries(new FormData(form));const file=$('#adminAvatarFile',form).files?.[0];if(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw new Error('Аватар: PNG, JPG или WebP до 2 МБ');payload.avatarData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file)})}await api('/api/admin/users/'+form.dataset.userId+'/profile',{method:'PATCH',body:JSON.stringify(payload)});toast('Профиль пользователя сохранён');await openAdminUserProfile(form.dataset.userId)}catch(error){toast(error.message)}finally{button.disabled=false}}
      if(e.target.id==='adminBalanceForm'){e.preventDefault();const form=e.target;try{const result=await api('/api/admin/users/'+form.dataset.userId+'/balance-adjustments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});toast('Баланс обновлён: '+walletMoney(result.balance));await openAdminUserProfile(form.dataset.userId)}catch(error){toast(error.message)}}
      if(e.target.id==='adminSettingsForm'){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.maintenance_mode=data.maintenance_mode==='true';data.visual_payments_enabled=e.target.elements.visual_payments_enabled.checked;try{await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify(data)});toast('Настройки сохранены');await adminView()}catch(x){toast(x.message)}}
    };
  }catch(error){root.innerHTML='<div class="workspace-card"><p class="connection-state">'+esc(error.message)+'</p></div>'}
}
document.addEventListener('click',async(e)=>{
  const moneyClose=e.target.closest('[data-money-close]');if(moneyClose){closeMoneyDialog(moneyClose.dataset.moneyClose);return}
  if(e.target.classList.contains('money-overlay')){closeMoneyDialog(e.target.id);return}
  if(e.target.closest('[data-open-wallet]')){$('#profileDropdown').hidden=true;await openWallet();return}
  const walletMore=e.target.closest('[data-wallet-more]');
  if(walletMore){walletMore.disabled=true;try{const data=await api('/api/wallet?offset='+walletOffset);walletOffset+=data.transactions.length;$('#walletTransactions').insertAdjacentHTML('beforeend',data.transactions.map(walletTransactionRow).join(''));walletMore.hidden=!data.hasMore}catch(error){toast(error.message)}finally{walletMore.disabled=false}return}

  if(e.target.closest('[data-blocked-dismiss]')){hideBlockedAccountModal();return}
  if(e.target.closest('[data-blocked-logout]')){hideBlockedAccountModal();await logoutAccount();authOpen('login');return}
  if(e.target.id==='blockedAccountOverlay'){hideBlockedAccountModal();return}
  if(e.target.id==='eventModal'){setEventModalOpen(false);return}
  const period=e.target.closest('[data-period]');
  if(period){const today=new Date();selectedCalendarDate=localDateKey(period.dataset.period==='tomorrow'?shiftDate(today,1):today);calendarMonthDate=new Date(dateFromKey(selectedCalendarDate).getFullYear(),dateFromKey(selectedCalendarDate).getMonth(),1);renderCalendar(currentFilteredEvents);$('#calendarEvents').scrollIntoView({behavior:'smooth',block:'center'});return}
  const calendarDay=e.target.closest('[data-calendar-date]');
  if(calendarDay){selectedCalendarDate=calendarDay.dataset.calendarDate;const selected=dateFromKey(selectedCalendarDate);calendarMonthDate=new Date(selected.getFullYear(),selected.getMonth(),1);renderCalendar(currentFilteredEvents);return}
  const calendarShift=e.target.closest('[data-calendar-shift]');
  if(calendarShift){calendarMonthDate=new Date(calendarMonthDate.getFullYear(),calendarMonthDate.getMonth()+Number(calendarShift.dataset.calendarShift),1);selectedCalendarDate=localDateKey(calendarMonthDate);renderCalendar(currentFilteredEvents);return}
  const mapEvent=e.target.closest('[data-map-event]');
  if(mapEvent){renderMap(currentFilteredEvents,mapEvent.dataset.mapEvent);return}
  const deleteProgram=e.target.closest('[data-program-delete]');if(deleteProgram){const eventItem=deleteProgram.closest('.organizer-event-item'),eventId=eventItem?.querySelector('[data-event-edit]')?.dataset.eventEdit;if(!eventId)return;try{await api('/api/events/'+eventId+'/program/'+deleteProgram.dataset.programDelete,{method:'DELETE'});toast('Пункт программы удалён');await organizerView()}catch(x){toast(x.message)}return}
  const addProgram=e.target.closest('[data-add-program-item]');if(addProgram){const list=$('#eventProgramList');list.append(createProgramDraftItem(addProgram.dataset.addProgramItem||'activity'));list.lastElementChild.scrollIntoView({behavior:'smooth',block:'nearest'});return}
  const addChild=e.target.closest('[data-add-program-child]');if(addChild){const section=addChild.closest('[data-program-item]'),list=section?.querySelector('[data-program-children]');if(!list)return;list.append(createProgramDraftItem('activity',true));list.lastElementChild.scrollIntoView({behavior:'smooth',block:'nearest'});return}
  const removeProgram=e.target.closest('[data-remove-program-item]');if(removeProgram){removeProgram.closest('[data-program-item]')?.remove();return}
  const profileToggle=e.target.closest('#profileMenuToggle');
  if(profileToggle){
    const menu=$('#profileDropdown');
    menu.hidden=!menu.hidden;
    profileToggle.setAttribute('aria-expanded',String(!menu.hidden));
    return;
  }
  const accountAction=e.target.closest('[data-account-action]');
  if(accountAction){
    $('#profileDropdown').hidden=true;$('#profileMenuToggle').setAttribute('aria-expanded','false');
    if(accountAction.dataset.accountAction==='profile')return window.location.assign('/profile/');
    if(accountAction.dataset.accountAction==='workspace')return window.location.assign('/dashboard/');
    if(accountAction.dataset.accountAction==='notifications')return window.location.assign('/notifications/');
    if(accountAction.dataset.accountAction==='messages')return window.location.assign('/messages/');
    if(accountAction.dataset.accountAction==='admin')return window.location.assign('/admin/');
    if(accountAction.dataset.accountAction==='logout')return logoutAccount();
  }
  if(!e.target.closest('#profileMenuWrap')){$('#profileDropdown').hidden=true;$('#profileMenuToggle').setAttribute('aria-expanded','false')}
  const authTab=e.target.closest('.auth-tabs [data-auth]');
  if(authTab){setAuthMode(authTab.dataset.auth);return}
  const themeTrigger=e.target.closest('[data-theme-select-button]');
  if(themeTrigger){
    const menu=themeTrigger.parentElement.querySelector('[data-theme-menu]');
    menu.hidden=!menu.hidden;
    themeTrigger.setAttribute('aria-expanded',String(!menu.hidden));
    return;
  }
  const themeOption=e.target.closest('[data-theme-option]');
  if(themeOption){
    applyTheme(themeOption.dataset.themeOption);
    const menu=themeOption.closest('[data-theme-menu]');
    menu.hidden=true;
    menu.parentElement.querySelector('[data-theme-select-button]').setAttribute('aria-expanded','false');
    return;
  }
  if(!e.target.closest('.theme-picker'))$$('[data-theme-menu]').forEach((menu)=>{
    menu.hidden=true;
    menu.parentElement.querySelector('[data-theme-select-button]')?.setAttribute('aria-expanded','false');
  });
  const fav=e.target.closest('[data-favorite]');if(fav)return toggleFavorite(fav.dataset.favorite);
  const detail=e.target.closest('[data-details]');if(detail)return openEvent(detail.dataset.details);
  const organizerPreview=e.target.closest('[data-organizer-preview]');if(organizerPreview)return openOrganizerPreview(organizerPreview.dataset.organizerPreview);
  if(e.target.closest('[data-preview-create-event]'))return previewNewEvent($('#createEventForm'));
  const seatPick=e.target.closest('[data-seat-id]');if(seatPick){if(!seatPick.disabled)await reserveSelectedSeat(seatPick.dataset.seatId);return}
  const confirmSeat=e.target.closest('[data-confirm-seat]');if(confirmSeat&&selectedSeatId)return completeRegistration(seatPickerEventId,selectedSeatId);
  const reg=e.target.closest('[data-register]');if(reg)return register(reg.dataset.register);
  const close=e.target.closest('[data-close]');if(close){if(close.dataset.close==='eventModal')setEventModalOpen(false);else $('#'+close.dataset.close).hidden=true;return}
  const report=e.target.closest('[data-report]');if(report){$('#reportForm').innerHTML='<form id="complaintForm" class="form-grid"><input type="hidden" name="targetId" value="'+esc(report.dataset.report)+'"><label>Причина<input name="reason" required></label><label class="wide">Подробности<textarea name="details" required></textarea></label><button class="button button-dark">Отправить жалобу</button></form>';return}
  const moderate=e.target.closest('[data-moderate]');if(moderate){try{await api('/api/moderation/events/'+moderate.dataset.moderate,{method:'PATCH',body:JSON.stringify({status:moderate.dataset.status})});toast('Решение сохранено');moderatorView()}catch(x){toast(x.message)}return}
  const modBlock=e.target.closest('[data-mod-user-block]');if(modBlock){try{await api('/api/moderation/users/'+modBlock.dataset.modUserBlock+'/block',{method:'PATCH',body:JSON.stringify({blocked:modBlock.dataset.value==='true'})});toast('Статус аккаунта обновлён');moderatorView()}catch(x){toast(x.message)}return}
  const modReview=e.target.closest('[data-mod-review]');if(modReview&&confirm('Удалить этот отзыв?')){try{await api('/api/moderation/reviews/'+modReview.dataset.modReview,{method:'DELETE'});toast('Отзыв удалён');moderatorView()}catch(x){toast(x.message)}return}
});
document.addEventListener('change',async(e)=>{
  if(e.target.matches('#reviewForm input[name="rating"]')){
    const rating=Number(e.target.value);
    e.target.closest('.review-star-options')?.querySelectorAll('[data-review-star]').forEach(label=>label.classList.toggle('is-filled',Number(label.dataset.reviewStar)<=rating));
  }
  if(e.target.id==='avatarInput')return uploadProfileAvatar(e.target);
  if(e.target.matches('[data-venue-select]')){
    const address=e.target.selectedOptions[0]?.dataset.address||'', field=e.target.form?.querySelector('[data-event-address]');
    if(field&&address)field.value=address;
    const hallSelect=e.target.form?.querySelector('[data-hall-select]');
    if(hallSelect){
      const venueId=e.target.value;
      for(const option of hallSelect.options){if(!option.value)continue;option.hidden=Boolean(venueId&&option.dataset.venueId!==venueId)}
      if(hallSelect.selectedOptions[0]?.hidden)hallSelect.value='';
    }
  }
  if(e.target.id==='eventCoverInput'||e.target.matches('[data-event-cover-file]')){
    const file=e.target.files?.[0];if(!file)return;
    if(!/^image\/(?:jpeg|png|webp)$/.test(file.type)){toast('Выберите изображение JPG, PNG или WebP');e.target.value='';return}
    if(e.target.id==='eventCoverInput'){
      const preview=$('#createCoverPreview');preview.hidden=false;
      preview.innerHTML='<img src="'+URL.createObjectURL(file)+'" alt="Предпросмотр обложки"><span>'+esc(file.name)+'</span>';
    }else toast('Обложка выбрана. Она загрузится при сохранении мероприятия.');
  }
  if(e.target.matches('[data-category]')){activeCategory=e.target.dataset.category;$$('[data-category]').forEach(x=>x.classList.toggle('active',x===e.target));renderEvents()}

});
document.addEventListener('click',async(event)=>{
 const target=event.target instanceof Element?event.target:null;
 const complaintAction=target?.closest('[data-complaint-action]');
 if(complaintAction){
  const id=complaintAction.dataset.complaintAction,status=complaintAction.dataset.complaintNext;
  const card=complaintAction.closest('[data-complaint-card]'),notes=card?.querySelector('[data-complaint-notes]')?.value||'';
  const buttons=card?.querySelectorAll('[data-complaint-action]')||[];buttons.forEach(button=>button.disabled=true);
  try{
   await api('/api/moderation/complaints/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status,moderatorNotes:notes})});
   const previousStatus=card?.dataset.complaintCurrent||'new';
   if(status==='resolved'||status==='rejected'){
    const list=card?.closest('[data-complaint-list]');
    card?.remove();
    if(list&&!list.querySelector('[data-complaint-card]'))list.innerHTML=empty('Очередь жалоб рассмотрена.');
    toast(status==='resolved'?'Жалоба одобрена и удалена из очереди. Автор уведомлён.':'Жалоба отклонена и удалена из очереди. Автор уведомлён.');
   }else{
    if(card)card.dataset.complaintCurrent=status;
    const badge=card?.querySelector('[data-complaint-status]');if(badge)badge.textContent=complaintStatusLabel(status);
    const actions=card?.querySelector('.complaint-review-actions');
    if(actions)actions.innerHTML='<button type="button" class="button button-accent button-small" data-complaint-action="'+esc(id)+'" data-complaint-next="resolved">Одобрить жалобу</button><button type="button" class="button button-danger button-small" data-complaint-action="'+esc(id)+'" data-complaint-next="rejected">Отклонить жалобу</button>';
    toast(previousStatus==='in_review'?'Жалоба обновлена. Автор уведомлён.':'Жалоба взята в работу. Автор уведомлён.');
   }
  }catch(error){buttons.forEach(button=>button.disabled=false);toast(error.message)}
  return;
 }
 const retry=target?.closest('[data-retry-participants]');
 if(retry){const eventId=retry.dataset.retryParticipants,card=retry.closest('[data-staff-event-card]'),panel=card?.querySelector('[data-participant-panel]');if(panel)void loadStaffParticipants(eventId,panel,true);return}
 const moreParticipants=target?.closest('[data-participants-more]');
 if(moreParticipants){const eventId=moreParticipants.dataset.participantsMore,card=moreParticipants.closest('[data-staff-event-card]'),panel=card?.querySelector('[data-participant-panel]');if(panel)void loadStaffParticipants(eventId,panel);return}
 const toggle=target?.closest('[data-staff-event-toggle]');
 if(toggle){const picker=toggle.closest('[data-staff-event-picker]'),menu=picker?.querySelector('[data-staff-event-menu]'),open=toggle.getAttribute('aria-expanded')!=='true';if(menu)menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));return}
 const option=target?.closest('[data-staff-event-option]');
 if(option){const form=option.closest('form');setStaffEventPicker(form,option.dataset.staffEventOption);return}
 if(target&&!target.closest('[data-staff-event-picker]'))document.querySelectorAll('[data-staff-event-picker]').forEach(picker=>{const menu=picker.querySelector('[data-staff-event-menu]'),button=picker.querySelector('[data-staff-event-toggle]');if(menu)menu.hidden=true;button?.setAttribute('aria-expanded','false')});
 if(target?.closest('[data-start-ticket-scan]')){event.preventDefault();void startTicketScanner()}if(target?.closest('[data-stop-ticket-scan]')){event.preventDefault();stopTicketScanner()}});
document.addEventListener('submit',async(e)=>{
  if(e.target.id==='adminUserProfileForm'){e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;try{const payload=Object.fromEntries(new FormData(form));const file=$('#adminAvatarFile',form).files?.[0];if(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw new Error('Аватар: PNG, JPG или WebP до 2 МБ');payload.avatarData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Не удалось прочитать файл'));reader.readAsDataURL(file)})}await api('/api/admin/users/'+form.dataset.userId+'/profile',{method:'PATCH',body:JSON.stringify(payload)});toast('Профиль пользователя сохранён');await openAdminUserProfile(form.dataset.userId)}catch(error){toast(error.message)}finally{button.disabled=false}return}
  if(e.target.id==='adminBalanceForm'){e.preventDefault();const form=e.target;try{const result=await api('/api/admin/users/'+form.dataset.userId+'/balance-adjustments',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});toast('Баланс обновлён: '+money(result.balance));await openAdminUserProfile(form.dataset.userId)}catch(error){toast(error.message)}return}
  if(e.target.id==='profileLinkForm'){e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;try{await api('/api/me/profile-links',{method:'POST',body:JSON.stringify({url:e.target.elements.url.value})});e.target.reset();toast('Ссылка отправлена главному администратору на проверку');await loadMyProfileLinks()}catch(error){toast(error.message)}finally{button.disabled=false}return}
  if(e.target.id==='walletTopupForm'){e.preventDefault();const form=e.target,button=form.querySelector('[type="submit"]');button.disabled=true;if(form.dataset.attemptAmount&&form.dataset.attemptAmount!==form.elements.amount.value)form.dataset.key=crypto.randomUUID();form.dataset.attemptAmount=form.elements.amount.value;try{const topped=await api('/api/wallet/topups',{method:'POST',body:JSON.stringify({amount:Number(form.elements.amount.value),idempotencyKey:form.dataset.key})});headerWalletBalance=Number(topped.balance||0);refreshHeaderWalletLabel();toast('Баланс пополнен');await openWallet()}catch(error){form.querySelector('[data-money-error]').textContent=error.message}finally{button.disabled=false}return}
  if(e.target.id==='ticketActionForm'){e.preventDefault();const form=e.target,button=form.querySelector('[type="submit"]');button.disabled=true;try{const del=form.dataset.deleteOnly==='true';await api('/api/admin/tickets/'+encodeURIComponent(form.dataset.ticketId)+(del?'':'/cancel'),{method:del?'DELETE':'PATCH',...(del?{}:{body:JSON.stringify({refund:form.elements.refund.checked,block:form.elements.block.checked,notify:form.elements.notify.checked,deleteRecord:form.elements.deleteRecord.checked})})});closeMoneyDialog('ticketActionModal');adminSelectedTab='tickets';toast(del?'Запись билета удалена':'Билет аннулирован, место освобождено');await adminView()}catch(error){form.querySelector('[data-money-error]').textContent=error.message}finally{button.disabled=false}return}

  if(e.target.id==='searchForm'){e.preventDefault();loadEvents();$('#events').scrollIntoView({behavior:'smooth'});}
  if(e.target.id==='authForm'){e.preventDefault();const mode=$('[data-auth].active').dataset.auth;const button=$('#authSubmit');setBusy(button,true);$('#authError').textContent='';
    try{const result=await api('/api/auth/'+mode,{method:'POST',body:JSON.stringify({fullName:$('#name').value.trim(),email:$('#email').value.trim(),password:$('#password').value})});if(!result.accessToken){$('#authError').textContent=result.message;return}if(result.refreshToken&&supabaseAuth){const {data,error}=await supabaseAuth.auth.setSession({access_token:result.accessToken,refresh_token:result.refreshToken});if(error)throw error;sessionStorage.setItem(tokenKey,data.session?.access_token||result.accessToken)}else sessionStorage.setItem(tokenKey,result.accessToken);const loaded=await loadSession(result.user);if(!loaded)throw new Error('Не удалось загрузить профиль аккаунта');authClose();if(ACCOUNT_ROUTE)renderAccountRoute();toast(mode==='login'?'Вход выполнен':'Аккаунт создан');}
    catch(x){$('#authError').textContent=x.message}finally{setBusy(button,false)}
  }
  if(e.target.id==='profileSettingsForm'){e.preventDefault();const button=e.target.querySelector('[type="submit"]');setBusy(button,true,'Сохраняем профиль…');try{const data=Object.fromEntries(new FormData(e.target));const result=await api('/api/me/profile',{method:'PATCH',body:JSON.stringify(data)});user={...user,...result.user};renderAccountMenu();toast('Профиль сохранён')}catch(error){toast(error.message)}finally{setBusy(button,false)}}
  if(e.target.id==='reviewForm'){e.preventDefault();try{await api('/api/reviews',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Спасибо за отзыв');visitorView()}catch(x){toast(x.message)}}
  if(e.target.matches('.program-edit-form')){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.duration_minutes=Number(data.duration_minutes);data.max_attendees=Number(data.max_attendees);try{await api('/api/events/'+e.target.closest('.organizer-event-item')?.querySelector('[data-event-edit]')?.dataset.eventEdit+'/program/'+e.target.dataset.programEdit,{method:'PATCH',body:JSON.stringify(data)});toast('Пункт программы сохранён');await organizerView()}catch(x){toast(x.message)}}
  if(e.target.matches('[data-event-edit]')){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.base_price=Number(data.base_price||0);try{const file=e.target.querySelector('[data-event-cover-file]')?.files?.[0];if(file)data.cover_image=await uploadEventCover(file);await api('/api/events/'+e.target.dataset.eventEdit,{method:'PATCH',body:JSON.stringify(data)});toast('Мероприятие обновлено');organizerView()}catch(x){toast(x.message)}}
  if(e.target.id==='createEventForm'){e.preventDefault();const form=e.target,body=Object.fromEntries(new FormData(form));body.total_seats=Number(body.total_seats);body.base_price=Number(body.base_price||0);try{body.program=collectProgramDraft(form.querySelector('#eventProgramList'));const file=form.querySelector('#eventCoverInput')?.files?.[0];if(file)body.cover_image=await uploadEventCover(file);await api('/api/events',{method:'POST',body:JSON.stringify(body)});toast('Мероприятие и программа отправлены на модерацию');organizerView()}catch(x){toast(x.message)}}
  if(e.target.id==='createHallForm'){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.capacity=Number(data.capacity);data.cols=Number(data.cols);try{await api('/api/organizer/halls',{method:'POST',body:JSON.stringify(data)});toast('Схема зала создана, места готовы');await organizerView()}catch(x){toast(x.message)}}
  if(e.target.id==='createVenueForm'){e.preventDefault();try{await api('/api/venues',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Площадка добавлена');organizerView()}catch(x){toast(x.message)}}
  if(e.target.matches('.program-form')){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));d.max_attendees=Number(d.max_attendees);try{await api('/api/events/'+e.target.dataset.event+'/program',{method:'POST',body:JSON.stringify(d)});toast('Пункт программы добавлен');await organizerView()}catch(x){toast(x.message)}}
  if(e.target.matches('.assign-form')){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await api('/api/organizer/events/'+e.target.dataset.event+'/staff',{method:'POST',body:JSON.stringify(d)});toast('Сотрудник назначен');}catch(x){toast(x.message)}}
  if(e.target.matches('.notify-form')){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{const r=await api('/api/organizer/events/'+e.target.dataset.event+'/notify',{method:'POST',body:JSON.stringify(d)});toast('Уведомление отправлено: '+r.sent)}catch(x){toast(x.message)}}
  if(e.target.id==='scanForm'){e.preventDefault();await submitTicketCheckIn(e.target)}
  if(e.target.id==='complaintForm'){e.preventDefault();if(!signedIn())return authOpen();const d=Object.fromEntries(new FormData(e.target));try{await api('/api/complaints',{method:'POST',body:JSON.stringify({targetType:'event',targetId:d.targetId,reason:d.reason,details:d.details})});setEventModalOpen(false);toast('Жалоба отправлена модератору')}catch(x){toast(x.message)}}
});
$('#authOpen').addEventListener('click',()=>authOpen());

$$('[data-close]').forEach(x=>x.addEventListener('click',()=>$('#'+x.dataset.close).hidden=true));
$('#workspaceNav').addEventListener('click',(e)=>{e.preventDefault();window.location.assign('/dashboard/')});
$('#workspaceRefresh').addEventListener('click',()=>{
  if(PROFILE_ROUTE)window.location.assign('/');
  else if(NOTIFICATIONS_ROUTE)void notificationsView();
  else showWorkspace();
});
const themeKey='flowtix_theme';
const themeNames={rose:'Розовая',sky:'Голубая',dark:'Тёмная',halloween:'Хэллоуин'};
const allowedThemes=Object.keys(themeNames);
function applyTheme(theme,{save=true}={}){
  const next=allowedThemes.includes(theme)?theme:'rose';
  document.body.dataset.theme=next;
  $$('[data-theme-label]').forEach((label)=>label.textContent=themeNames[next]);
  $$('[data-theme-option]').forEach((option)=>option.setAttribute('aria-selected',String(option.dataset.themeOption===next)));
  localStorage.setItem(themeKey,next);
  if(save&&signedIn()){
    const previous=user.preferences?.theme;
    user.preferences={...(user.preferences||{}),theme:next};
    api('/api/me/preferences',{method:'PATCH',body:JSON.stringify({theme:next})})
      .catch((error)=>{user.preferences={...(user.preferences||{}),theme:previous};toast('Тема сохранена на этом устройстве, но не в аккаунте: '+error.message)});
  }
}
applyTheme(localStorage.getItem(themeKey)||'rose',{save:false});
document.addEventListener('keydown',(event)=>{
  if(event.key==='Escape'){$('#profileDropdown').hidden=true;$('#profileMenuToggle').setAttribute('aria-expanded','false')}
  if(event.key==='Escape')$('[data-theme-menu]:not([hidden])').forEach((menu)=>{
    menu.hidden=true;
    menu.parentElement.querySelector('[data-theme-select-button]')?.setAttribute('aria-expanded','false');
  });
});
const GOOGLE_OAUTH_CLIENT_ID='69394596232-2jjcm977md330t3e49urjvuotep57f68.apps.googleusercontent.com';
let googleNonce='';
let googleIdentityPromise=null;
let googleButtonSetupPromise=null;
function loadGoogleIdentity(){
  if(window.google?.accounts?.id)return Promise.resolve();
  if(googleIdentityPromise)return googleIdentityPromise;
  googleIdentityPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;script.defer=true;
    script.onload=resolve;
    script.onerror=()=>reject(new Error('Не удалось загрузить Google Identity Services'));
    document.head.appendChild(script);
  });
  return googleIdentityPromise;
}
async function setupGoogleButton(){
  if(googleButtonSetupPromise)return googleButtonSetupPromise;
  googleButtonSetupPromise=(async()=>{
  await loadGoogleIdentity();
  if(!supabaseAuth)throw new Error('Supabase Auth ещё загружается');
  const nonce=crypto.randomUUID()+crypto.randomUUID();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nonce));
  const hashedNonce=[...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
  googleNonce=nonce;
  const container=$('#googleSdkButton');
  if(!container)throw new Error('Не найден контейнер кнопки Google');
  container.replaceChildren();
  google.accounts.id.initialize({
    client_id:GOOGLE_OAUTH_CLIENT_ID,
    ux_mode:'popup',
    nonce:hashedNonce,
    callback:async(response)=>{
      try{
        if(!response?.credential)throw new Error('Google не вернул токен входа');
        const {data,error}=await supabaseAuth.auth.signInWithIdToken({
          provider:'google',token:response.credential,nonce:googleNonce
        });
        if(error)throw error;
        if(!data.session?.access_token)throw new Error('Supabase не вернул сессию входа');
        sessionStorage.setItem(tokenKey,data.session.access_token);
        const loaded=await loadSession(data.user);
        if(!loaded)throw new Error('Вход прошёл, но профиль не удалось загрузить. Попробуй ещё раз.');
        authClose();
        if(ACCOUNT_ROUTE)renderAccountRoute();
        toast('Вход выполнен через Google');
      }catch(error){$('#authError').textContent=error.message||'Не удалось войти через Google'}
    }
  });
  google.accounts.id.renderButton(container,{
    type:'standard',theme:'outline',size:'large',text:'continue_with',
    shape:'pill',logo_alignment:'left',locale:'ru',
    width:Math.min(container.clientWidth||360,400)
  });
  })();
  try{await googleButtonSetupPromise}
  finally{googleButtonSetupPromise=null}
}
$('#categoryBar').addEventListener('click',(e)=>{const b=e.target.closest('[data-category]');if(b){activeCategory=b.dataset.category;$$('[data-category]').forEach(x=>x.classList.toggle('active',x===b));renderEvents()}});
$('#searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadEvents,250)});
$('#cityInput').addEventListener('change',loadEvents);
$('#footerYear').textContent=new Date().getFullYear();

document.addEventListener('click',async event=>{
 const el=event.target instanceof Element?event.target:null;if(!el)return;
 if(el.closest('[data-profile-close]')){el.closest('#publicProfileModal')?.remove();return}
 if(el.closest('[data-admin-profile-close]')){el.closest('#adminUserProfileModal')?.remove();return}
 const publicProfile=el.closest('[data-profile-open]');if(publicProfile){event.preventDefault();void openPublicProfile(publicProfile.dataset.profileOpen);return}
 if(el.id==='publicProfileModal'){el.remove();return}
 if(el.id==='adminUserProfileModal'){el.remove();return}
 const requestChat=el.closest('[data-request-chat]');if(requestChat){try{const result=await api('/api/messages/requests',{method:'POST',body:JSON.stringify({userId:requestChat.dataset.requestChat})});document.querySelector('#publicProfileModal')?.remove();toast(result.alreadyActive?'Переписка уже открыта':'Запрос на личный чат отправлен');if(result.conversation?.id||result.alreadyActive)window.location.assign('/messages/')}catch(error){toast(error.message)}return}
 const userBlock=el.closest('[data-toggle-user-block]');if(userBlock){try{const blocked=userBlock.dataset.blocked==='true';await api('/api/me/blocks/'+encodeURIComponent(userBlock.dataset.toggleUserBlock),{method:blocked?'DELETE':'POST'});userBlock.dataset.blocked=String(!blocked);userBlock.textContent=blocked?'Заблокировать':'Разблокировать';toast(blocked?'Блокировка снята':'Пользователь заблокирован');if(!blocked)document.querySelector('#publicProfileModal')?.remove()}catch(error){toast(error.message)}return}
 const ownUnblock=el.closest('[data-own-unblock]');if(ownUnblock){try{await api('/api/me/blocks/'+encodeURIComponent(ownUnblock.dataset.ownUnblock),{method:'DELETE'});toast('Блокировка снята');await loadMyProfileLinks()}catch(error){toast(error.message)}return}
 const ownLinkDelete=el.closest('[data-remove-own-link]');if(ownLinkDelete){if(!confirm('Удалить ссылку из профиля?'))return;try{await api('/api/me/profile-links/'+encodeURIComponent(ownLinkDelete.dataset.removeOwnLink),{method:'DELETE'});toast('Ссылка удалена');await loadMyProfileLinks()}catch(error){toast(error.message)}return}
 const adminLinkSave=el.closest('[data-admin-link-save]');if(adminLinkSave){const id=adminLinkSave.dataset.adminLinkSave,form=document.querySelector('#adminUserProfileForm'),userId=form?.dataset.userId,value=document.querySelector('[data-admin-link-url="'+CSS.escape(id)+'"]')?.value;if(!userId)return;try{await api('/api/admin/profile-links/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({url:value})});toast('Ссылка профиля обновлена');await openAdminUserProfile(userId)}catch(error){toast(error.message)}return}
 const adminLinkDelete=el.closest('[data-admin-link-delete]');if(adminLinkDelete){if(!confirm('Удалить эту ссылку из профиля пользователя?'))return;try{await api('/api/admin/profile-links/'+encodeURIComponent(adminLinkDelete.dataset.adminLinkDelete),{method:'DELETE'});toast('Ссылка удалена');await openAdminUserProfile(document.querySelector('#adminUserProfileForm')?.dataset.userId)}catch(error){toast(error.message)}return}
 const adminProfileBlock=el.closest('[data-admin-profile-block]');if(adminProfileBlock){try{const blocked=adminProfileBlock.dataset.blocked==='true';await api('/api/admin/users/'+encodeURIComponent(adminProfileBlock.dataset.adminProfileBlock)+'/block',{method:'PATCH',body:JSON.stringify({blocked:!blocked})});toast(!blocked?'Аккаунт заблокирован':'Аккаунт разблокирован');await openAdminUserProfile(adminProfileBlock.dataset.adminProfileBlock)}catch(error){toast(error.message)}return}
 const chatOpen=el.closest('[data-chat-open]');if(chatOpen){try{await openChatConversation(chatOpen.dataset.chatOpen)}catch(error){toast(error.message)}return}
 const chatAction=el.closest('[data-chat-request-action]');if(chatAction){try{await api('/api/messages/conversations/'+encodeURIComponent(chatAction.dataset.chatId),{method:'PATCH',body:JSON.stringify({action:chatAction.dataset.chatRequestAction})});await refreshConversations();if(chatAction.dataset.chatRequestAction==='accept')await openChatConversation(chatAction.dataset.chatId);toast(chatAction.dataset.chatRequestAction==='accept'?'Чат открыт':'Запрос отклонён')}catch(error){toast(error.message)}return}
 if(el.closest('[data-chat-back]')){document.querySelector('.messages-workspace')?.classList.remove('has-active-chat');return}
 if(el.closest('[data-clear-chat]')){if(!activeChatId)return;try{const result=await api('/api/messages/conversations/'+encodeURIComponent(activeChatId),{method:'PATCH',body:JSON.stringify({action:'clear'})});if(result.deleted){activeChatId=null;activeChatOtherId=null;clearChatRealtime();$('#chatMessages').innerHTML='<div class="chat-empty">Оба участника очистили историю. Переписка удалена.</div>';$('#chatComposer').hidden=true;$('#chatActiveHeader').hidden=true}else{$('#chatMessages').innerHTML='<div class="chat-empty">История очищена у тебя. Новые сообщения будут видны здесь.</div>';activeChatMessages=[];const badge=$('#chatClearCount');if(badge)badge.textContent='1/2 очистили'}await refreshConversations()}catch(error){toast(error.message)}return}
 if(el.closest('[data-block-chat]')){if(!activeChatOtherId)return;if(!confirm('Заблокировать этого пользователя? Чат будет закрыт, его мероприятия скроются, а участие в твоих мероприятиях станет недоступно.'))return;try{await api('/api/me/blocks/'+encodeURIComponent(activeChatOtherId),{method:'POST'});toast('Пользователь заблокирован');activeChatId=null;activeChatOtherId=null;clearChatRealtime();await refreshConversations();$('#chatMessages').innerHTML='<div class="chat-empty">Чат закрыт блокировкой.</div>';$('#chatComposer').hidden=true;$('#chatActiveHeader').hidden=true}catch(error){toast(error.message)}return}
 const retryNotifications=el.closest('[data-notification-retry]');if(retryNotifications){event.preventDefault();void loadNotificationPage();return}
 if(el.closest('[data-workspace-refresh]')||el.id==='workspaceRefresh'){
  if(MESSAGES_ROUTE){event.preventDefault();await refreshConversations();return}
  if(ACCOUNT_ROUTE){event.preventDefault();renderAccountRoute();return}
 }
});
document.addEventListener('input',event=>{
 const target=event.target;
 if(target.matches('#chatComposer textarea')){target.style.height='auto';target.style.height=Math.min(target.scrollHeight,180)+'px';const count=$('#chatCharCount');if(count)count.textContent=String(target.value.length)}
});
document.addEventListener('keydown',event=>{
  const field=event.target;
  if(!field.matches?.('#chatComposer textarea')||event.key!=='Enter'||event.shiftKey||event.isComposing)return;
  event.preventDefault();field.form?.requestSubmit();
 });
 document.addEventListener('submit',async event=>{
 const form=event.target;
 if(form?.id==='chatComposer'){event.preventDefault();if(!activeChatId)return;const textarea=form.elements.body,body=textarea.value.trim();if(!body||body.length>512)return;const button=form.querySelector('[type=submit]');button.disabled=true;try{const {message}=await api('/api/messages/conversations/'+encodeURIComponent(activeChatId)+'/messages',{method:'POST',body:JSON.stringify({body})});if(!activeChatMessages.some(x=>x.id===message.id)){activeChatMessages.push(message);$('#chatMessages').insertAdjacentHTML('beforeend',messageBubble(message))}textarea.value='';textarea.style.height='auto';$('#chatCharCount').textContent='0';const box=$('#chatMessages');box.scrollTop=box.scrollHeight;await refreshConversations()}catch(error){toast(error.message)}finally{button.disabled=false}return}
});


function setupFlowScrollbars(){
 const bars={y:document.createElement('div'),x:document.createElement('div')};
 const targets={y:null,x:null}, timers={y:0,x:0},drag=null;
 bars.y.className='flow-scrollbar flow-scrollbar-y';bars.x.className='flow-scrollbar flow-scrollbar-x';
 for(const axis of ['y','x']){
  const thumb=document.createElement('div');thumb.className='flow-scrollbar-thumb';thumb.tabIndex=0;thumb.setAttribute('role','scrollbar');thumb.setAttribute('aria-orientation',axis==='y'?'vertical':'horizontal');thumb.setAttribute('aria-label','Прокрутка страницы');bars[axis].append(thumb);
  document.body.append(bars[axis]);
 }
 const rootTarget=t=>t===window||t===document||t===document.documentElement||t===document.body;
 function metrics(target,axis){
  const root=rootTarget(target),el=root?document.scrollingElement:target;
  if(!el)return null;
  const vertical=axis==='y',size=vertical?el.clientHeight:el.clientWidth,scroll=vertical?el.scrollHeight:el.scrollWidth;
  if(!size||scroll<=size+2)return null;
  let start,extent,cross;
  if(root){start=6;extent=(vertical?innerHeight:innerWidth)-12;cross=vertical?innerWidth-7:innerHeight-7}
  else{
   const r=target.getBoundingClientRect();
   if(vertical){start=Math.max(0,r.top);extent=Math.max(0,Math.min(innerHeight,r.bottom)-start);cross=Math.min(innerWidth,r.right)-7}
   else{start=Math.max(0,r.left);extent=Math.max(0,Math.min(innerWidth,r.right)-start);cross=Math.min(innerHeight,r.bottom)-7}
  }
  if(extent<20)return null;
  const thumbExtent=Math.min(extent,Math.max(24,extent*size/scroll));
  const position=vertical?el.scrollTop:el.scrollLeft,range=scroll-size;
  return{el,root,vertical,start,extent,cross,thumbExtent,progress:Math.min(1,Math.max(0,position/range)),range};
 }
 function paint(axis,show){
  const bar=bars[axis],target=targets[axis],m=target&&metrics(target,axis);
  if(!m){bar.classList.remove('is-visible');return}
  if(axis==='y'){
   bar.style.left='';bar.style.right=Math.max(3,innerWidth-m.cross-7)+'px';bar.style.top=m.start+'px';bar.style.height=m.extent+'px';bar.style.width='7px';
   const travel=m.extent-m.thumbExtent;bar.firstElementChild.style.height=m.thumbExtent+'px';bar.firstElementChild.style.width='100%';bar.firstElementChild.style.transform='translateY('+travel*m.progress+'px)';
   bar.firstElementChild.setAttribute('aria-valuemin','0');bar.firstElementChild.setAttribute('aria-valuemax','100');bar.firstElementChild.setAttribute('aria-valuenow',String(Math.round(m.progress*100)));
  }else{
   bar.style.top='';bar.style.bottom=Math.max(3,innerHeight-m.cross-7)+'px';bar.style.left=m.start+'px';bar.style.width=m.extent+'px';bar.style.height='7px';
   const travel=m.extent-m.thumbExtent;bar.firstElementChild.style.width=m.thumbExtent+'px';bar.firstElementChild.style.height='100%';bar.firstElementChild.style.transform='translateX('+travel*m.progress+'px)';
   bar.firstElementChild.setAttribute('aria-valuemin','0');bar.firstElementChild.setAttribute('aria-valuemax','100');bar.firstElementChild.setAttribute('aria-valuenow',String(Math.round(m.progress*100)));
  }
  if(show)bar.classList.add('is-visible');
 }
 function showFor(target){
  if(!target)return;
  for(const axis of ['y','x']){
   if(!metrics(target,axis))continue;
   targets[axis]=target;paint(axis,true);clearTimeout(timers[axis]);
   timers[axis]=setTimeout(()=>bars[axis].classList.remove('is-visible'),850);
  }
 }
 function setProgress(axis,clientPosition,dragging=false){
  const bar=bars[axis],target=dragging?drag?.target:targets[axis],m=target&&metrics(target,axis);if(!m)return;
  const rect=bar.getBoundingClientRect(),coord=axis==='y'?clientPosition-rect.top:clientPosition-rect.left;
  const travel=m.extent-m.thumbExtent,progress=Math.max(0,Math.min(1,(coord-m.thumbExtent/2)/Math.max(1,travel)));
  if(m.vertical)m.el.scrollTop=progress*m.range;else m.el.scrollLeft=progress*m.range;
  targets[axis]=target;paint(axis,true);clearTimeout(timers[axis]);timers[axis]=setTimeout(()=>bars[axis].classList.remove('is-visible'),850);
 }
 for(const axis of ['y','x']){
  bars[axis].addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();drag={axis,target:targets[axis],pointerId:event.pointerId};bars[axis].setPointerCapture(event.pointerId);setProgress(axis,axis==='y'?event.clientY:event.clientX,true)});
  bars[axis].addEventListener('pointermove',event=>{if(drag?.axis===axis&&drag.pointerId===event.pointerId)setProgress(axis,axis==='y'?event.clientY:event.clientX,true)});
  bars[axis].addEventListener('pointerup',event=>{if(drag?.axis===axis){drag=null;clearTimeout(timers[axis]);timers[axis]=setTimeout(()=>bars[axis].classList.remove('is-visible'),850)}});
  bars[axis].firstElementChild.addEventListener('keydown',event=>{const target=targets[axis],el=rootTarget(target)?document.scrollingElement:target;if(!el)return;const vertical=axis==='y';let delta=vertical?el.clientHeight*.12:el.clientWidth*.12;if(event.key==='PageDown')delta=vertical?el.clientHeight:el.clientWidth;if(event.key==='PageUp')delta=-(vertical?el.clientHeight:el.clientWidth);else if(event.key==='ArrowDown'||event.key==='ArrowRight'){}else if(event.key==='ArrowUp'||event.key==='ArrowLeft')delta=-delta;else if(event.key==='Home')delta=-Infinity;else if(event.key==='End')delta=Infinity;else return;event.preventDefault();if(vertical)el.scrollTop=delta===Infinity?el.scrollHeight:delta===-Infinity?0:el.scrollTop+delta;else el.scrollLeft=delta===Infinity?el.scrollWidth:delta===-Infinity?0:el.scrollLeft+delta;showFor(target)});
 }
 window.addEventListener('scroll',()=>showFor(window),{passive:true});
 document.addEventListener('scroll',event=>{if(event.target&&event.target.nodeType===1)showFor(event.target)},{capture:true,passive:true});
 window.addEventListener('resize',()=>{for(const axis of ['y','x'])if(bars[axis].classList.contains('is-visible'))paint(axis,true)},{passive:true});
}
async function init(){
  try {
    const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.4');
    supabaseAuth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:'pkce',detectSessionInUrl:true}});
    supabaseAuth.auth.onAuthStateChange((event,session)=>{
      if(session?.access_token){
        sessionStorage.setItem(tokenKey,session.access_token);
        supabaseAuth.realtime.setAuth(session.access_token);
      }else if(event==='SIGNED_OUT')sessionStorage.removeItem(tokenKey);
    });
    await setupGoogleButton();
    const {data:{session}}=await supabaseAuth.auth.getSession();
    if(session?.access_token)sessionStorage.setItem(tokenKey,session.access_token);
  } catch(error) {
    console.error('Supabase Auth init failed:',error);
    $('#authError').textContent='Не удалось загрузить Google-вход: '+(error.message||'попробуй снова');
  }
  const [hasSession]=await Promise.all([loadSession(),loadCategories()]);
  if(!ACCOUNT_ROUTE){await loadEvents();const eventId=new URLSearchParams(window.location.search).get('eventId');if(eventId){history.replaceState(null,'',window.location.pathname+window.location.hash);openEvent(eventId)}}
  if(ACCOUNT_ROUTE&&hasSession&&user?.is_blocked){sessionStorage.setItem('flowtix_blocked_route_notice','1');window.location.replace('/');return}
  if(!ACCOUNT_ROUTE&&user?.is_blocked&&sessionStorage.getItem('flowtix_blocked_route_notice')==='1'){sessionStorage.removeItem('flowtix_blocked_route_notice');showBlockedAccountModal()}
  if(ACCOUNT_ROUTE){if(hasSession||PUBLIC_PROFILE_ROUTE)renderAccountRoute();else authOpen('login')}
}
setupFlowScrollbars();
init();
