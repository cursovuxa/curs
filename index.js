const API_BASE = 'https://cursa.onrender.com';
const SUPABASE_URL = 'https://rpsvuygarxlnqpxtwuzq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hIAivAUZ0fCx9KlHsj4YVg_kc2TkPzB';
let supabaseAuth = null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const tokenKey = 'flowtix_access_token';
let user = null;
let events = [];
let categories = [];
let activeCategory = '';
let searchTimer;
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
const money = (amount) => Number(amount || 0) === 0 ? 'Бесплатно' : new Intl.NumberFormat('ru-RU').format(Number(amount)) + ' ₸';
let toastTimer;
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
function empty(message = 'Когда появятся данные, они отобразятся в этом разделе.') { return '<div class="empty-state"><span class="empty-star">✳</span><h3>Пока здесь тихо</h3><p>'+esc(message)+'</p></div>'; }
function setBusy(button, busy, text) { if (!button) return; button.disabled = busy; if (busy) { button.dataset.label = button.textContent; button.textContent = text || 'Сохраняем…'; } else if (button.dataset.label) button.textContent = button.dataset.label; }
function signedIn() { return Boolean(user && sessionStorage.getItem(tokenKey)); }
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
  const price=event.current_price ?? event.base_price;
  return '<article class="event-card"><div class="event-image">'+(image?'<img src="'+esc(image)+'" alt="" loading="lazy">':'')+
    '<span class="event-category">'+esc(event.event_categories?.name || event.category || 'Мероприятие')+'</span><button class="fav-button '+(fav?'active':'')+'" data-favorite="'+id+'" aria-label="Избранное">'+(fav?'♥':'♡')+'</button></div>'+
    '<div class="event-info"><div class="event-date">'+esc(date || 'Дата уточняется')+'</div><h3>'+title+'</h3><div class="event-place">⌖ '+esc(place || 'Площадка уточняется')+'</div>'+
    '<div class="event-foot"><span class="event-price">'+esc(money(price))+'</span><div class="event-actions"><button class="button button-light" data-details="'+id+'">Подробнее</button><button class="button button-dark" data-register="'+id+'">Участвовать</button></div></div></div></article>';
}
function renderEvents() {
  const query=$('#searchInput').value.trim().toLocaleLowerCase('ru');
  const city=$('#cityInput').value.trim().toLocaleLowerCase('ru');
  const filtered=events.filter((e)=>{
    const text=[e.title,e.description,e.event_categories?.name,e.venues?.city,e.venues?.name].join(' ').toLocaleLowerCase('ru');
    return (!query||text.includes(query))&&(!city||(e.venues?.city||'').toLocaleLowerCase('ru').includes(city))&&(!activeCategory||e.category_id===activeCategory);
  });
  $('#eventCount').textContent=filtered.length+' '+plural(filtered.length,['событие','события','событий']);
  $('#eventsGrid').innerHTML=filtered.length?filtered.map(eventCard).join(''):empty(events.length?'По этим фильтрам событий нет.':'Опубликованных мероприятий пока нет.');
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
function openEvent(id) {
  api('/api/events/'+encodeURIComponent(id)).then(({event:e})=>{
    const image=e.cover_image||'';
    $('#eventDialog').innerHTML='<div class="event-hero">'+(image?'<img src="'+esc(image)+'" alt="">':'')+'<button class="dialog-close" data-close="eventModal" aria-label="Закрыть">×</button></div><div class="event-dialog-content"><p class="eyebrow dark-eyebrow">'+esc(e.event_categories?.name||'Мероприятие')+'</p><h2>'+esc(e.title)+'</h2><p><b>'+esc([e.start_date,e.start_time].filter(Boolean).join(' · '))+'</b> · '+esc([e.venues?.city,e.venues?.name,e.venues?.address].filter(Boolean).join(', '))+'</p><p>'+esc(e.description||'Описание не добавлено.')+'</p><p>'+esc(money(e.current_price??e.base_price))+' · Осталось мест: '+esc(e.available_seats??'—')+'</p><div class="workspace-card"><h3>Расписание</h3>'+((e.event_program||[]).length?e.event_program.map(x=>'<p><b>'+esc([x.start_time,x.end_time].filter(Boolean).join('–'))+'</b> '+esc(x.title)+' '+esc(x.speaker_name||'')+'</p>').join(''): '<p>Расписание ещё не опубликовано.</p>')+'</div><div class="inline-actions"><button class="button button-dark" data-register="'+esc(e.id)+'">Участвовать</button><button class="button button-light" data-report="'+esc(e.id)+'">Пожаловаться</button></div><div id="reportForm"></div></div>';
    $('#eventModal').hidden=false;
  }).catch(e=>toast(e.message));
}
async function register(id) {
  if(!signedIn())return authOpen();
  try { const result=await api('/api/registrations',{method:'POST',body:JSON.stringify({eventId:id})}); toast('Готово! Билет '+result.ticket.ticket_number); await loadEvents(); }
  catch(error){toast(error.message)}
}
async function toggleFavorite(id) {
  if(!signedIn())return authOpen();
  const has=(user.favorites||[]).includes(id);
  try {
    await api('/api/favorites/'+encodeURIComponent(id),{method:has?'DELETE':'POST'});
    user.favorites=has?user.favorites.filter(x=>x!==id):[...(user.favorites||[]),id];
    renderEvents();toast(has?'Убрали из избранного':'Добавили в избранное');
  } catch(error){toast(error.message)}
}
async function loadSession() {
  const token=sessionStorage.getItem(tokenKey); if(!token)return;
  try {
    const result=await api('/api/me'); user={...result.user,favorites:[]};
    applyTheme(user.preferences?.theme||localStorage.getItem(themeKey)||'rose',{save:!user.preferences?.theme});
    const fav=await api('/api/favorites');user.favorites=(fav.favorites||[]).map(x=>x.event_id);
    $('#accountName').textContent=user.full_name||user.email;
    $('#authOpen').textContent='Выйти';
    $('#workspaceNav').hidden=false;
    $('#settingsOpen').hidden=false;
  } catch {
    sessionStorage.removeItem(tokenKey);user=null;
    $('#accountName').textContent='Гость';$('#authOpen').textContent='Войти';
    $('#workspaceNav').hidden=true;$('#settingsOpen').hidden=true;
  }
}
function showWorkspace() {
  if(!signedIn())return authOpen();
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
  $('#workspaceTitle').textContent='Настройки профиля';
  $('#workspaceRefresh').textContent='← В кабинет';
  $('#workspaceContent').innerHTML='<div class="settings-layout"><div class="workspace-card settings-intro"><p class="eyebrow dark-eyebrow">ТВОЙ FLOWTIX</p><h3>Профиль и предпочтения</h3><p>Добавь немного информации о себе и выбери оформление, которое тебе подходит.</p></div><div class="workspace-card"><form id="profileSettingsForm" class="form-grid settings-form"><label>Имя<input name="full_name" value="'+esc(user.full_name||'')+'" required maxlength="120" autocomplete="name"></label><label>Email аккаунта<input value="'+esc(user.email||'')+'" disabled></label><label>Город<input name="city" value="'+esc(user.city||'')+'" maxlength="100" placeholder="Например, Алматы"></label><label>Телефон<input name="phone" type="tel" value="'+esc(user.phone||'')+'" maxlength="40" autocomplete="tel" placeholder="+7 ..."></label><label class="wide">О себе<textarea name="about" rows="4" maxlength="1000" placeholder="Расскажи, какие события тебе интересны">'+esc(user.preferences?.about||'')+'</textarea></label><div class="wide settings-theme"><div><b>Оформление сайта</b><p>Выбранная тема сохранится в твоём аккаунте.</p></div>'+themePickerMarkup()+'</div><div class="wide form-actions"><button class="button button-accent" type="submit">Сохранить профиль</button></div></form></div></div>';
  $('#workspace').scrollIntoView({behavior:'smooth'});
}
async function visitorView() {
  try {
    const [tickets,fav,notifications]=await Promise.all([api('/api/tickets/mine'),api('/api/favorites'),api('/api/notifications')]);
    const ts=tickets.tickets||[], fs=fav.favorites||[], ns=notifications.notifications||[];
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Мои билеты</h3>'+ (ts.length?'<div class="ticket-list">'+ts.map(t=>'<p><b>'+esc(t.events?.title||'Мероприятие')+'</b> · '+esc(t.ticket_number)+' <span class="status-pill">'+esc(t.status)+'</span></p>').join('')+'</div>':empty('Зарегистрируйтесь на событие — билет появится здесь.'))+'</div><div class="workspace-card"><h3>Избранное ('+fs.length+')</h3>'+ (fs.length?fs.map(x=>'<p>'+esc(x.events?.title||'Мероприятие')+'</p>').join(''):empty('Отмечайте сердцем мероприятия, чтобы не потерять.'))+'</div><div class="workspace-card"><h3>Оставить отзыв</h3>'+ (ts.length?'<form id="reviewForm" class="form-grid"><label>Событие<select name="eventId">'+ts.map(t=>'<option value="'+esc(t.event_id)+'">'+esc(t.events?.title||'Мероприятие')+'</option>').join('')+'</select></label>'+['orgRating','venueRating','programRating','staffRating'].map((key,i)=>'<label>'+['Организатор','Площадка','Программа','Команда'][i]+'<select name="'+key+'"><option value="5">5 — отлично</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1 — плохо</option></select></label>').join('')+'<label class="wide">Комментарий<textarea name="comment" rows="3" maxlength="3000"></textarea></label><button class="button button-dark">Опубликовать отзыв</button></form>':empty('Для отзыва сначала нужен билет на событие.'))+'</div><div class="workspace-card"><h3>Уведомления ('+ns.length+')</h3>'+ (ns.length?ns.map(n=>'<p><b>'+esc(n.title)+'</b> · '+esc(n.message)+'</p>').join(''):empty('Новых уведомлений нет.'))+'</div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
async function organizerView() {
  try {
    const [ev,venues,cats,registrations,employees]=await Promise.all([
      api('/api/organizer/events'),api('/api/organizer/venues'),api('/api/categories'),
      api('/api/organizer/registrations'),api('/api/organizer/employees')
    ]);
    const staff=employees.employees||[];
    const myEvents=ev.events||[];
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Новое мероприятие</h3><form id="createEventForm" class="form-grid"><label>Название<input name="title" required maxlength="180"></label><label>Категория<select name="category_id">'+(cats.categories||[]).map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></label><label>Площадка<select name="venue_id"><option value="">Без площадки</option>'+(venues.venues||[]).map(v=>'<option value="'+esc(v.id)+'">'+esc(v.name+' · '+v.city)+'</option>').join('')+'</select></label><label>Дата<input name="start_date" type="date" required></label><label>Начало<input name="start_time" type="time" required></label><label>Окончание<input name="end_time" type="time" required></label><label>Вместимость<input name="total_seats" type="number" min="1" required></label><label>Цена, ₸<input name="base_price" type="number" min="0" value="0"></label><label class="wide">Описание<textarea name="description" rows="3"></textarea></label><div class="wide form-actions"><button class="button button-dark">Отправить на модерацию</button></div></form></div><div class="workspace-card"><h3>Мои мероприятия ('+myEvents.length+')</h3>'+(myEvents.length?myEvents.map(e=>'<details class="event-tools"><summary><b>'+esc(e.title)+'</b> · <span class="status-pill">'+esc(e.status)+'</span></summary><div class="tool-grid"><form class="program-form" data-event="'+esc(e.id)+'"><b>Добавить пункт расписания</b><input name="title" placeholder="Тема / пункт программы" required><div class="inline-actions"><input name="start_time" type="time" required><input name="end_time" type="time" required></div><input name="speaker_name" placeholder="Спикер"><input name="room_name" placeholder="Зал"><button class="button button-light button-small">Добавить в расписание</button></form><form class="assign-form" data-event="'+esc(e.id)+'"><b>Назначить сотрудника</b><select name="employeeId" required>'+staff.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.users?.full_name||s.users?.email||'Сотрудник')+' · '+esc(s.position)+'</option>').join('')+'</select><input name="role" placeholder="Роль на событии" value="Контролёр"><button class="button button-light button-small">Назначить</button></form><form class="notify-form" data-event="'+esc(e.id)+'"><b>Уведомить участников</b><input name="title" placeholder="Заголовок" value="'+esc(e.title)+'"><textarea name="message" placeholder="Текст уведомления" required></textarea><button class="button button-light button-small">Отправить уведомление</button></form></div></details>').join(''):empty('Создайте первое событие.'))+'</div><div class="workspace-card"><h3>Участники ('+(registrations.registrations||[]).length+')</h3>'+((registrations.registrations||[]).length?(registrations.registrations||[]).map(r=>'<p>'+esc(r.users?.full_name||r.users?.email)+' · '+esc(r.events?.title)+' · '+esc(r.ticket_number)+'</p>').join(''):empty('Регистраций пока нет.'))+'</div><div class="workspace-card"><h3>Ваши площадки ('+(venues.venues||[]).length+')</h3><form id="createVenueForm" class="form-grid"><label>Название<input name="name" required></label><label>Город<input name="city" required></label><label class="wide">Адрес<input name="address" required></label><label class="wide">Описание<textarea name="description"></textarea></label><div class="wide form-actions"><button class="button button-light">Добавить площадку</button></div></form></div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
async function staffView() {
  try {
    const {assignments=[]}=await api('/api/staff/assignments');
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Назначенные мероприятия</h3>'+(assignments.length?assignments.map(a=>'<p><b>'+esc(a.events?.title)+'</b> · '+esc(a.events?.start_date)+' · '+esc(a.events?.venues?.name)+'</p>').join(''):empty('Назначений пока нет.'))+'</div><div class="workspace-card"><h3>Проверка билета</h3><form id="scanForm" class="inline-actions"><input name="ticket" placeholder="Номер билета FlowTix" required><button class="button button-dark">Проверить и отметить вход</button></form><p id="scanResult"></p></div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
async function moderatorView() {
  try {
    const [ev,complaints]=await Promise.all([api('/api/moderation/events'),api('/api/moderation/complaints')]);
    $('#workspaceContent').innerHTML='<div class="workspace-card"><h3>Мероприятия на проверке</h3>'+((ev.events||[]).length?ev.events.map(e=>'<div class="workspace-row"><b>'+esc(e.title)+'</b><span>'+esc(e.users?.full_name||'Организатор')+'</span><div class="inline-actions"><button class="button button-accent button-small" data-moderate="'+esc(e.id)+'" data-status="published">Одобрить</button><button class="button button-danger button-small" data-moderate="'+esc(e.id)+'" data-status="rejected">Отклонить</button></div></div>').join(''):empty('Очередь проверки пуста.'))+'</div><div class="workspace-card"><h3>Жалобы</h3>'+((complaints.complaints||[]).length?complaints.complaints.map(c=>'<div class="workspace-row"><b>'+esc(c.reason)+'</b><span>'+esc(c.details)+'</span><select data-complaint="'+esc(c.id)+'"><option value="in_review">На рассмотрении</option><option value="resolved">Решена</option><option value="rejected">Отклонена</option></select></div>').join(''):empty('Новых жалоб нет.'))+'</div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
async function adminView() {
  try {
    const [stats,users,logs]=await Promise.all([api('/api/admin/statistics'),api('/api/admin/users'),api('/api/admin/audit-logs')]);
    $('#workspaceContent').innerHTML='<div class="stats-grid">'+[['Пользователи',stats.users],['Мероприятия',stats.events],['Билеты',stats.tickets],['Выручка',money(stats.revenue)],['Открытые жалобы',stats.openComplaints]].map(x=>'<div class="workspace-card"><small>'+esc(x[0])+'</small><h3>'+esc(x[1])+'</h3></div>').join('')+'</div><div class="workspace-card"><h3>Пользователи и роли</h3><div class="scroll-table"><table class="data-table"><thead><tr><th>Пользователь</th><th>Роль</th><th>Доступ</th><th></th></tr></thead><tbody>'+users.users.map(u=>'<tr><td>'+esc(u.full_name)+'<br>'+esc(u.email)+'</td><td><select data-role-user="'+esc(u.id)+'">'+['visitor','organizer','staff','moderator','admin'].map(r=>'<option '+(u.role===r?'selected':'')+'>'+r+'</option>').join('')+'</select></td><td>'+ (u.is_blocked?'Заблокирован':'Активен')+'</td><td><button class="button button-light button-small" data-block="'+esc(u.id)+'" data-value="'+(!u.is_blocked)+'">'+(u.is_blocked?'Разблокировать':'Заблокировать')+'</button></td></tr>').join('')+'</tbody></table></div></div><div class="workspace-card"><h3>Журнал действий</h3><div class="scroll-table"><table class="data-table"><thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Объект</th></tr></thead><tbody>'+logs.logs.map(x=>'<tr><td>'+esc(new Date(x.created_at).toLocaleString('ru'))+'</td><td>'+esc(x.actor_name||'Система')+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.entity_type)+' '+esc(x.entity_id)+'</td></tr>').join('')+'</tbody></table></div></div>';
  }catch(e){$('#workspaceContent').innerHTML='<p class="connection-state">'+esc(e.message)+'</p>'}
}
document.addEventListener('click',async(e)=>{
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
  const reg=e.target.closest('[data-register]');if(reg)return register(reg.dataset.register);
  const close=e.target.closest('[data-close]');if(close){$('#'+close.dataset.close).hidden=true;return}
  const report=e.target.closest('[data-report]');if(report){$('#reportForm').innerHTML='<form id="complaintForm" class="form-grid"><input type="hidden" name="targetId" value="'+esc(report.dataset.report)+'"><label>Причина<input name="reason" required></label><label class="wide">Подробности<textarea name="details" required></textarea></label><button class="button button-dark">Отправить жалобу</button></form>';return}
  const moderate=e.target.closest('[data-moderate]');if(moderate){try{await api('/api/moderation/events/'+moderate.dataset.moderate,{method:'PATCH',body:JSON.stringify({status:moderate.dataset.status})});toast('Решение сохранено');moderatorView()}catch(x){toast(x.message)}return}
  const block=e.target.closest('[data-block]');if(block){try{await api('/api/admin/users/'+block.dataset.block+'/block',{method:'PATCH',body:JSON.stringify({blocked:block.dataset.value==='true'})});toast('Доступ обновлён');adminView()}catch(x){toast(x.message)}return}
});
document.addEventListener('change',async(e)=>{
  if(e.target.matches('[data-category]')){activeCategory=e.target.dataset.category;$$('[data-category]').forEach(x=>x.classList.toggle('active',x===e.target));renderEvents()}
  if(e.target.matches('[data-role-user]')){try{await api('/api/admin/users/'+e.target.dataset.roleUser+'/role',{method:'PATCH',body:JSON.stringify({role:e.target.value})});toast('Роль обновлена')}catch(x){toast(x.message)}}
  if(e.target.matches('[data-complaint]')){try{await api('/api/moderation/complaints/'+e.target.dataset.complaint,{method:'PATCH',body:JSON.stringify({status:e.target.value})});toast('Статус жалобы обновлён')}catch(x){toast(x.message)}}
});
document.addEventListener('submit',async(e)=>{
  if(e.target.id==='searchForm'){e.preventDefault();loadEvents();$('#events').scrollIntoView({behavior:'smooth'});}
  if(e.target.id==='authForm'){e.preventDefault();const mode=$('[data-auth].active').dataset.auth;const button=$('#authSubmit');setBusy(button,true);$('#authError').textContent='';
    try{const result=await api('/api/auth/'+mode,{method:'POST',body:JSON.stringify({fullName:$('#name').value.trim(),email:$('#email').value.trim(),password:$('#password').value})});if(!result.accessToken){$('#authError').textContent=result.message;return}sessionStorage.setItem(tokenKey,result.accessToken);await loadSession();authClose();toast(mode==='login'?'Вход выполнен':'Аккаунт создан');}
    catch(x){$('#authError').textContent=x.message}finally{setBusy(button,false)}
  }
  if(e.target.id==='profileSettingsForm'){e.preventDefault();const button=e.target.querySelector('[type="submit"]');setBusy(button,true,'Сохраняем профиль…');try{const data=Object.fromEntries(new FormData(e.target));const result=await api('/api/me/profile',{method:'PATCH',body:JSON.stringify(data)});user={...user,...result.user};$('#accountName').textContent=user.full_name||user.email;toast('Профиль сохранён')}catch(error){toast(error.message)}finally{setBusy(button,false)}}
  if(e.target.id==='reviewForm'){e.preventDefault();try{await api('/api/reviews',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Спасибо за отзыв');visitorView()}catch(x){toast(x.message)}}
  if(e.target.id==='createEventForm'){e.preventDefault();const body=Object.fromEntries(new FormData(e.target));body.total_seats=Number(body.total_seats);body.base_price=Number(body.base_price||0);try{await api('/api/events',{method:'POST',body:JSON.stringify(body)});toast('Мероприятие отправлено модератору');organizerView()}catch(x){toast(x.message)}}
  if(e.target.id==='createVenueForm'){e.preventDefault();try{await api('/api/venues',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Площадка добавлена');organizerView()}catch(x){toast(x.message)}}
  if(e.target.matches('.program-form')){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await api('/api/events/'+e.target.dataset.event+'/program',{method:'POST',body:JSON.stringify(d)});toast('Расписание обновлено');}catch(x){toast(x.message)}}
  if(e.target.matches('.assign-form')){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await api('/api/organizer/events/'+e.target.dataset.event+'/staff',{method:'POST',body:JSON.stringify(d)});toast('Сотрудник назначен');}catch(x){toast(x.message)}}
  if(e.target.matches('.notify-form')){e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{const r=await api('/api/organizer/events/'+e.target.dataset.event+'/notify',{method:'POST',body:JSON.stringify(d)});toast('Уведомление отправлено: '+r.sent)}catch(x){toast(x.message)}}
  if(e.target.id==='scanForm'){e.preventDefault();try{const x=await api('/api/staff/tickets/'+encodeURIComponent(new FormData(e.target).get('ticket'))+'/check-in',{method:'POST'});$('#scanResult').textContent='Вход отмечен · '+x.ticket.ticket_number;toast('Билет проверен')}catch(x){$('#scanResult').textContent=x.message}}
  if(e.target.id==='complaintForm'){e.preventDefault();if(!signedIn())return authOpen();const d=Object.fromEntries(new FormData(e.target));try{await api('/api/complaints',{method:'POST',body:JSON.stringify({targetType:'event',targetId:d.targetId,reason:d.reason,details:d.details})});$('#eventModal').hidden=true;toast('Жалоба отправлена модератору')}catch(x){toast(x.message)}}
});
$('#authOpen').addEventListener('click',async()=>{if(signedIn()){sessionStorage.removeItem(tokenKey);if(supabaseAuth)await supabaseAuth.auth.signOut();user=null;$('#accountName').textContent='Гость';$('#authOpen').textContent='Войти';$('#workspaceNav').hidden=true;$('#settingsOpen').hidden=true;$('#workspace').hidden=true;renderEvents();toast('Вы вышли из аккаунта')}else authOpen()});

$$('[data-close]').forEach(x=>x.addEventListener('click',()=>$('#'+x.dataset.close).hidden=true));
$('#workspaceNav').addEventListener('click',(e)=>{e.preventDefault();showWorkspace()});
$('#workspaceRefresh').addEventListener('click',showWorkspace);
$('#settingsOpen').addEventListener('click',showSettings);
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
  if(event.key==='Escape')$$('[data-theme-menu]:not([hidden])').forEach((menu)=>{
    menu.hidden=true;
    menu.parentElement.querySelector('[data-theme-select-button]')?.setAttribute('aria-expanded','false');
  });
});
const GOOGLE_OAUTH_CLIENT_ID='69394596232-2jjcm977md330t3e49urjvuotep57f68.apps.googleusercontent.com';
let googleNonce='';
let googleIdentityPromise=null;
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
        await loadSession();
        authClose();
        toast('Вход выполнен через Google');
      }catch(error){$('#authError').textContent=error.message||'Не удалось войти через Google'}
    }
  });
  google.accounts.id.renderButton(container,{
    type:'standard',theme:'outline',size:'large',text:'continue_with',
    shape:'pill',logo_alignment:'left',locale:'ru',
    width:Math.min(container.clientWidth||360,400)
  });
}
$('#categoryBar').addEventListener('click',(e)=>{const b=e.target.closest('[data-category]');if(b){activeCategory=b.dataset.category;$$('[data-category]').forEach(x=>x.classList.toggle('active',x===b));renderEvents()}});
$('#searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadEvents,250)});
$('#cityInput').addEventListener('change',loadEvents);
$('#footerYear').textContent=new Date().getFullYear();
async function init(){
  try {
    const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.57.4');
    supabaseAuth=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{flowType:'pkce',detectSessionInUrl:true}});
    await setupGoogleButton();
    const {data:{session}}=await supabaseAuth.auth.getSession();
    if(session?.access_token)sessionStorage.setItem(tokenKey,session.access_token);
    if(window.opener&&session?.access_token){
      window.opener.postMessage({type:'flowtix-auth-success'},location.origin);
      window.close();
      return;
    }
  } catch(error) { console.error('Supabase Auth init failed:',error); }
  await Promise.all([loadSession(),loadCategories()]);
  await loadEvents();
}
init();
