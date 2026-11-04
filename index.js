const API_BASE = 'https://cursa-guk5.onrender.com';
const SUPABASE_URL = 'https://rpsvuygarxlnqpxtwuzq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hIAivAUZ0fCx9KlHsj4YVg_kc2TkPzB';
let supabaseAuth = null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const tokenKey = 'flowtix_access_token';
const PROFILE_ROUTE = /^\/profile\/?$/.test(window.location.pathname);
const DASHBOARD_ROUTE = /^\/dashboard\/?$/.test(window.location.pathname);
const NOTIFICATIONS_ROUTE = /^\/notifications\/?$/.test(window.location.pathname);
const ADMIN_ROUTE = /^\/admin\/?$/.test(window.location.pathname);
const ACCOUNT_ROUTE = PROFILE_ROUTE || DASHBOARD_ROUTE || NOTIFICATIONS_ROUTE || ADMIN_ROUTE;
if (ACCOUNT_ROUTE) {
  document.body.classList.add('account-page');
  $('.hero').hidden = true;
  $('#events').hidden = true;
  $('.footer').hidden = true;
  $('#workspace').hidden = false;
}
let user = null;
let notificationsChannel = null;
let notificationsChannelUserId = null;
let notificationsConnection = 'CONNECTING';
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
const api = async (path, options = {}) => {
  const token = sessionStorage.getItem(tokenKey);
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Запрос не выполнен (' + response.status + ')');
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
document.addEventListener('input',event=>{if(event.target.matches('textarea'))autosizeTextarea(event.target)});
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
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
function empty(message = 'Когда появятся данные, они отобразятся в этом разделе.') { return '<div class="empty-state"><span class="empty-star">✳</span><h3>Пока здесь тихо</h3><p>'+esc(message)+'</p></div>'; }
function setBusy(button, busy, text) { if (!button) return; button.disabled = busy; if (busy) { button.dataset.label = button.textContent; button.textContent = text || 'Сохраняем…'; } else if (button.dataset.label) button.textContent = button.dataset.label; }
function signedIn() { return Boolean(user && sessionStorage.getItem(tokenKey)); }
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
function renderAccountMenu(){
  const active=signedIn();
  $('#authOpen').hidden=active;
  $('#profileMenuWrap').hidden=!active;
  $('#workspaceNav').hidden=!active;
  const adminLink=$('#profileAdminLink');
  if(adminLink)adminLink.hidden=!active||user.is_root_admin!==true;
  if(!active)return;
  const displayName=user.full_name||user.email||'Участник FlowTix';
  const handle=user.username||String(user.email||'user').split('@')[0];
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
    '<div class="event-info"><div class="event-date">'+esc(date || 'Дата уточняется')+'</div><h3>'+title+'</h3><div class="event-place">⌖ '+esc(place || address || 'Место уточняется')+'</div>'+(place&&address?'<div class="event-address">'+esc(address)+'</div>':'')+
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
  $('#recommendationCaption').textContent=personalized.length?'По интересам и избранному':'Популярное сейчас';
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
    $('#eventDialog').innerHTML='<div class="event-hero">'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<button class="dialog-close" data-close="eventModal" aria-label="Закрыть">×</button></div><div class="event-dialog-content"><p class="eyebrow dark-eyebrow">'+esc(e.event_categories?.name||'Мероприятие')+'</p><h2>'+esc(e.title)+'</h2><p><b>'+esc([e.start_date,e.start_time].filter(Boolean).join(' · '))+'</b> · '+esc([e.venues?.city,e.venues?.name,e.location_address||e.venues?.address].filter(Boolean).join(', '))+'</p><p>'+esc(e.description||'Описание не добавлено.')+'</p><p>'+esc(money(e.current_price??e.base_price))+' · Осталось мест: '+esc(e.available_seats??'—')+' · Возраст: '+esc(e.age_limit||'Для всех')+'</p>'+(e.contact_email||e.contact_phone?'<p>Контакты: '+esc([e.contact_email,e.contact_phone].filter(Boolean).join(' · '))+'</p>':'')+(e.rules?'<div class="workspace-card"><h3>Правила посещения</h3><p>'+esc(e.rules)+'</p></div>':'')+'<div class="workspace-card"><h3>Программа мероприятия</h3>'+renderEventProgram(e.event_program||[])+'</div><div class="inline-actions"><button class="button button-dark" data-register="'+esc(e.id)+'">Участвовать</button><button class="button button-light" data-report="'+esc(e.id)+'">Пожаловаться</button></div><div id="reportForm"></div></div>';
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
  const statusText=selected?(expiry?'Бронь держится 10 минут после выбора.':'Место выбрано.'):'Выбери свободное место на схеме зала.';
  root.className='dialog event-dialog seat-map-dialog';
  root.innerHTML='<div class="seat-picker-head"><div><p class="eyebrow dark-eyebrow">ВЫБОР МЕСТА</p><h2>'+esc(event.title||'Мероприятие')+'</h2><p>'+esc([event.start_date,event.start_time,event.venues?.name,event.venues?.city].filter(Boolean).join(' · '))+'</p></div><button class="dialog-close" data-close="eventModal" aria-label="Закрыть">×</button></div><div class="seat-picker-content"><div class="seat-picker-summary"><div><span class="seat-summary-dot available"></span>Свободно</div><div><span class="seat-summary-dot reserved"></span>На удержании</div><div><span class="seat-summary-dot occupied"></span>Занято</div></div><div class="seat-map-scroll"><div class="seat-stage">СЦЕНА</div><div class="seat-type-legend">'+['standard','vip','business','free','accessible'].filter(type=>seats.some(seat=>seat.seat_type===type)).map(type=>'<span><i class="seat-type-swatch seat-type-'+type+'"></i>'+seatTypeLabels[type]+'</span>').join('')+'</div><div class="seat-rows">'+(rows||'<p class="seat-empty">Схема этого зала пока не настроена.</p>')+'</div></div><div class="seat-picker-footer"><div class="seat-selection-copy"><b>'+(selected?esc(selected.row_label+selected.seat_number)+' · '+esc(seatTypeLabels[selected.seat_type]||'Место'):'Место не выбрано')+'</b><span id="seatHoldStatus">'+esc(statusText)+'</span><span id="seatHoldCountdown" aria-live="polite"></span></div><button class="button button-accent" data-confirm-seat '+(selected?'':'disabled')+'>Зарегистрироваться</button></div></div>';
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
  const token=sessionStorage.getItem(tokenKey);
  if(!token){user=null;renderAccountMenu();return false}
  let account=null;
  let profileError=null;
  try{
    const result=await api('/api/me');
    account=result.user;
  }catch(error){
    profileError=error;
    if(!authUser&&supabaseAuth){
      try{const {data,error:getUserError}=await supabaseAuth.auth.getUser();if(!getUserError)authUser=data.user}catch{}
    }
    if(!authUser){
      console.error('Account profile could not be loaded:',error);
      sessionStorage.removeItem(tokenKey);user=null;renderAccountMenu();return false;
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
  void subscribeToNotifications();
  try{
    const fav=await api('/api/favorites');
    user.favorites=(fav.favorites||[]).map((item)=>item.event_id);
  }catch(error){console.warn('Favorites are temporarily unavailable:',error.message)}
  renderEvents();
  return true;
}
async function logoutAccount(){
  sessionStorage.removeItem(tokenKey);
  try{
    if(notificationsChannel&&supabaseAuth)await supabaseAuth.removeChannel(notificationsChannel);
    notificationsChannel=null;notificationsChannelUserId=null;
    if(supabaseAuth)await supabaseAuth.auth.signOut();
  }catch(error){console.warn('Sign-out cleanup failed:',error)}
  user=null;
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
  $('#workspaceContent').innerHTML='<div class="settings-layout"><div class="workspace-card settings-intro"><p class="eyebrow dark-eyebrow">ТВОЙ FLOWTIX</p><h3>Твой профиль</h3><p>Настрой, как ты будешь отображаться в FlowTix. Изменения профиля сохраняются в аккаунте.</p></div><div class="workspace-card"><form id="profileSettingsForm" class="form-grid settings-form"><div class="wide avatar-editor"><span id="profileAvatarPreview" class="profile-avatar profile-avatar-large"></span><div class="avatar-copy"><b>Фото профиля</b><p>JPG, PNG или WebP · до 2 МБ</p><label class="button button-light avatar-upload-button">Загрузить фото<input id="avatarInput" type="file" accept="image/jpeg,image/png,image/webp" hidden></label></div></div><label>Отображаемое имя<input name="full_name" value="'+esc(user.full_name||'')+'" required maxlength="120" autocomplete="name"></label><label>Юзернейм<input name="username" value="'+esc(user.username||'')+'" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" autocomplete="username"><small>Латинские буквы, цифры и _</small></label><label>Email аккаунта<input value="'+esc(user.email||'')+'" disabled></label><label>Город<input name="city" value="'+esc(user.city||'')+'" maxlength="100" placeholder="Например, Алматы"></label><label>Телефон<input name="phone" type="tel" value="'+esc(user.phone||'')+'" maxlength="40" autocomplete="tel" placeholder="+7 ..."></label><label class="wide">О себе<textarea name="about" rows="4" maxlength="1000" placeholder="Расскажи, какие события тебе интересны">'+esc(user.preferences?.about||'')+'</textarea></label><div class="wide settings-theme"><div><b>Оформление</b><p>Выбранная тема сохраняется в аккаунте и на этом устройстве.</p></div>'+themePickerMarkup()+'</div><div class="wide form-actions"><button class="button button-accent" type="submit">Сохранить профиль</button></div></form></div></div>';
  putAvatar($('#profileAvatarPreview'),user.avatar_url,user.full_name);
  $('#workspace').scrollIntoView({behavior:'smooth'});
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
    const [tickets,fav]=await Promise.all([api('/api/tickets/mine'),api('/api/favorites')]);
    const ts=tickets.tickets||[], fs=fav.favorites||[];
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Мои билеты</h3>'+ (ts.length?'<div class="ticket-list">'+ts.map(t=>'<p><b>'+esc(t.events?.title||'Мероприятие')+'</b> · '+esc(t.ticket_number)+' <span class="status-pill">'+esc(t.status)+'</span></p>').join('')+'</div>':empty('Зарегистрируйтесь на событие — билет появится здесь.'))+'</div><div class="workspace-card"><h3>Избранное ('+fs.length+')</h3>'+ (fs.length?fs.map(x=>'<p>'+esc(x.events?.title||'Мероприятие')+'</p>').join(''):empty('Отмечайте сердцем мероприятия, чтобы не потерять.'))+'</div><div class="workspace-card"><h3>Оставить отзыв</h3>'+ (ts.length?'<form id="reviewForm" class="form-grid"><label>Событие<select name="eventId">'+ts.map(t=>'<option value="'+esc(t.event_id)+'">'+esc(t.events?.title||'Мероприятие')+'</option>').join('')+'</select></label>'+['orgRating','venueRating','programRating','staffRating'].map((key,i)=>'<label>'+['Организатор','Площадка','Программа','Команда'][i]+'<select name="'+key+'"><option value="5">5 — отлично</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1 — плохо</option></select></label>').join('')+'<label class="wide">Комментарий<textarea name="comment" rows="3" maxlength="3000"></textarea></label><button class="button button-dark">Опубликовать отзыв</button></form>':empty('Для отзыва сначала нужен билет на событие.'))+'</div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
async function notificationsView() {
  if(!signedIn())return authOpen();
  $('#workspace').hidden=false;
  $('#workspaceTitle').textContent='Уведомления';
  $('#workspaceRefresh').textContent='Обновить уведомления ↻';
  $('#workspaceContent').innerHTML='<div class="workspace-card"><div class="notification-live"><span class="notification-live-dot '+(notificationsConnection==='SUBSCRIBED'?'is-live':'')+'"></span><span id="notificationsLiveStatus">'+(notificationsConnection==='SUBSCRIBED'?'Подключено · новые уведомления приходят сразу':'Подключаемся к уведомлениям…')+'</span></div><p>Сообщения от организаторов и FlowTix появятся здесь автоматически.</p></div><div class="notification-list" id="notificationList"><div class="workspace-card"><p>Загружаем уведомления…</p></div></div>';
  try{
    const {notifications=[]}=await api('/api/notifications');
    const list=$('#notificationList');
    if(!list)return;
    list.innerHTML=notifications.length?notifications.map((notice)=>{
      const date=notice.created_at?new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(new Date(notice.created_at)):'';
      return '<article class="workspace-card notification-card '+(notice.is_read?'':'unread')+'"><div class="notification-card-head"><h3>'+esc(notice.title||'Уведомление FlowTix')+'</h3><span class="status-pill">'+(notice.is_read?'Прочитано':'Новое')+'</span></div><p>'+esc(notice.message||'')+'</p>'+(date?'<small>'+esc(date)+'</small>':'')+'</article>';
    }).join(''):empty('Новых уведомлений пока нет. Когда организатор сообщит об изменениях, они появятся здесь.');
  }catch(error){const list=$('#notificationList');if(list)list.innerHTML='<p class="connection-state">'+esc(error.message)+'</p>'}
}
function renderAccountRoute(){
  if(ADMIN_ROUTE)return adminRoute();
  if(PROFILE_ROUTE)return showSettings();
  if(DASHBOARD_ROUTE)return showWorkspace();
  if(NOTIFICATIONS_ROUTE)return notificationsView();
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
        toast((notice.title||'Новое уведомление')+(notice.message?' · '+notice.message:''));
        if(NOTIFICATIONS_ROUTE)void notificationsView();
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
  node.innerHTML='<div class="program-draft-heading"><span class="program-type-tag">'+(section?'Секция':'Элемент')+'</span><button type="button" class="button button-quiet button-small" data-remove-program-item>Удалить</button></div><label>Название<input data-program-field="title" maxlength="180" placeholder="'+(section?'Секция №1':'Например, Лекция')+'"></label><div class="program-time-grid"><label>Начало<input data-program-field="start_time" type="time"></label><label>Длительность, минут<input data-program-field="duration_minutes" type="number" min="1" max="1440" placeholder="45"></label></div><div class="program-time-grid"><label>Ведущий<input data-program-field="speaker_name" maxlength="160" placeholder="Имя ведущего"></label><label>Помещение<input data-program-field="room_name" maxlength="120" placeholder="Зал или помещение"></label></div><label>Максимум участников<input data-program-field="max_attendees" type="number" min="1" max="100000" value="100"></label><label>Описание<textarea data-program-field="description" rows="2" maxlength="2000" placeholder="Коротко о пункте программы"></textarea></label>'+(section?'<button type="button" class="button button-light button-small" data-add-program-child>Добавить элемент в секцию</button><div class="program-children" data-program-children></div>':'');
  return node;
}
function collectProgramDraft(list,parentKey=null) {
  const out=[];
  for(const row of [...list.children].filter(node=>node.matches('[data-program-item]'))){
    const get=(field)=>row.querySelector('[data-program-field="'+field+'"]')?.value?.trim()||'';
    const children=row.querySelector('[data-program-children]'),childRows=children?[...children.children].filter(node=>node.matches('[data-program-item]')):[];
    const v={title:get('title'),start_time:get('start_time'),duration_minutes:get('duration_minutes'),speaker_name:get('speaker_name'),room_name:get('room_name'),max_attendees:get('max_attendees'),description:get('description')};
    const hasData=v.title||v.start_time||v.duration_minutes||v.speaker_name||v.room_name||v.description||v.max_attendees!=='100'||childRows.length;
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
async function staffView() {
  try {
    const {assignments=[]}=await api('/api/staff/assignments');
    const details=await Promise.all(assignments.map(async(a)=>{
      const event=a.events||{};
      try{return {assignment:a,participants:(await api('/api/staff/events/'+encodeURIComponent(event.id)+'/participants')).participants||[]}}
      catch(error){return {assignment:a,participants:[],error:error.message}}
    }));
    const cards=details.map(({assignment:a,participants,error})=>{
      const event=a.events||{};
      return '<details class="workspace-card" open><summary><b>'+esc(event.title||'Мероприятие')+'</b> · '+esc(event.start_date||'')+' · '+esc(event.venues?.name||'')+'</summary><h4>Участники ('+participants.length+')</h4>'+(error?'<p class="connection-state">'+esc(error)+'</p>':participants.length?'<div class="scroll-table"><table class="data-table"><thead><tr><th>Билет</th><th>Посетитель</th><th>Место</th><th>Статус</th></tr></thead><tbody>'+participants.map(p=>'<tr><td>'+esc(p.ticket_number)+'</td><td>'+esc(p.users?.full_name||p.users?.email||'')+'</td><td>'+esc(p.seat_label||'—')+'</td><td>'+esc(p.status)+'</td></tr>').join('')+'</tbody></table></div>':empty('Список участников пока пуст.'))+'</details>';
    }).join('');
    $('#workspaceContent').innerHTML=(cards||'<div class="workspace-card">'+empty('Назначенных мероприятий пока нет.')+'</div>')+'<div class="workspace-card"><h3>Проверка билета</h3><form id="scanForm" class="inline-actions"><input name="ticket" placeholder="Номер билета FlowTix" required><button class="button button-dark">Проверить и отметить вход</button></form><p id="scanResult"></p></div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
async function moderatorView() {
  try {
    const [ev,complaints,reviews,users]=await Promise.all([api('/api/moderation/events'),api('/api/moderation/complaints'),api('/api/moderation/reviews'),api('/api/moderation/users')]);
    const userRows=(users.users||[]).map(u=>'<div class="workspace-row"><span><b>'+esc(u.full_name||u.email)+'</b><br><small>'+esc(u.email)+' · '+esc(u.role)+'</small></span><button class="button button-light button-small" data-mod-user-block="'+esc(u.id)+'" data-value="'+(!u.is_blocked)+'">'+(u.is_blocked?'Разблокировать':'Заблокировать')+'</button></div>').join('');
    const reviewRows=(reviews.reviews||[]).map(x=>'<div class="workspace-row"><span><b>'+esc(x.events?.title||'Мероприятие')+'</b> · '+esc(x.overall_rating)+'/5<br><small>'+esc(x.users?.email||'')+'</small><p>'+esc(x.comment||'')+'</p></span><button class="button button-danger button-small" data-mod-review="'+esc(x.id)+'">Удалить отзыв</button></div>').join('');
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Мероприятия на проверке</h3>'+((ev.events||[]).length?ev.events.map(e=>'<div class="workspace-row"><b>'+esc(e.title)+'</b><span>'+esc(e.users?.full_name||'Организатор')+'</span><div class="inline-actions"><button class="button button-accent button-small" data-moderate="'+esc(e.id)+'" data-status="published">Одобрить</button><button class="button button-danger button-small" data-moderate="'+esc(e.id)+'" data-status="rejected">Отклонить</button></div></div>').join(''):empty('Очередь проверки пуста.'))+'</div><div class="workspace-card"><h3>Жалобы</h3>'+((complaints.complaints||[]).length?complaints.complaints.map(c=>'<div class="workspace-row"><b>'+esc(c.reason)+'</b><span>'+esc(c.details)+'</span><select data-complaint="'+esc(c.id)+'">'+['new','in_review','resolved','rejected'].map(s=>'<option value="'+s+'" '+(c.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></div>').join(''):empty('Новых жалоб нет.'))+'</div><div class="workspace-card"><h3>Отзывы</h3>'+(reviewRows||empty('Отзывов пока нет.'))+'</div><div class="workspace-card"><h3>Пользователи</h3><p>Главный администратор защищён от действий модераторов.</p>'+(userRows||empty('Пользователей нет.'))+'</div>';
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
async function adminView() {
  const root=$('#workspaceContent');
  try{
    const loadAdminSection=async(path)=>{try{return await api(path)}catch(error){return {error:error.message}}};
    const [stats,users,logs,events,venues,tickets,payments,complaints,reviews,settings]=await Promise.all([
      loadAdminSection('/api/admin/statistics'),loadAdminSection('/api/admin/users'),loadAdminSection('/api/admin/audit-logs'),loadAdminSection('/api/admin/events'),
      loadAdminSection('/api/admin/venues'),loadAdminSection('/api/admin/tickets'),loadAdminSection('/api/admin/payments'),loadAdminSection('/api/admin/complaints'),
      loadAdminSection('/api/admin/reviews'),loadAdminSection('/api/admin/settings')
    ]);
    const loadErrors=[stats,users,logs,events,venues,tickets,payments,complaints,reviews,settings].filter(x=>x.error).map(x=>esc(x.error));
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
    const userRows=(users.users||[]).map(x=>'<tr><td>'+esc(x.full_name||'—')+'<br><small>'+esc(x.email)+'</small></td><td>'+rolePicker(x.id,x.role)+'</td><td>'+(x.is_blocked?'Заблокирован':'Активен')+'</td><td><button class="button button-light button-small" data-block="'+esc(x.id)+'" data-value="'+(!x.is_blocked)+'" '+(x.id===user.id?'disabled':'')+'>'+(x.is_blocked?'Разблокировать':'Заблокировать')+'</button></td></tr>').join('');
    const eventRows=(events.events||[]).map(x=>'<tr><td>'+esc(x.title)+'<br><small>'+esc(x.users?.email||'')+'</small></td><td>'+esc(x.start_date||'')+'</td><td><select data-event-status="'+esc(x.id)+'">'+['draft','pending_moderation','published','rejected','cancelled','completed'].map(s=>'<option value="'+s+'" '+(x.status===s?'selected':'')+'>'+esc(eventStatusLabel(s))+'</option>').join('')+'</select></td><td>'+esc((x.available_seats??'—')+' / '+(x.total_seats??'—'))+'</td></tr>').join('');
    const venueRows=(venues.venues||[]).map(v=>'<details class="workspace-row"><summary><b>'+esc(v.name)+'</b> · '+esc(v.city)+'</summary><form data-admin-venue="'+esc(v.id)+'" class="form-grid"><label>Название<input name="name" value="'+esc(v.name)+'" required></label><label>Город<input name="city" value="'+esc(v.city)+'" required></label><label class="wide">Адрес<input name="address" value="'+esc(v.address)+'" required></label><label class="wide">Описание<textarea name="description">'+esc(v.description||'')+'</textarea></label><button class="button button-light button-small">Сохранить</button></form></details>').join('');
    const ticketRows=(tickets.tickets||[]).map(t=>'<tr><td>'+esc(t.ticket_number)+'</td><td>'+esc(t.events?.title||'—')+'<br><small>'+esc(t.users?.email||'')+'</small></td><td>'+esc(t.status)+'</td><td>'+esc(money(t.price_paid))+'</td><td>'+(t.status==='valid'?'<button class="button button-danger button-small" data-cancel-ticket="'+esc(t.id)+'">Аннулировать</button>':'—')+'</td></tr>').join('');
    const paymentRows=(payments.payments||[]).map(p=>'<tr><td>'+esc(new Date(p.created_at).toLocaleString('ru'))+'</td><td>'+esc(p.users?.email||'—')+'</td><td>'+esc(p.tickets?.events?.title||p.tickets?.ticket_number||'—')+'</td><td>'+esc(money(p.amount))+'</td><td>'+esc(p.status)+' · '+esc(p.payment_method||'—')+'</td></tr>').join('');
    const complaintRows=(complaints.complaints||[]).map(x=>'<tr><td>'+esc(x.reason)+'<br><small>'+esc(x.details||'')+'</small></td><td>'+esc(x.users?.email||'—')+'</td><td><select data-complaint="'+esc(x.id)+'">'+['new','in_review','resolved','rejected'].map(s=>'<option value="'+s+'" '+(x.status===s?'selected':'')+'>'+s+'</option>').join('')+'</select></td></tr>').join('');
    const reviewRows=(reviews.reviews||[]).map(x=>'<tr><td>'+esc(x.events?.title||'—')+'</td><td>'+esc(x.users?.email||'—')+'</td><td>'+esc(x.overall_rating)+'/5</td><td>'+esc(x.comment||'')+'</td><td><button class="button button-danger button-small" data-delete-review="'+esc(x.id)+'">Удалить</button></td></tr>').join('');
    const s=settings.settings||{};
    const visualPaymentsEnabled=s.visual_payments_enabled===true;
    const settingsForm='<form id="adminSettingsForm" class="form-grid"><label>Название сервиса<input name="site_name" value="'+esc(s.site_name||'FlowTix')+'" required></label><label>Почта поддержки<input name="support_email" type="email" value="'+esc(s.support_email||'')+'"></label><label>Режим обслуживания<select name="maintenance_mode"><option value="false" '+(s.maintenance_mode?'':'selected')+'>Выключен</option><option value="true" '+(s.maintenance_mode?'selected':'')+'>Включён</option></select></label><div class="wide visual-payment-option"><label class="admin-switch"><input type="checkbox" name="visual_payments_enabled" '+(visualPaymentsEnabled?'checked':'')+'><span class="admin-switch-track" aria-hidden="true"></span><span class="admin-switch-copy"><b>Активировать визуальные платежи</b><small>При включении билет на платное мероприятие выдаётся без списания денег.</small></span></label><p class="payment-provider-note">Если выключить режим, платные регистрации будут недоступны, пока к FlowTix не подключён платёжный провайдер.</p></div><div class="wide"><button class="button button-accent" type="submit">Сохранить настройки</button></div></form>';
    const logsHtml=(logs.logs||[]).map(x=>'<tr><td>'+esc(new Date(x.created_at).toLocaleString('ru'))+'</td><td>'+esc(x.actor_name||'Система')+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.entity_type)+' '+esc(x.entity_id||'')+'</td></tr>').join('');
    const panels={
      users:'<div class="workspace-card"><h3>Пользователи и роли</h3><p>Роли назначает только главный администратор.</p><div class="scroll-table"><table class="data-table"><thead><tr><th>Участник</th><th>Роль</th><th>Доступ</th><th></th></tr></thead><tbody>'+userRows+'</tbody></table></div></div>',
      events:'<div class="workspace-card"><h3>Мероприятия</h3><div class="scroll-table"><table class="data-table"><thead><tr><th>Мероприятие / организатор</th><th>Дата</th><th>Статус</th><th>Места</th></tr></thead><tbody>'+eventRows+'</tbody></table></div></div>',
      venues:'<div class="workspace-card"><h3>Площадки</h3>'+(venueRows||empty('Площадок пока нет.'))+'</div>',
      tickets:'<div class="workspace-card"><h3>Билеты</h3>'+(tickets.error?'<p class="connection-state">'+esc(tickets.error)+'</p>':'<div class="scroll-table"><table class="data-table"><thead><tr><th>Номер</th><th>Событие / владелец</th><th>Статус</th><th>Цена</th><th></th></tr></thead><tbody>'+ticketRows+'</tbody></table></div>')+'</div>',
      payments:'<div class="workspace-card"><h3>Платежи</h3><p>Платёжные записи для сверки. Статус не меняется вручную без платёжного провайдера.</p><div class="scroll-table"><table class="data-table"><thead><tr><th>Дата</th><th>Аккаунт</th><th>Билет</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>'+paymentRows+'</tbody></table></div></div>',
      complaints:'<div class="workspace-card"><h3>Жалобы</h3><div class="scroll-table"><table class="data-table"><thead><tr><th>Обращение</th><th>Автор</th><th>Статус</th></tr></thead><tbody>'+complaintRows+'</tbody></table></div></div>',
      reviews:'<div class="workspace-card"><h3>Отзывы</h3><div class="scroll-table"><table class="data-table"><thead><tr><th>Событие</th><th>Автор</th><th>Оценка</th><th>Текст</th><th></th></tr></thead><tbody>'+reviewRows+'</tbody></table></div></div>',
      settings:'<div class="workspace-card"><h3>Настройки системы</h3>'+settingsForm+'</div>',
      logs:'<div class="workspace-card"><h3>Журнал действий</h3><div class="scroll-table"><table class="data-table"><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Объект</th></tr></thead><tbody>'+logsHtml+'</tbody></table></div></div>'
    };
    const tabs=Object.entries({users:'Аккаунты',events:'Мероприятия',venues:'Площадки',tickets:'Билеты',payments:'Платежи',complaints:'Жалобы',reviews:'Отзывы',settings:'Настройки',logs:'Журнал'});
    root.innerHTML=loadWarning+'<div class="stats-grid">'+[['Пользователи',stats.users??'—'],['Мероприятия',stats.events??'—'],['Билеты',stats.tickets??'—'],['Выручка',stats.error?'—':money(stats.revenue)],['Открытые жалобы',stats.openComplaints??'—']].map(x=>'<div class="workspace-card"><small>'+esc(x[0])+'</small><h3>'+esc(x[1])+'</h3></div>').join('')+'</div><div id="adminTabs" class="category-bar">'+tabs.map(([key,label],i)=>'<button type="button" class="category '+(!i?'active':'')+'" data-admin-tab="'+key+'">'+label+'</button>').join('')+'</div><div id="adminPanel">'+panels.users+'</div>';
    const panel=$('#adminPanel',root);
    $('#adminTabs',root).onclick=(e)=>{const b=e.target.closest('[data-admin-tab]');if(!b)return;$$('[data-admin-tab]',root).forEach(x=>x.classList.toggle('active',x===b));panel.innerHTML=panels[b.dataset.adminTab]||''};
    root.onchange=async(e)=>{
      if(e.target.matches('[data-event-status]')){try{await api('/api/admin/events/'+e.target.dataset.eventStatus,{method:'PATCH',body:JSON.stringify({status:e.target.value})});toast('Статус мероприятия обновлён')}catch(x){toast(x.message);await adminView()}}
        };
    root.onclick=async(e)=>{
      const toggle=e.target.closest('[data-role-picker-toggle]');
      if(toggle){const picker=toggle.closest('[data-role-picker]');const open=!picker.classList.contains('is-open');root.querySelectorAll('.role-picker.is-open').forEach(x=>{x.classList.remove('is-open');x.querySelector('[data-role-picker-toggle]')?.setAttribute('aria-expanded','false');x.querySelector('.role-picker-menu').hidden=true});if(open){picker.classList.add('is-open');toggle.setAttribute('aria-expanded','true');picker.querySelector('.role-picker-menu').hidden=false}return}
      const roleOption=e.target.closest('[data-role-picker-option]');
      if(roleOption){const picker=roleOption.closest('[data-role-picker]');picker.classList.remove('is-open');picker.querySelector('[data-role-picker-toggle]').setAttribute('aria-expanded','false');picker.querySelector('.role-picker-menu').hidden=true;try{await api('/api/admin/users/'+roleOption.dataset.roleUser+'/role',{method:'PATCH',body:JSON.stringify({role:roleOption.dataset.role})});toast('Роль обновлена');await adminView()}catch(x){toast(x.message);await adminView()}return}
      if(!e.target.closest('[data-role-picker]'))root.querySelectorAll('.role-picker.is-open').forEach(x=>{x.classList.remove('is-open');x.querySelector('[data-role-picker-toggle]')?.setAttribute('aria-expanded','false');x.querySelector('.role-picker-menu').hidden=true});
      const block=e.target.closest('[data-block]');if(block){try{await api('/api/admin/users/'+block.dataset.block+'/block',{method:'PATCH',body:JSON.stringify({blocked:block.dataset.value==='true'})});toast('Доступ обновлён');await adminView()}catch(x){toast(x.message)}return}
      const cancel=e.target.closest('[data-cancel-ticket]');if(cancel){try{await api('/api/admin/tickets/'+cancel.dataset.cancelTicket+'/cancel',{method:'PATCH'});toast('Билет аннулирован');await adminView()}catch(x){toast(x.message)}return}
      const review=e.target.closest('[data-delete-review]');if(review&&confirm('Удалить отзыв?')){try{await api('/api/admin/reviews/'+review.dataset.deleteReview,{method:'DELETE'});toast('Отзыв удалён');await adminView()}catch(x){toast(x.message)}}
    };
    root.onsubmit=async(e)=>{
      if(e.target.matches('[data-admin-venue]')){e.preventDefault();try{await api('/api/admin/venues/'+e.target.dataset.adminVenue,{method:'PATCH',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Площадка обновлена');await adminView()}catch(x){toast(x.message)}}
      if(e.target.id==='adminSettingsForm'){e.preventDefault();const data=Object.fromEntries(new FormData(e.target));data.maintenance_mode=data.maintenance_mode==='true';data.visual_payments_enabled=e.target.elements.visual_payments_enabled.checked;try{await api('/api/admin/settings',{method:'PATCH',body:JSON.stringify(data)});toast('Настройки сохранены');await adminView()}catch(x){toast(x.message)}}
    };
  }catch(error){root.innerHTML='<div class="workspace-card"><p class="connection-state">'+esc(error.message)+'</p></div>'}
}
document.addEventListener('click',async(e)=>{
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
  if(e.target.matches('[data-complaint]')){try{await api('/api/moderation/complaints/'+e.target.dataset.complaint,{method:'PATCH',body:JSON.stringify({status:e.target.value})});toast('Статус жалобы обновлён')}catch(x){toast(x.message)}}
});
document.addEventListener('submit',async(e)=>{
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
  if(e.target.id==='scanForm'){e.preventDefault();try{const x=await api('/api/staff/tickets/'+encodeURIComponent(new FormData(e.target).get('ticket'))+'/check-in',{method:'POST'});$('#scanResult').textContent='Вход отмечен · '+x.ticket.ticket_number;toast('Билет проверен')}catch(x){$('#scanResult').textContent=x.message}}
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
  if(!ACCOUNT_ROUTE)await loadEvents();
  if(ACCOUNT_ROUTE){if(hasSession)renderAccountRoute();else authOpen('login')}
}
init();
