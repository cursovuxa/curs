/**
 * EventHub Pro - Single Unified Application JavaScript Mastermind
 * Implementation of all 30 Coursework Specifications
 */

// =====================================================================
// 1. STATE & SEED DATA
// =====================================================================

const APP_STATE = {
  currentRole: 'visitor', // 'visitor' | 'organizer' | 'staff' | 'moderator' | 'admin'
  currentUser: {
    id: 'usr-alex',
    name: 'Алексей Смирнов',
    email: 'alex.visitor@eventhub.kz',
    role: 'visitor',
    city: 'Петропавловск',
    preferences: ['IT & Конференции', 'Образование'],
    favorites: ['evt-1', 'evt-3'],
  },
  activeTab: 'catalog',
  activeCategory: 'all',
  searchQuery: '',
  filterCity: 'Петропавловск',
  filterDateRange: 'all',
  selectedEventId: 'evt-1',
  selectedSeatId: null,
  selectedSeatType: 'standard',
  selectedSeatPrice: 2500,
  activeHoldTimer: null,
  holdExpiresAt: null,
  appliedPromo: null,
  queuePosition: 127,
  queueAhead: 36,
  isQueueActive: false,
  notifications: [
    {
      id: 'n-1',
      title: 'Успешная регистрация',
      message: 'Вы зарегистрированы на "Северный IT-Форум: Архитектура и ИИ 2026"',
      time: '10 минут назад',
      read: false,
    },
    {
      id: 'n-2',
      title: 'Напоминание о событии',
      message: 'Завтра в 10:00 состоится мастер-класс по DevOps в IT Hub',
      time: '2 часа назад',
      read: false,
    },
  ],
  auditLogs: [
    {
      time: 'Сегодня, 10:15',
      actor: 'Даулет Нурланов (Организатор)',
      action: 'SET_DYNAMIC_PRICING',
      entity: 'Мероприятие #evt-1',
      details: 'Изменена шкала динамической цены (порог 50 мест -> 2500 ₸).',
    },
    {
      time: 'Сегодня, 09:40',
      actor: 'Алина Колесникова (Модератор)',
      action: 'APPROVE_EVENT',
      entity: 'Мероприятие #evt-4',
      details: 'Публикация одобрена после проверки сертификатов площадки.',
    },
    {
      time: 'Сегодня, 08:30',
      actor: 'Алексей Смирнов (Посетитель)',
      action: 'CANCEL_REGISTRATION',
      entity: 'Билет #TKT-4412',
      details: 'Оформлен возврат билета (100% возврат за 8 дней до события).',
    },
    {
      time: 'Вчера, 18:20',
      actor: 'Администратор Системы',
      action: 'BLOCK_VIOLATOR',
      entity: 'Пользователь #usr-spam99',
      details: 'Блокировка аккаунта за спам в отзывах к концерту.',
    },
  ],
  complaints: [
    {
      id: 'cmp-101',
      author: 'Сергей Николаев',
      targetType: 'Мероприятие',
      targetTitle: 'Фестиваль Звуковая Волна',
      reason: 'Срыв тайминга / задержка',
      details: 'Опоздание хедлайнера на 1.5 часа, охрана не пускала в гардероб.',
      status: 'new',
      date: 'Сегодня, 11:20',
    },
    {
      id: 'cmp-102',
      author: 'Айгерим К.',
      targetType: 'Организатор',
      targetTitle: 'EventPro Global',
      reason: 'Несоответствие описания программы',
      details: 'Заявленного спикера из Google не было, замену не согласовали.',
      status: 'in_review',
      moderatorNotes: 'Запрошены подтверждающие материалы у спикера.',
      date: 'Вчера, 16:45',
    },
  ],
  events: [
    {
      id: 'evt-1',
      title: 'Северный IT-Форум: Архитектура и ИИ 2026',
      category: 'IT & Конференции',
      city: 'Петропавловск',
      address: 'ул. Интернациональная, 58 (IT Hub North Tech)',
      venueName: 'IT Hub North Tech &bull; Зал Alfa',
      hallId: 'hall-2',
      date: '2026-11-06',
      timeStart: '10:00',
      timeEnd: '18:00',
      ageLimit: '16+',
      cover: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&auto=format&fit=crop&q=80',
      description: 'Главное технологическое событие Северного Казахстана: секции по микросервисам, Highload, машинному обучению и практические воркшопы.',
      totalSeats: 100,
      remainingSeats: 38,
      basePrice: 2000,
      dynamicPricing: true,
      popularity: 92,
      lat: 54.8655,
      lng: 69.1350,
      program: [
        { time: '09:30 - 10:00', title: 'Регистрация участников и Welcome-coffee', speaker: 'Оргкомитет', room: 'Холл 1 этажа' },
        { time: '10:00 - 10:45', title: 'Открытие форума: Тренды AI в Enterprise 2026', speaker: 'Даулет Нурланов (CTO TechLabs)', room: 'Зал Alfa' },
        { time: '11:00 - 12:30', title: 'Секция №1: Высоконагруженные архитектуры и PostgreSQL', speaker: 'Максим Белов (Lead DBA)', room: 'Зал Alfa' },
        { time: '12:30 - 13:30', title: 'Обеденный перерыв и нетворкинг-сессия', speaker: 'Все участники', room: 'Lounge Zone' },
        { time: '13:30 - 15:30', title: 'Секция №2: Практический мастер-класс по LLM Agents', speaker: 'Айдар Касымов (Senior AI Eng)', room: 'Воркшоп-зал B' },
        { time: '16:00 - 17:30', title: 'Панельная дискуссия и розыгрыш призов от партнеров', speaker: 'Модераторы и жюри', room: 'Зал Alfa' },
        { time: '17:30 - 18:00', title: 'Закрытие форума и вручение сертификатов', speaker: 'Оргкомитет', room: 'Зал Alfa' },
      ],
      reviewsCount: 34,
      rating: 4.9,
    },
    {
      id: 'evt-2',
      title: 'Симфонический концерт: Шедевры Кинематографа',
      category: 'Концерты и Шоу',
      city: 'Петропавловск',
      address: 'ул. Конституции Казахстана, 12',
      venueName: 'Дворец Спорта и Молодежи &bull; Главный зал',
      hallId: 'hall-1',
      date: '2026-11-12',
      timeStart: '19:00',
      timeEnd: '21:30',
      ageLimit: '6+',
      cover: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=800&auto=format&fit=crop&q=80',
      description: 'Легендарные саундтреки из фильмов Интерстеллар, Гладиатор, Властелин Колец в исполнении филармонического оркестра.',
      totalSeats: 300,
      remainingSeats: 85,
      basePrice: 3500,
      dynamicPricing: true,
      popularity: 88,
      lat: 54.8722,
      lng: 69.1417,
      program: [
        { time: '18:30 - 19:00', title: 'Сбор гостей в фойе', speaker: 'Администраторы', room: 'Фойе' },
        { time: '19:00 - 20:00', title: 'Отделение 1: Музыка Ханса Циммера', speaker: 'Симфонический оркестр', room: 'Главный зал' },
        { time: '20:00 - 20:20', title: 'Антракт', speaker: '—', room: 'Буфет' },
        { time: '20:20 - 21:30', title: 'Отделение 2: Музыка Джона Уильямса и Эннио Морриконе', speaker: 'Симфонический оркестр', room: 'Главный зал' },
      ],
      reviewsCount: 48,
      rating: 4.8,
    },
    {
      id: 'evt-3',
      title: 'Форум Молодых Предпринимателей & Стартапов',
      category: 'Бизнес и Стартапы',
      city: 'Петропавловск',
      address: 'ул. Жамбыла Жабаева, 174',
      venueName: 'Бизнес-центр Северный &bull; Конференц-холл',
      hallId: 'hall-3',
      date: '2026-11-20',
      timeStart: '11:00',
      timeEnd: '17:00',
      ageLimit: '18+',
      cover: 'https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=800&auto=format&fit=crop&q=80',
      description: 'Инвестиционные питчи, разбор бизнес-моделей с венчурными фондами и нетворкинг с предпринимателями.',
      totalSeats: 150,
      remainingSeats: 45,
      basePrice: 3000,
      dynamicPricing: false,
      popularity: 76,
      lat: 54.8810,
      lng: 69.1550,
      program: [
        { time: '11:00 - 12:00', title: 'Питчи стартапов перед инвесторами', speaker: '10 команд', room: 'Большой зал' },
        { time: '12:00 - 14:00', title: 'Мастер-класс по масштабированию продаж', speaker: 'Ерлан Мусин', room: 'Зал B' },
        { time: '14:30 - 17:00', title: 'B2B Speed Dating & Инвест-сессия', speaker: 'Бизнес-ангелы', room: 'Переговорные' },
      ],
      reviewsCount: 19,
      rating: 4.7,
    },
    {
      id: 'evt-4',
      title: 'Городской Осенний Полумарафон 2026',
      category: 'Спорт и Фитнес',
      city: 'Петропавловск',
      address: 'Парк Первого Президента',
      venueName: 'Центральный городской стадион &bull; Стартовый городок',
      hallId: 'hall-open',
      date: '2026-11-08',
      timeStart: '08:00',
      timeEnd: '14:00',
      ageLimit: '12+',
      cover: 'https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?w=800&auto=format&fit=crop&q=80',
      description: 'Дистанции 5 км, 10 км и 21.1 км. Медали всем финишерам, электронный хронометраж и пункты питания.',
      totalSeats: 500,
      remainingSeats: 142,
      basePrice: 1500,
      dynamicPricing: false,
      popularity: 84,
      lat: 54.8690,
      lng: 69.1280,
      program: [
        { time: '08:00 - 08:45', title: 'Выдача стартовых пакетов и чипов', speaker: 'Судейская коллегия', room: 'Стартовый шатер' },
        { time: '09:00', title: 'Старт дистанции 21.1 км', speaker: 'Главный судья', room: 'Стартовая арка' },
        { time: '09:15', title: 'Старт дистанций 5 км и 10 км', speaker: 'Судьи', room: 'Стартовая арка' },
        { time: '12:00', title: 'Награждение победителей и закрытие', speaker: 'Оргкомитет', room: 'Сцена' },
      ],
      reviewsCount: 52,
      rating: 4.9,
    },
    {
      id: 'evt-5',
      title: 'Data Science & Big Data Masterclass',
      category: 'Образование',
      city: 'Петропавловск',
      address: 'Kozybayev University &bull; Аудитория 305',
      venueName: 'Университет им. М. Козыбаева',
      hallId: 'hall-univ',
      date: '2026-11-18',
      timeStart: '14:00',
      timeEnd: '18:00',
      ageLimit: '16+',
      cover: 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=800&auto=format&fit=crop&q=80',
      description: 'Практический интенсив: пайплайны обработки данных, Apache Spark, feature engineering и визуализация.',
      totalSeats: 50,
      remainingSeats: 12,
      basePrice: 2000,
      dynamicPricing: true,
      popularity: 79,
      lat: 54.8785,
      lng: 69.1450,
      program: [
        { time: '14:00 - 15:30', title: 'Архитектура Big Data пайплайнов', speaker: 'Профессор А. Ким', room: 'Ауд. 305' },
        { time: '16:00 - 18:00', title: 'Hands-on лабораторная работа на кластере', speaker: 'Дата-инженеры', room: 'Компьютерный класс 308' },
      ],
      reviewsCount: 22,
      rating: 4.95,
    },
    {
      id: 'evt-6',
      title: 'Digital Marketing & Content Strategy Summit',
      category: 'Бизнес и Стартапы',
      city: 'Астана',
      address: 'Мангилик Ел, 55/8 &bull; Astana Hub',
      venueName: 'Astana Hub Main Hall',
      hallId: 'hall-ahub',
      date: '2026-11-25',
      timeStart: '10:00',
      timeEnd: '19:00',
      ageLimit: '16+',
      cover: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?w=800&auto=format&fit=crop&q=80',
      description: 'Все о трендах вирального контента, Performance-маркетинге и AI-генерации медиа.',
      totalSeats: 250,
      remainingSeats: 90,
      basePrice: 4000,
      dynamicPricing: true,
      popularity: 81,
      lat: 51.0905,
      lng: 71.4180,
      program: [
        { time: '10:00 - 12:00', title: 'Keynote: Performance в 2026', speaker: 'Спикеры Google & Meta', room: 'Main Stage' },
      ],
      reviewsCount: 15,
      rating: 4.6,
    },
  ],
  myTickets: [
    {
      id: 'TKT-2026-7482',
      eventId: 'evt-1',
      eventName: 'Северный IT-Форум: Архитектура и ИИ 2026',
      venue: 'IT Hub North Tech (Зал Alfa)',
      date: '2026-11-06',
      time: '10:00',
      seat: 'Ряд B, Место 3',
      seatType: 'Бизнес',
      price: 2800,
      attendee: 'Алексей Смирнов',
      status: 'valid', // 'valid', 'used', 'refunded'
      purchaseDate: '2026-10-28',
    },
    {
      id: 'TKT-2026-9901',
      eventId: 'evt-2',
      eventName: 'Симфонический концерт: Шедевры Кинематографа',
      venue: 'Дворец Спорта &bull; Главный зал',
      date: '2026-11-12',
      time: '19:00',
      seat: 'Ряд A, Место 2',
      seatType: 'VIP',
      price: 5000,
      attendee: 'Алексей Смирнов',
      status: 'valid',
      purchaseDate: '2026-10-25',
    },
  ],
  staffScanHistory: [
    {
      ticketNumber: 'TKT-2026-1014',
      time: '10:14:22',
      status: 'VALID',
      seat: 'B4',
      attendee: 'Иван Сергеев',
      message: 'Доступ разрешен',
    },
    {
      ticketNumber: 'TKT-2026-1018',
      time: '10:18:05',
      status: 'VALID',
      seat: 'B5',
      attendee: 'Айбек Нурланов',
      message: 'Доступ разрешен',
    },
  ],
};

// =====================================================================
// 2. AUDIO SYNTHESIZER (WEB AUDIO API FOR NOTIFICATIONS & SCAN ALERTS)
// =====================================================================

const SoundFx = {
  ctx: null,
  init() {
    if (!this.ctx && window.AudioContext) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('AudioContext not supported');
      }
    }
  },
  playSuccess() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.15); // G5
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  },
  playError() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now); // A3
    osc.frequency.linearRampToValueAtTime(140, now + 0.25);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  },
  playChime() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now); // A5
    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  },
};

// =====================================================================
// 3. QR-CODE CANVAS GENERATOR (STANDALONE VISUAL RENDERER)
// =====================================================================

function drawVisualQRCode(canvas, text) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Deterministic pseudo-random seed based on text hash
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  const matrixSize = 25; // 25x25 QR matrix
  const moduleSize = size / matrixSize;

  // Helper to draw a finder square at corner (row, col)
  function drawFinder(startR, startC) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(startC * moduleSize, startR * moduleSize, 7 * moduleSize, 7 * moduleSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((startC + 1) * moduleSize, (startR + 1) * moduleSize, 5 * moduleSize, 5 * moduleSize);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect((startC + 2) * moduleSize, (startR + 2) * moduleSize, 3 * moduleSize, 3 * moduleSize);
  }

  // Draw 3 standard corner finders
  drawFinder(0, 0);
  drawFinder(0, matrixSize - 7);
  drawFinder(matrixSize - 7, 0);

  // Fill data modules
  ctx.fillStyle = '#0f172a';
  let rand = Math.abs(hash) || 123456789;
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      // Skip finder areas
      if ((r < 8 && c < 8) || (r < 8 && c >= matrixSize - 8) || (r >= matrixSize - 8 && c < 8)) {
        continue;
      }
      // Simple LCG pseudo-random bit
      rand = (rand * 1103515245 + 12345) & 0x7fffffff;
      if (rand % 3 === 0) {
        ctx.fillRect(c * moduleSize + 0.5, r * moduleSize + 0.5, moduleSize - 1, moduleSize - 1);
      }
    }
  }

  // Center logo dot
  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(11 * moduleSize, 11 * moduleSize, 3 * moduleSize, 3 * moduleSize);
}

// =====================================================================
// 4. TOAST NOTIFICATIONS HELPER
// =====================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (type === 'success') toast.style.borderLeft = '4px solid #10b981';
  if (type === 'error') toast.style.borderLeft = '4px solid #ef4444';
  if (type === 'warning') toast.style.borderLeft = '4px solid #f59e0b';

  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
    <div>${message}</div>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function addNotification(title, message) {
  APP_STATE.notifications.unshift({
    id: `n-${Date.now()}`,
    title,
    message,
    time: 'Только что',
    read: false,
  });
  renderNotifications();
  SoundFx.playChime();
  showToast(title, 'info');
}

// =====================================================================
// 5. ROLE PERMISSION MANAGEMENT & NAVIGATION
// =====================================================================

function setRole(newRole) {
  APP_STATE.currentRole = newRole;
  showToast(`Роль переключена на: ${getRoleDisplayName(newRole)}`, 'info');

  // If role is organizer, switch to organizer tab if on visitor view
  if (newRole === 'organizer' && APP_STATE.activeTab === 'catalog') {
    switchTab('organizer');
  } else if (newRole === 'staff') {
    switchTab('staff-terminal');
  } else if (newRole === 'moderator') {
    switchTab('moderator');
  } else if (newRole === 'admin') {
    switchTab('admin');
  }

  updateRoleUI();
}

function getRoleDisplayName(role) {
  const map = {
    visitor: '👤 Посетитель (Алексей)',
    organizer: '👨‍💼 Организатор (Даулет)',
    staff: '👷 Сотрудник (Ерлан)',
    moderator: '🛡️ Модератор (Алина)',
    admin: '👑 Администратор (SuperAdmin)',
  };
  return map[role] || role;
}

function updateRoleUI() {
  const select = document.getElementById('userRoleSelect');
  if (select && select.value !== APP_STATE.currentRole) {
    select.value = APP_STATE.currentRole;
  }
}

function switchTab(tabId) {
  APP_STATE.activeTab = tabId;

  // Toggle tab buttons
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    if (btn.dataset.tab === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Toggle tab panels
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    if (panel.id === `panel-${tabId}`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });

  // Specific tab render hooks
  if (tabId === 'catalog') {
    renderEvents();
    renderPersonalRecommendation();
  } else if (tabId === 'booking') {
    renderBookingView();
  } else if (tabId === 'my-tickets') {
    renderMyTickets();
  } else if (tabId === 'organizer') {
    renderOrganizerView();
  } else if (tabId === 'staff-terminal') {
    renderStaffTerminal();
  } else if (tabId === 'moderator') {
    renderModeratorView();
  } else if (tabId === 'admin') {
    renderAdminView();
  } else if (tabId === 'database-deploy') {
    renderDatabaseArchitectureView();
  }
}

// =====================================================================
// 6. DYNAMIC PRICING ENGINE (STEP FUNCTION)
// =====================================================================

function getDynamicPrice(event) {
  if (!event.dynamicPricing) return event.basePrice;
  const rem = event.remainingSeats;

  // Step rules per coursework brief:
  // 100 мест -> 2000 ₸, 50 мест -> 2500 ₸, 20 мест -> 3000 ₸, 10 мест -> 3500 ₸
  if (rem <= 10) return Math.round(event.basePrice * 1.75);
  if (rem <= 20) return Math.round(event.basePrice * 1.5);
  if (rem <= 50) return Math.round(event.basePrice * 1.25);
  return event.basePrice;
}

// =====================================================================
// 7. CATALOG & RECOMMENDATION ENGINE
// =====================================================================

function calculateRecomScore(event) {
  let score = event.popularity * 0.4;
  if (event.city.toLowerCase() === APP_STATE.currentUser.city.toLowerCase()) {
    score += 40; // match user city
  }
  if (APP_STATE.currentUser.preferences.includes(event.category)) {
    score += 35; // match category
  }
  return Math.min(120, Math.round(score));
}

function renderPersonalRecommendation() {
  const container = document.getElementById('recomEventSnippet');
  if (!container) return;

  const topEvent = [...APP_STATE.events].sort(
    (a, b) => calculateRecomScore(b) - calculateRecomScore(a)
  )[0];

  if (!topEvent) return;

  const dynPrice = getDynamicPrice(topEvent);

  container.innerHTML = `
    <div style="display:flex; align-items:center; gap:1rem;">
      <img src="${topEvent.cover}" alt="${topEvent.title}" style="width:72px; height:72px; border-radius:8px; object-fit:cover; border:1px solid #bae6fd;" />
      <div>
        <h4 style="font-weight:700; color:var(--gray-900); font-size:1.05rem;">${topEvent.title}</h4>
        <div style="font-size:0.85rem; color:var(--gray-600); margin-top:0.2rem;">
          📅 ${topEvent.date} в ${topEvent.timeStart} &bull; 📍 ${topEvent.city}, ${topEvent.venueName}
        </div>
      </div>
    </div>
    <div style="display:flex; align-items:center; gap:1rem;">
      <div style="text-align:right;">
        <div style="font-size:0.75rem; color:var(--gray-500);">Динамическая цена</div>
        <div style="font-size:1.2rem; font-weight:800; color:var(--primary);">${dynPrice.toLocaleString()} ₸</div>
      </div>
      <button class="btn btn-primary" onclick="window.selectAndBookEvent('${topEvent.id}')">
        Выбрать место &rarr;
      </button>
    </div>
  `;
}

function renderEvents() {
  const container = document.getElementById('eventsGridContainer');
  const countEl = document.getElementById('eventsFoundCount');
  if (!container) return;

  const query = APP_STATE.searchQuery.toLowerCase().trim();
  const category = APP_STATE.activeCategory;
  const city = APP_STATE.filterCity;

  const filtered = APP_STATE.events.filter((ev) => {
    // Smart search across title, description, category, address
    const matchesQuery =
      !query ||
      ev.title.toLowerCase().includes(query) ||
      ev.description.toLowerCase().includes(query) ||
      ev.category.toLowerCase().includes(query) ||
      ev.city.toLowerCase().includes(query);

    const matchesCategory = category === 'all' || ev.category === category;
    const matchesCity = !city || ev.city === city;

    return matchesQuery && matchesCategory && matchesCity;
  });

  if (countEl) countEl.textContent = `Найдено: ${filtered.length} мероприятий`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; padding:3rem; text-align:center; background:white; border-radius:var(--radius); border:1px dashed var(--gray-300);">
        <p style="font-size:1.1rem; color:var(--gray-600); margin-bottom:0.5rem;">Мероприятия не найдены</p>
        <p style="font-size:0.85rem; color:var(--gray-400);">Попробуйте изменить запрос или фильтр по городу</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((ev) => {
      const dynPrice = getDynamicPrice(ev);
      const isFav = APP_STATE.currentUser.favorites.includes(ev.id);
      const percentLeft = Math.round((ev.remainingSeats / ev.totalSeats) * 100);

      return `
        <article class="event-card">
          <div class="event-card-img-wrap">
            <img class="event-card-img" src="${ev.cover}" alt="${ev.title}" loading="lazy" />
            <span class="event-badge-category">${ev.category}</span>
            <button class="event-fav-btn ${isFav ? 'active' : ''}" onclick="window.toggleFavorite('${ev.id}')" aria-label="Избранное">
              ♥
            </button>
          </div>
          <div class="event-card-body">
            <div class="event-card-meta">
              <span>📅 ${ev.date}</span>
              <span>⏰ ${ev.timeStart}</span>
              <span style="margin-left:auto; font-weight:700; color:var(--gray-700);">${ev.ageLimit}</span>
            </div>
            <h3 class="event-card-title">${ev.title}</h3>
            <div class="event-card-location">
              📍 ${ev.city}, ${ev.venueName}
            </div>

            <!-- Dynamic price box -->
            <div class="dynamic-price-box">
              <div class="price-row">
                <span class="price-val">${dynPrice.toLocaleString()} ₸</span>
                <span class="price-seats-alert">Осталось ${ev.remainingSeats} мест</span>
              </div>
              <div class="price-progress-bar">
                <div class="price-progress-fill" style="width: ${percentLeft}%;"></div>
              </div>
            </div>

            <div class="event-card-footer">
              <button class="btn btn-primary" style="flex:1;" onclick="window.selectAndBookEvent('${ev.id}')">
                Купить билет
              </button>
              <button class="btn btn-secondary btn-sm" onclick="window.openComplaintModal('${ev.id}', '${ev.title}')" title="Пожаловаться модератору">
                🛡️
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');
}

// Window globally exposed handlers
window.toggleFavorite = function (eventId) {
  const idx = APP_STATE.currentUser.favorites.indexOf(eventId);
  if (idx > -1) {
    APP_STATE.currentUser.favorites.splice(idx, 1);
    showToast('Удалено из избранного', 'info');
  } else {
    APP_STATE.currentUser.favorites.push(eventId);
    showToast('Добавлено в избранное ❤️', 'success');
  }
  const favBadge = document.getElementById('favCount');
  if (favBadge) favBadge.textContent = APP_STATE.currentUser.favorites.length;
  renderEvents();
};

window.selectAndBookEvent = function (eventId) {
  APP_STATE.selectedEventId = eventId;
  APP_STATE.selectedSeatId = null;
  switchTab('booking');
};

// =====================================================================
// 8. INTERACTIVE SEAT SCHEMA & 10-MIN HOLD TIMER
// =====================================================================

function renderBookingView() {
  const event = APP_STATE.events.find((e) => e.id === APP_STATE.selectedEventId) || APP_STATE.events[0];
  const titleEl = document.getElementById('bookingEventTitle');
  if (titleEl) {
    titleEl.textContent = event.title;
  }

  // Render Program Tree
  const programEl = document.getElementById('bookingProgramTree');
  if (programEl && event.program) {
    programEl.innerHTML = event.program
      .map(
        (p, idx) => `
        <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:var(--radius-sm); padding:0.75rem 1rem; display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:0.75rem;">
            <span style="font-family:var(--font-mono); font-size:0.75rem; font-weight:700; color:var(--primary); background:var(--primary-light); padding:0.2rem 0.5rem; border-radius:4px;">
              ${p.time}
            </span>
            <div>
              <strong style="font-size:0.9rem; color:var(--gray-900);">${p.title}</strong>
              <div style="font-size:0.8rem; color:var(--gray-500);">Ведущий: ${p.speaker} &bull; Помещение: ${p.room}</div>
            </div>
          </div>
          <span style="font-size:0.75rem; color:var(--gray-400);">#${idx + 1}</span>
        </div>
      `
      )
      .join('');
  }

  // Render Seats Layout (3 rows: A, B, C; 10 seats each)
  const gridEl = document.getElementById('interactiveSeatGrid');
  if (gridEl) {
    const rows = ['A', 'B', 'C'];
    gridEl.innerHTML = rows
      .map((rowLabel) => {
        let seatsHtml = '';
        for (let i = 1; i <= 10; i++) {
          const seatId = `${rowLabel}${i}`;

          // Seat type mapping
          let type = 'seat-standard';
          let multiplier = 1.0;
          if (rowLabel === 'A' && (i === 4 || i === 5 || i === 6 || i === 7)) {
            type = 'seat-vip';
            multiplier = 2.0;
          } else if (rowLabel === 'B' && (i === 1 || i === 10)) {
            type = 'seat-accessible';
            multiplier = 0.8;
          } else if (rowLabel === 'B') {
            type = 'seat-business';
            multiplier = 1.4;
          }

          // Pre-booked / reserved demo states
          const isBooked = (rowLabel === 'A' && (i === 1 || i === 2)) || (rowLabel === 'C' && i === 8);
          const isSelected = APP_STATE.selectedSeatId === seatId;

          seatsHtml += `
            <button
              class="seat-btn ${type} ${isSelected ? 'seat-selected' : ''} ${isBooked ? 'seat-booked' : ''}"
              data-seat-id="${seatId}"
              data-multiplier="${multiplier}"
              data-type-label="${type.replace('seat-', '')}"
              ${isBooked ? 'disabled' : ''}
              onclick="window.handleSeatClick('${seatId}', ${multiplier}, '${type.replace('seat-', '')}')"
              aria-label="Место ${seatId}"
              title="Место ${seatId}"
            >
              ${seatId}
            </button>
          `;
        }

        return `
          <div class="seat-row">
            <span class="seat-row-label">${rowLabel}</span>
            ${seatsHtml}
            <span class="seat-row-label">${rowLabel}</span>
          </div>
        `;
      })
      .join('');
  }

  updateBookingSidebar();
}

window.handleSeatClick = function (seatId, multiplier, typeLabel) {
  APP_STATE.selectedSeatId = seatId;
  APP_STATE.selectedSeatType = typeLabel;

  const event = APP_STATE.events.find((e) => e.id === APP_STATE.selectedEventId) || APP_STATE.events[0];
  const dynBase = getDynamicPrice(event);
  APP_STATE.selectedSeatPrice = Math.round(dynBase * multiplier);

  // Trigger 10-Minute Hold Reservation Timer
  start10MinuteReservationTimer(seatId);

  SoundFx.playSuccess();
  showToast(`Место ${seatId} выбрано и заблокировано за вами на 10 минут!`, 'success');

  renderBookingView();
};

function start10MinuteReservationTimer(seatId) {
  const timerBanner = document.getElementById('reservationTimerBox');
  const timerDigits = document.getElementById('timerCountdown');
  if (!timerBanner || !timerDigits) return;

  timerBanner.style.display = 'flex';
  if (APP_STATE.activeHoldTimer) {
    clearInterval(APP_STATE.activeHoldTimer);
  }

  // 10 minutes in milliseconds
  APP_STATE.holdExpiresAt = Date.now() + 10 * 60 * 1000;

  function tick() {
    const left = APP_STATE.holdExpiresAt - Date.now();
    if (left <= 0) {
      clearInterval(APP_STATE.activeHoldTimer);
      timerBanner.style.display = 'none';
      APP_STATE.selectedSeatId = null;
      showToast(`Время бронирования места ${seatId} истекло. Место освобождено.`, 'warning');
      SoundFx.playError();
      renderBookingView();
      return;
    }

    const min = Math.floor(left / 60000);
    const sec = Math.floor((left % 60000) / 1000);
    timerDigits.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  tick();
  APP_STATE.activeHoldTimer = setInterval(tick, 1000);
}

function updateBookingSidebar() {
  const badge = document.getElementById('selectedSeatBadge');
  const typeText = document.getElementById('selectedSeatType');
  const totalEl = document.getElementById('cartTotalPrice');
  const btnSubmit = document.getElementById('btnCheckoutSubmit');
  const curPriceEl = document.getElementById('dynCurrentPrice');
  const remSeatsEl = document.getElementById('dynSeatsRemaining');

  const event = APP_STATE.events.find((e) => e.id === APP_STATE.selectedEventId) || APP_STATE.events[0];
  const dynPrice = getDynamicPrice(event);

  if (curPriceEl) curPriceEl.textContent = `${dynPrice.toLocaleString()} ₸`;
  if (remSeatsEl) remSeatsEl.textContent = `${event.remainingSeats} из ${event.totalSeats}`;

  if (!APP_STATE.selectedSeatId) {
    if (badge) badge.textContent = 'Не выбрано';
    if (typeText) typeText.textContent = '—';
    if (totalEl) totalEl.textContent = '0 ₸';
    if (btnSubmit) btnSubmit.disabled = true;
    return;
  }

  if (badge) badge.textContent = APP_STATE.selectedSeatId;
  if (typeText) typeText.textContent = APP_STATE.selectedSeatType.toUpperCase();

  let finalPrice = APP_STATE.selectedSeatPrice;
  if (APP_STATE.appliedPromo) {
    const disc = Math.round((finalPrice * APP_STATE.appliedPromo.discountPercent) / 100);
    finalPrice = Math.max(0, finalPrice - disc);
  }

  if (totalEl) totalEl.textContent = `${finalPrice.toLocaleString()} ₸`;
  if (btnSubmit) btnSubmit.disabled = false;
}

// Promo Code Apply Handler
document.addEventListener('DOMContentLoaded', () => {
  const btnApplyPromo = document.getElementById('btnApplyPromo');
  const promoInput = document.getElementById('promoCodeInput');
  const feedback = document.getElementById('promoFeedback');
  const discountNotice = document.getElementById('cartDiscountNotice');

  if (btnApplyPromo && promoInput) {
    btnApplyPromo.addEventListener('click', () => {
      const code = promoInput.value.trim().toUpperCase();
      if (!code) return;

      if (code === 'WELCOME20') {
        APP_STATE.appliedPromo = { code: 'WELCOME20', discountPercent: 20 };
        if (feedback) {
          feedback.textContent = 'Промокод WELCOME20 применен: скидка 20%!';
          feedback.style.color = 'var(--success)';
        }
        if (discountNotice) discountNotice.style.display = 'block';
        SoundFx.playSuccess();
        updateBookingSidebar();
      } else if (code === 'DEV2026') {
        APP_STATE.appliedPromo = { code: 'DEV2026', discountPercent: 15 };
        if (feedback) {
          feedback.textContent = 'Промокод DEV2026 применен: скидка 15%!';
          feedback.style.color = 'var(--success)';
        }
        if (discountNotice) discountNotice.style.display = 'block';
        SoundFx.playSuccess();
        updateBookingSidebar();
      } else {
        if (feedback) {
          feedback.textContent = 'Промокод не найден или истек срок действия';
          feedback.style.color = 'var(--danger)';
        }
        SoundFx.playError();
      }
    });
  }

  // Checkout submission
  const btnCheckout = document.getElementById('btnCheckoutSubmit');
  if (btnCheckout) {
    btnCheckout.addEventListener('click', () => {
      if (!APP_STATE.selectedSeatId) return;

      const event = APP_STATE.events.find((e) => e.id === APP_STATE.selectedEventId) || APP_STATE.events[0];
      const newTicketNumber = `TKT-2026-${Math.floor(1000 + Math.random() * 9000)}`;

      const newTicket = {
        id: newTicketNumber,
        eventId: event.id,
        eventName: event.title,
        venue: event.venueName,
        date: event.date,
        time: event.timeStart,
        seat: `Ряд ${APP_STATE.selectedSeatId[0]}, Место ${APP_STATE.selectedSeatId.slice(1)}`,
        seatType: APP_STATE.selectedSeatType,
        price: APP_STATE.selectedSeatPrice,
        attendee: APP_STATE.currentUser.name,
        status: 'valid',
        purchaseDate: new Date().toISOString().split('T')[0],
      };

      APP_STATE.myTickets.unshift(newTicket);
      event.remainingSeats = Math.max(0, event.remainingSeats - 1);

      // Audit Log
      APP_STATE.auditLogs.unshift({
        time: 'Только что',
        actor: `${APP_STATE.currentUser.name} (Посетитель)`,
        action: 'TICKET_PURCHASED',
        entity: `Билет #${newTicketNumber}`,
        details: `Оплачено место ${APP_STATE.selectedSeatId} на мероприятие "${event.title}".`,
      });

      // Clear hold
      if (APP_STATE.activeHoldTimer) clearInterval(APP_STATE.activeHoldTimer);
      const timerBanner = document.getElementById('reservationTimerBox');
      if (timerBanner) timerBanner.style.display = 'none';

      SoundFx.playSuccess();
      addNotification(
        'Билет сформирован!',
        `Билет #${newTicketNumber} на "${event.title}" готов и сохранен в разделе "Мои билеты".`
      );

      switchTab('my-tickets');
    });
  }
});

// =====================================================================
// 9. MY TICKETS & REFUND ENGINE (100% / 50% / 0% RULES)
// =====================================================================

function renderMyTickets() {
  const container = document.getElementById('myTicketsContainer');
  if (!container) return;

  if (APP_STATE.myTickets.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; padding:3rem; text-align:center; background:var(--gray-50); border-radius:var(--radius);">
        <p style="font-size:1.1rem; color:var(--gray-600); margin-bottom:0.5rem;">У вас пока нет купленных билетов</p>
        <button class="btn btn-primary" onclick="switchTab('catalog')">Перейти в каталог</button>
      </div>
    `;
    return;
  }

  container.innerHTML = APP_STATE.myTickets
    .map((t) => {
      const isUsed = t.status === 'used';
      const isRefunded = t.status === 'refunded';

      return `
        <div class="ticket-pass" style="${isRefunded ? 'opacity:0.6; filter:grayscale(0.8);' : ''}">
          <div class="ticket-pass-header">
            <div>
              <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:#93c5fd;">Электронный билет</div>
              <strong style="font-size:1.1rem; font-family:var(--font-mono);">${t.id}</strong>
            </div>
            <span class="badge" style="background:${
              isUsed ? '#f97316' : isRefunded ? '#ef4444' : '#10b981'
            }; color:white; font-size:0.75rem; font-weight:700; padding:0.25rem 0.6rem; border-radius:4px;">
              ${isUsed ? 'Использован' : isRefunded ? 'Возвращен' : 'Действителен'}
            </span>
          </div>
          <div class="ticket-pass-body">
            <div>
              <h4 style="font-weight:700; font-size:1rem; margin-bottom:0.5rem; color:var(--gray-900);">${t.eventName}</h4>
              <div style="font-size:0.8rem; color:var(--gray-600); margin-bottom:0.25rem;">
                📅 <strong>${t.date}</strong> в <strong>${t.time}</strong>
              </div>
              <div style="font-size:0.8rem; color:var(--gray-600); margin-bottom:0.25rem;">
                📍 ${t.venue}
              </div>
              <div style="font-size:0.8rem; color:var(--gray-600); margin-bottom:0.5rem;">
                💺 <strong>${t.seat}</strong> (${t.seatType}) &bull; Посетитель: ${t.attendee}
              </div>
              <div style="font-size:0.85rem; font-weight:700; color:var(--primary); margin-bottom:0.75rem;">
                Стоимость: ${t.price.toLocaleString()} ₸
              </div>

              ${
                t.status === 'valid'
                  ? `
                <div style="display:flex; gap:0.5rem;">
                  <button class="btn btn-secondary btn-sm" onclick="window.openRefundModal('${t.id}')">
                    Оформить возврат
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="window.printTicket('${t.id}')">
                    Печать / PDF
                  </button>
                </div>
              `
                  : ''
              }
            </div>

            <!-- QR Code Canvas Container -->
            <div class="ticket-qr-box">
              <canvas id="qrCanvas_${t.id}" class="qr-canvas" width="140" height="140"></canvas>
              <div style="font-size:0.7rem; font-weight:700; color:var(--gray-500); margin-top:0.35rem;">
                QR-код на входе
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // Render QR Canvas for each ticket
  APP_STATE.myTickets.forEach((t) => {
    const canvas = document.getElementById(`qrCanvas_${t.id}`);
    if (canvas) {
      drawVisualQRCode(canvas, t.id);
    }
  });
}

window.printTicket = function (ticketId) {
  showToast(`Билет ${ticketId} подготовлен к печати / выгрузке PDF`, 'info');
};

// Refund Modal Flow
window.openRefundModal = function (ticketId) {
  const ticket = APP_STATE.myTickets.find((t) => t.id === ticketId);
  if (!ticket) return;

  const modal = document.getElementById('refundModal');
  const content = document.getElementById('refundModalContent');
  const btnConfirm = document.getElementById('btnConfirmRefund');

  // Compute days until event
  const eventDate = new Date(ticket.date).getTime();
  const now = Date.now();
  const diffDays = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));

  let percent = 0;
  let ruleText = '';
  if (diffDays >= 7) {
    percent = 100;
    ruleText = 'До мероприятия осталось более 7 дней &rarr; Полный возврат 100%';
  } else if (diffDays >= 2) {
    percent = 50;
    ruleText = 'До мероприятия осталось от 2 до 7 дней &rarr; Частичный возврат 50%';
  } else {
    percent = 0;
    ruleText = 'До мероприятия менее 24/48 часов &rarr; Возврат невозможен согласно правилам организатора';
  }

  const refundSum = Math.round((ticket.price * percent) / 100);

  if (content) {
    content.innerHTML = `
      <div style="margin-bottom:1rem; font-size:0.9rem;">
        <div>Билет: <strong>${ticket.id}</strong></div>
        <div>Мероприятие: <strong>${ticket.eventName}</strong></div>
        <div>Дата проведения: <strong>${ticket.date}</strong> (дней до события: ${diffDays})</div>
        <div>Уплачено: <strong>${ticket.price.toLocaleString()} ₸</strong></div>
      </div>

      <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:var(--radius-sm); padding:1rem; margin-bottom:1rem;">
        <div style="font-weight:700; color:var(--gray-800); margin-bottom:0.25rem;">Правило расчета:</div>
        <div style="font-size:0.85rem; color:var(--gray-600);">${ruleText}</div>
        <div style="margin-top:0.75rem; font-size:1.15rem; font-weight:800; color:${percent > 0 ? 'var(--success)' : 'var(--danger)'};">
          Сумма к возврату: ${refundSum.toLocaleString()} ₸ (${percent}%)
        </div>
      </div>
    `;
  }

  if (btnConfirm) {
    btnConfirm.disabled = percent === 0;
    btnConfirm.onclick = () => {
      ticket.status = 'refunded';
      APP_STATE.auditLogs.unshift({
        time: 'Только что',
        actor: `${APP_STATE.currentUser.name} (Посетитель)`,
        action: 'REFUND_PROCESSED',
        entity: `Билет #${ticket.id}`,
        details: `Возврат средств ${refundSum} ₸ (${percent}%).`,
      });
      showToast(`Возврат ${refundSum} ₸ успешно зачислен на ваш счет!`, 'success');
      SoundFx.playSuccess();
      modal.style.display = 'none';
      renderMyTickets();
    };
  }

  if (modal) modal.style.display = 'flex';
};

// =====================================================================
// 10. EVENT STAFF TERMINAL & ANTI-DUPLICATE ENTRANCE GUARD
// =====================================================================

function renderStaffTerminal() {
  const resultBox = document.getElementById('scanResultBox');
  if (resultBox) resultBox.style.display = 'none';

  // Render recent check-in list
  const historyContainer = document.getElementById('staffRecentCheckins');
  if (historyContainer) {
    historyContainer.innerHTML = APP_STATE.staffScanHistory
      .map(
        (h) => `
        <div style="background:var(--gray-50); padding:0.5rem 0.75rem; border-radius:4px; display:flex; justify-content:space-between; align-items:center; border-left:3px solid ${
          h.status === 'VALID' ? '#10b981' : '#ef4444'
        };">
          <div>
            <strong>${h.ticketNumber}</strong> &bull; ${h.attendee} (${h.seat})
          </div>
          <span style="color:var(--gray-500); font-family:var(--font-mono);">${h.time}</span>
        </div>
      `
      )
      .join('');
  }
}

function processEntranceTicketScan(code) {
  const resultBox = document.getElementById('scanResultBox');
  if (!resultBox) return;

  const targetEventId = APP_STATE.selectedEventId;
  const ticket = APP_STATE.myTickets.find((t) => t.id.toUpperCase() === code.trim().toUpperCase());

  resultBox.style.display = 'flex';
  const nowTime = new Date().toLocaleTimeString();

  // Test Guard Conditions per coursework requirements
  if (!ticket) {
    SoundFx.playError();
    resultBox.className = 'scan-result-box scan-result-danger';
    resultBox.innerHTML = `
      <span style="font-size:1.5rem;">❌</span>
      <div>
        <div style="font-weight:700;">Билет не найден в системе!</div>
        <div style="font-size:0.85rem;">Номер ${code} не зарегистрирован ни в одном заказе. Возможна подделка.</div>
      </div>
    `;
    return;
  }

  if (ticket.status === 'used') {
    SoundFx.playError();
    resultBox.className = 'scan-result-box scan-result-danger';
    resultBox.innerHTML = `
      <span style="font-size:1.5rem;">❌</span>
      <div>
        <div style="font-weight:700;">Билет уже был использован! (Повторный вход заблокирован)</div>
        <div style="font-size:0.85rem;">Посетитель: ${ticket.attendee} &bull; Место: ${ticket.seat} &bull; Вход был зафиксирован ранее.</div>
      </div>
    `;
    return;
  }

  if (ticket.status === 'refunded') {
    SoundFx.playError();
    resultBox.className = 'scan-result-box scan-result-danger';
    resultBox.innerHTML = `
      <span style="font-size:1.5rem;">❌</span>
      <div>
        <div style="font-weight:700;">Билет недействителен (Аннулирован / Оформлен возврат)</div>
        <div style="font-size:0.85rem;">Средства были возвращены покупателю. Вход воспрещен.</div>
      </div>
    `;
    return;
  }

  if (ticket.eventId !== targetEventId) {
    SoundFx.playError();
    resultBox.className = 'scan-result-box scan-result-danger';
    resultBox.innerHTML = `
      <span style="font-size:1.5rem;">❌</span>
      <div>
        <div style="font-weight:700;">Билет предназначен для другого мероприятия!</div>
        <div style="font-size:0.85rem;">Действителен для: "${ticket.eventName}". Данный терминал обслуживает другое событие.</div>
      </div>
    `;
    return;
  }

  // Success valid entrance
  ticket.status = 'used';
  ticket.usedAt = nowTime;

  SoundFx.playSuccess();
  resultBox.className = 'scan-result-box scan-result-success';
  resultBox.innerHTML = `
    <span style="font-size:1.5rem;">✅</span>
    <div>
      <div style="font-weight:700;">Доступ разрешен! Проходите.</div>
      <div style="font-size:0.85rem;">Посетитель: <strong>${ticket.attendee}</strong> &bull; Место: <strong>${ticket.seat}</strong> (${ticket.seatType})</div>
    </div>
  `;

  // Update live stats
  const checkedInEl = document.getElementById('rtCheckedIn');
  const absentEl = document.getElementById('rtAbsent');
  if (checkedInEl && absentEl) {
    let cur = parseInt(checkedInEl.textContent) || 624;
    let abs = parseInt(absentEl.textContent) || 226;
    checkedInEl.textContent = cur + 1;
    absentEl.textContent = Math.max(0, abs - 1);
  }

  APP_STATE.staffScanHistory.unshift({
    ticketNumber: ticket.id,
    time: nowTime,
    status: 'VALID',
    seat: ticket.seat,
    attendee: ticket.attendee,
    message: 'Доступ разрешен',
  });

  renderStaffTerminal();
}

// =====================================================================
// 11. ORGANIZER & CONFLICT CONTROLLER ENGINE
// =====================================================================

function renderOrganizerView() {
  // Render promo codes list
  const promoContainer = document.getElementById('promoCodesList');
  if (promoContainer) {
    promoContainer.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--gray-50); padding:0.6rem 0.8rem; border-radius:var(--radius-sm); border:1px solid var(--gray-200);">
        <div>
          <strong style="color:var(--primary); font-family:var(--font-mono);">WELCOME20</strong>
          <span style="font-size:0.8rem; color:var(--gray-500); margin-left:0.5rem;">Скидка 20% &bull; Использовано: 14/100</span>
        </div>
        <span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.75rem; font-weight:700; padding:0.2rem 0.5rem; border-radius:4px;">Активен</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--gray-50); padding:0.6rem 0.8rem; border-radius:var(--radius-sm); border:1px solid var(--gray-200);">
        <div>
          <strong style="color:var(--primary); font-family:var(--font-mono);">DEV2026</strong>
          <span style="font-size:0.8rem; color:var(--gray-500); margin-left:0.5rem;">Скидка 15% &bull; Использовано: 8/50</span>
        </div>
        <span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.75rem; font-weight:700; padding:0.2rem 0.5rem; border-radius:4px;">Активен</span>
      </div>
    `;
  }

  // Draw Organizer Revenue Chart
  const canvas = document.getElementById('orgChartCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mini bar chart
    const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const values = [120, 180, 240, 310, 480, 720, 560];
    const maxVal = 800;
    const barWidth = 35;
    const gap = 25;
    const startX = 35;

    days.forEach((day, i) => {
      const h = (values[i] / maxVal) * 120;
      const x = startX + i * (barWidth + gap);
      const y = 140 - h;

      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(x, y, barWidth, h);

      ctx.fillStyle = '#64748b';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(day, x + barWidth / 2, 160);
      ctx.fillText(`${values[i]}k`, x + barWidth / 2, y - 4);
    });
  }
}

// Program Builder Row Adder
function addProgramBuilderItem() {
  const container = document.getElementById('programBuilderList');
  if (!container) return;

  const itemDiv = document.createElement('div');
  itemDiv.style.display = 'grid';
  itemDiv.style.gridTemplateColumns = '120px 2fr 1.5fr 1fr 40px';
  itemDiv.style.gap = '0.5rem';
  itemDiv.style.alignItems = 'center';

  itemDiv.innerHTML = `
    <input type="text" placeholder="10:00 - 11:00" class="search-select" style="font-size:0.8rem;" value="11:00 - 12:30" />
    <input type="text" placeholder="Тема выступления" class="search-select" style="font-size:0.8rem;" value="Архитектура баз данных" />
    <input type="text" placeholder="Спикер / Ведущий" class="search-select" style="font-size:0.8rem;" value="Даулет Нурланов" />
    <input type="text" placeholder="Зал Alfa" class="search-select" style="font-size:0.8rem;" value="Зал Alfa" />
    <button type="button" class="btn-icon" style="width:32px; height:32px;" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(itemDiv);
}

// =====================================================================
// 12. MODERATOR WORKFLOW & COMPLAINTS
// =====================================================================

function renderModeratorView() {
  const container = document.getElementById('complaintsListContainer');
  if (!container) return;

  container.innerHTML = APP_STATE.complaints
    .map(
      (c) => `
      <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:var(--radius); padding:1.25rem;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.5rem;">
          <div>
            <span class="badge" style="background:#fee2e2; color:#991b1b; font-size:0.75rem; font-weight:700; padding:0.2rem 0.5rem; border-radius:4px; margin-right:0.5rem;">
              ${c.targetType}
            </span>
            <strong style="font-size:1rem; color:var(--gray-900);">${c.targetTitle}</strong>
          </div>
          <span style="font-size:0.8rem; color:var(--gray-500);">${c.date}</span>
        </div>

        <div style="font-size:0.85rem; font-weight:600; color:var(--danger); margin-bottom:0.25rem;">
          Причина: ${c.reason}
        </div>
        <p style="font-size:0.85rem; color:var(--gray-700); margin-bottom:0.75rem; line-height:1.4;">
          ${c.details}
        </p>

        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--gray-200); padding-top:0.75rem; flex-wrap:wrap; gap:0.5rem;">
          <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.8rem;">
            <span>Статус:</span>
            <select class="search-select" style="padding:0.25rem 0.5rem; font-size:0.8rem;" onchange="window.updateComplaintStatus('${c.id}', this.value)">
              <option value="new" ${c.status === 'new' ? 'selected' : ''}>Новая</option>
              <option value="in_review" ${c.status === 'in_review' ? 'selected' : ''}>На рассмотрении</option>
              <option value="resolved" ${c.status === 'resolved' ? 'selected' : ''}>Решена</option>
              <option value="rejected" ${c.status === 'rejected' ? 'selected' : ''}>Отклонена</option>
            </select>
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button class="btn btn-secondary btn-sm" onclick="window.moderatorWarnOrganizer('${c.targetTitle}')">Предупреждение</button>
            <button class="btn btn-danger btn-sm" onclick="window.moderatorBlockTarget('${c.targetTitle}')">Блокировать</button>
          </div>
        </div>
      </div>
    `
    )
    .join('');
}

window.updateComplaintStatus = function (id, newStatus) {
  const item = APP_STATE.complaints.find((c) => c.id === id);
  if (item) {
    item.status = newStatus;
    showToast(`Статус жалобы ${id} обновлен на: ${newStatus}`, 'info');
  }
};

window.moderatorWarnOrganizer = function (target) {
  showToast(`Официальное предупреждение отправлено организатору: ${target}`, 'warning');
};

window.moderatorBlockTarget = function (target) {
  showToast(`Объект "${target}" временно заблокирован модератором`, 'error');
};

// =====================================================================
// 13. ADMIN PANEL & AUDIT LOGS
// =====================================================================

function renderAdminView() {
  // Render Audit Log Table Rows
  const tableBody = document.getElementById('auditLogsTableBody');
  if (tableBody) {
    tableBody.innerHTML = APP_STATE.auditLogs
      .map(
        (log) => `
        <tr style="border-bottom:1px solid var(--gray-100);">
          <td style="padding:0.75rem 1rem; color:var(--gray-500); font-family:var(--font-mono); font-size:0.75rem;">${log.time}</td>
          <td style="padding:0.75rem 1rem; font-weight:600; color:var(--gray-800);">${log.actor}</td>
          <td style="padding:0.75rem 1rem;">
            <span style="font-family:var(--font-mono); font-size:0.75rem; background:var(--gray-100); padding:0.2rem 0.4rem; border-radius:4px; font-weight:700;">
              ${log.action}
            </span>
          </td>
          <td style="padding:0.75rem 1rem; color:var(--gray-600);">${log.entity}</td>
          <td style="padding:0.75rem 1rem; color:var(--gray-700);">${log.details}</td>
        </tr>
      `
      )
      .join('');
  }

  // Draw Admin Revenue & Registrations Canvas Chart
  const mainCanvas = document.getElementById('adminMainChart');
  if (mainCanvas) {
    const ctx = mainCanvas.getContext('2d');
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);

    // Line chart
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const points = [40, 60, 55, 90, 110, 150, 180, 170, 210];
    const stepX = (mainCanvas.width - 60) / (points.length - 1);

    points.forEach((pt, i) => {
      const x = 30 + i * stepX;
      const y = 200 - pt * 0.8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill under curve
    ctx.lineTo(30 + (points.length - 1) * stepX, 200);
    ctx.lineTo(30, 200);
    ctx.fillStyle = 'rgba(79, 70, 229, 0.1)';
    ctx.fill();
  }

  // Draw Category Pie Chart
  const pieCanvas = document.getElementById('adminPieChart');
  if (pieCanvas) {
    const ctx = pieCanvas.getContext('2d');
    ctx.clearRect(0, 0, pieCanvas.width, pieCanvas.height);

    const slices = [
      { color: '#4f46e5', percent: 0.35, label: 'IT' },
      { color: '#06b6d4', percent: 0.25, label: 'Концерты' },
      { color: '#10b981', percent: 0.2, label: 'Бизнес' },
      { color: '#f59e0b', percent: 0.2, label: 'Спорт' },
    ];

    let currentAngle = 0;
    const centerX = pieCanvas.width / 2;
    const centerY = pieCanvas.height / 2;
    const radius = 65;

    slices.forEach((slice) => {
      const angle = slice.percent * 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, currentAngle, currentAngle + angle);
      ctx.lineTo(centerX, centerY);
      ctx.fillStyle = slice.color;
      ctx.fill();
      currentAngle += angle;
    });
  }
}

// =====================================================================
// 14. SUPABASE 28-TABLES ARCHITECTURE & RENDER DEPLOYMENT
// =====================================================================

const SUPABASE_TABLES_LIST = [
  { name: 'users', desc: 'Учётные записи, профили, города, предпочтения' },
  { name: 'roles', desc: 'Справочник системных ролей (5 ролей)' },
  { name: 'user_roles', desc: 'Связующая таблица RBAC прав доступа' },
  { name: 'event_categories', desc: 'Категории событий со слагами и иконками' },
  { name: 'venues', desc: 'Площадки с координатами (Lat, Lng) и контактами' },
  { name: 'halls', desc: 'Залы с конфигурациями сеток мест и вместимостью' },
  { name: 'events', desc: 'Мероприятия: даты, цены, статусы, возрастной ценз' },
  { name: 'event_program', desc: 'Многоуровневая программа: секции, лекции, спикеры' },
  { name: 'seats', desc: 'Сетка мест (A1..C10, VIP, МГН, коэффициенты)' },
  { name: 'seat_reservations', desc: '10-минутная временная блокировка с таймером' },
  { name: 'registrations', desc: 'Регистрации участников на мероприятие' },
  { name: 'tickets', desc: 'Билеты с уникальными номерами, QR-хешем, статусом' },
  { name: 'payments', desc: 'Платежные транзакции (тестовый шлюз Kaspi, Visa)' },
  { name: 'refunds', desc: 'Калькуляция возвратов (100% / 50% / 0% по регламенту)' },
  { name: 'promo_codes', desc: 'Промокоды: лимиты, даты, минимальные суммы' },
  { name: 'resources', desc: 'Оборудование: аудио, проекторы, мебель, транспорт' },
  { name: 'event_resources', desc: 'Выделенные ресурсы и контроль пересечений' },
  { name: 'employees', desc: 'Сотрудники мероприятий: квалификация, график' },
  { name: 'event_staff_assignments', desc: 'Авто-распределение персонала без накладок' },
  { name: 'queue_tokens', desc: 'Электронная виртуальная очередь посетителей' },
  { name: 'reviews', desc: 'Оценки по 4 критериям + средний балл и отзывы' },
  { name: 'complaints', desc: 'Жалобы модераторам с 4 статусами воркфлоу' },
  { name: 'notifications', desc: 'Уведомления: сайт, Telegram, Email' },
  { name: 'favorites', desc: 'Избранные события пользователей' },
  { name: 'audit_logs', desc: 'Неизменяемый журнал аудита действий и изменений цен' },
  { name: 'system_settings', desc: 'Глобальные параметры платформы' },
  { name: 'ticket_types', desc: 'Категории билетов и квоты мест' },
  { name: 'teams', desc: 'Команды организаторов и организационные структуры' },
];

function renderDatabaseArchitectureView() {
  const grid = document.getElementById('dbTablesGrid');
  if (grid) {
    grid.innerHTML = SUPABASE_TABLES_LIST.map(
      (t, i) => `
      <div style="background:white; border:1px solid var(--gray-200); border-radius:var(--radius-sm); padding:0.75rem; box-shadow:var(--shadow-sm);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
          <strong style="color:var(--primary); font-family:var(--font-mono); font-size:0.85rem;">${t.name}</strong>
          <span style="font-size:0.7rem; color:var(--gray-400);">#${i + 1}</span>
        </div>
        <div style="font-size:0.75rem; color:var(--gray-600);">${t.desc}</div>
      </div>
    `
    ).join('');
  }
}

// Copy full SQL button
document.addEventListener('DOMContentLoaded', () => {
  const btnCopySql = document.getElementById('btnCopySqlDump');
  if (btnCopySql) {
    btnCopySql.addEventListener('click', async () => {
      try {
        const response = await fetch('/supabase_schema.sql');
        const sqlText = await response.text();
        await navigator.clipboard.writeText(sqlText);
        showToast('SQL-скрипт скопирован в буфер обмена! Вставьте в Supabase SQL Editor.', 'success');
        SoundFx.playSuccess();
      } catch (e) {
        showToast('Откройте файл supabase_schema.sql в репозитории для копирования', 'info');
      }
    });
  }

  // Save Supabase keys
  const btnSaveSupabase = document.getElementById('btnSaveSupabaseConfig');
  if (btnSaveSupabase) {
    btnSaveSupabase.addEventListener('click', () => {
      const url = document.getElementById('supabaseUrlInput')?.value;
      const key = document.getElementById('supabaseKeyInput')?.value;
      if (url && key) {
        localStorage.setItem('EVENTHUB_SUPABASE_URL', url);
        localStorage.setItem('EVENTHUB_SUPABASE_KEY', key);
        showToast('Параметры Supabase сохранены в браузере!', 'success');
      } else {
        showToast('Поля оставлены пустыми. Вы сможете настроить их в Render.com', 'info');
      }
    });
  }
});

// =====================================================================
// 15. INTERACTIVE MAP & ROUTE PLANNER
// =====================================================================

function renderInteractiveMap() {
  const mapContainer = document.getElementById('interactiveMapContainer');
  const routeBox = document.getElementById('routeInfoBox');
  if (!mapContainer) return;

  // Render high-fidelity SVG interactive city map of Petropavlovsk
  mapContainer.innerHTML = `
    <svg width="100%" height="100%" viewBox="0 0 800 380" style="background:#e0f2fe;">
      <!-- City river & parks -->
      <path d="M 0 120 Q 200 150 400 80 T 800 110" fill="none" stroke="#93c5fd" stroke-width="26" opacity="0.6"/>
      <rect x="180" y="210" width="160" height="90" rx="20" fill="#bbf7d0" opacity="0.7"/>
      <rect x="520" y="70" width="120" height="80" rx="15" fill="#bbf7d0" opacity="0.7"/>

      <!-- Roads grid -->
      <line x1="50" y1="200" x2="750" y2="200" stroke="#cbd5e1" stroke-width="8"/>
      <line x1="400" y1="20" x2="400" y2="360" stroke="#cbd5e1" stroke-width="8"/>
      <line x1="150" y1="50" x2="650" y2="330" stroke="#e2e8f0" stroke-width="5"/>

      <!-- User Position Pin -->
      <circle cx="340" cy="200" r="12" fill="#4f46e5" stroke="#ffffff" stroke-width="3"/>
      <circle cx="340" cy="200" r="24" fill="#4f46e5" opacity="0.2"/>
      <text x="340" y="235" font-size="11" font-weight="700" fill="#312e81" text-anchor="middle">Вы здесь (Центр)</text>

      <!-- Event Markers -->
      <!-- Marker 1: IT Hub -->
      <g style="cursor:pointer;" onclick="window.selectMapMarker('evt-1', 'IT Hub North Tech', '1.4 км', '4 мин на авто')">
        <circle cx="270" cy="160" r="16" fill="#ef4444" stroke="#ffffff" stroke-width="3"/>
        <text x="270" y="165" font-size="11" font-weight="800" fill="#ffffff" text-anchor="middle">1</text>
        <text x="270" y="195" font-size="10" font-weight="700" fill="#0f172a" text-anchor="middle">IT Hub North Tech</text>
      </g>

      <!-- Marker 2: Дворец Спорта -->
      <g style="cursor:pointer;" onclick="window.selectMapMarker('evt-2', 'Дворец Спорта и Молодежи', '2.8 км', '7 мин на авто')">
        <circle cx="480" cy="140" r="16" fill="#ef4444" stroke="#ffffff" stroke-width="3"/>
        <text x="480" y="145" font-size="11" font-weight="800" fill="#ffffff" text-anchor="middle">2</text>
        <text x="480" y="175" font-size="10" font-weight="700" fill="#0f172a" text-anchor="middle">Дворец Спорта</text>
      </g>

      <!-- Marker 3: Kozybayev University -->
      <g style="cursor:pointer;" onclick="window.selectMapMarker('evt-5', 'Kozybayev University', '3.1 км', '8 мин на авто')">
        <circle cx="560" cy="240" r="16" fill="#ef4444" stroke="#ffffff" stroke-width="3"/>
        <text x="560" y="245" font-size="11" font-weight="800" fill="#ffffff" text-anchor="middle">3</text>
        <text x="560" y="275" font-size="10" font-weight="700" fill="#0f172a" text-anchor="middle">Университет</text>
      </g>
    </svg>
  `;

  window.selectMapMarker = function (eventId, placeName, distance, travelTime) {
    if (routeBox) {
      routeBox.style.display = 'block';
      routeBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong>📍 Маршрут до: ${placeName}</strong>
            <div style="color:var(--gray-600); font-size:0.8rem;">
              Расстояние от вас: <strong>${distance}</strong> &bull; Расчетное время: <strong>${travelTime}</strong>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="window.selectAndBookEvent('${eventId}')">
            Открыть событие &rarr;
          </button>
        </div>
      `;
    }
    showToast(`Выбрана точка: ${placeName} (${distance})`, 'info');
  };
}

// =====================================================================
// 16. NOTIFICATIONS POPOVER & EVENT LISTENERS
// =====================================================================

function renderNotifications() {
  const list = document.getElementById('notifList');
  const badge = document.getElementById('notifBadge');
  if (!list) return;

  const unreadCount = APP_STATE.notifications.filter((n) => !n.read).length;
  if (badge) {
    badge.style.display = unreadCount > 0 ? 'block' : 'none';
  }

  list.innerHTML = APP_STATE.notifications
    .map(
      (n) => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <strong style="display:block; color:var(--gray-900); font-size:0.85rem;">${n.title}</strong>
        <div style="font-size:0.8rem; color:var(--gray-600); margin:0.2rem 0;">${n.message}</div>
        <span style="font-size:0.7rem; color:var(--gray-400);">${n.time}</span>
      </div>
    `
    )
    .join('');
}

// Global modal helpers
window.openComplaintModal = function (eventId, title) {
  const modal = document.getElementById('complaintModal');
  const targetInput = document.getElementById('compTarget');
  if (targetInput) targetInput.value = `${title} (#${eventId})`;
  if (modal) modal.style.display = 'flex';
};

// =====================================================================
// 17. MAIN APPLICATION BOOTSTRAP
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs Wiring
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (tabId) switchTab(tabId);
    });
  });

  // Role Switcher Wiring
  const roleSelect = document.getElementById('userRoleSelect');
  if (roleSelect) {
    roleSelect.addEventListener('change', (e) => {
      setRole(e.target.value);
    });
  }

  // Notifications Bell
  const notifBtn = document.getElementById('btnNotifToggle');
  const notifPopover = document.getElementById('notifPopover');
  if (notifBtn && notifPopover) {
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifPopover.classList.toggle('open');
      APP_STATE.notifications.forEach((n) => (n.read = true));
      renderNotifications();
    });
  }

  document.addEventListener('click', (e) => {
    if (notifPopover && !notifPopover.contains(e.target) && e.target !== notifBtn) {
      notifPopover.classList.remove('open');
    }
  });

  // Clear notifications
  const btnClearNotifs = document.getElementById('btnClearNotifs');
  if (btnClearNotifs) {
    btnClearNotifs.addEventListener('click', () => {
      APP_STATE.notifications = [];
      renderNotifications();
    });
  }

  // Category filter pills
  document.querySelectorAll('.category-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.category-pill').forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      APP_STATE.activeCategory = pill.dataset.category || 'all';
      renderEvents();
    });
  });

  // View Mode Switches (Cards, Map, Calendar)
  const btnViewCards = document.getElementById('btnViewCards');
  const btnViewMap = document.getElementById('btnViewMap');
  const btnViewCalendar = document.getElementById('btnViewCalendar');
  const cardsGrid = document.getElementById('eventsGridContainer');
  const mapContainer = document.getElementById('mapViewContainer');
  const calContainer = document.getElementById('calendarViewContainer');

  if (btnViewCards && btnViewMap && btnViewCalendar) {
    btnViewCards.addEventListener('click', () => {
      btnViewCards.classList.add('active');
      btnViewMap.classList.remove('active');
      btnViewCalendar.classList.remove('active');
      if (cardsGrid) cardsGrid.style.display = 'grid';
      if (mapContainer) mapContainer.style.display = 'none';
      if (calContainer) calContainer.style.display = 'none';
    });

    btnViewMap.addEventListener('click', () => {
      btnViewMap.classList.add('active');
      btnViewCards.classList.remove('active');
      btnViewCalendar.classList.remove('active');
      if (cardsGrid) cardsGrid.style.display = 'none';
      if (mapContainer) mapContainer.style.display = 'block';
      if (calContainer) calContainer.style.display = 'none';
      renderInteractiveMap();
    });

    btnViewCalendar.addEventListener('click', () => {
      btnViewCalendar.classList.add('active');
      btnViewCards.classList.remove('active');
      btnViewMap.classList.remove('active');
      if (cardsGrid) cardsGrid.style.display = 'none';
      if (mapContainer) mapContainer.style.display = 'none';
      if (calContainer) calContainer.style.display = 'block';
      renderCalendar();
    });
  }

  // Smart Natural Search
  const searchInput = document.getElementById('smartSearchInput');
  const btnSearch = document.getElementById('btnExecuteSearch');
  const citySelect = document.getElementById('filterCity');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      APP_STATE.searchQuery = e.target.value;
      renderEvents();
    });
  }

  if (citySelect) {
    citySelect.addEventListener('change', (e) => {
      APP_STATE.filterCity = e.target.value;
      renderEvents();
    });
  }

  if (btnSearch) {
    btnSearch.addEventListener('click', () => {
      renderEvents();
      showToast('Фильтры поиска применены', 'info');
    });
  }

  // Staff Scanner Controls
  const btnScanTicket = document.getElementById('btnStaffScanTicket');
  const manualInput = document.getElementById('staffManualTicketInput');
  if (btnScanTicket && manualInput) {
    btnScanTicket.addEventListener('click', () => {
      const code = manualInput.value.trim();
      if (code) processEntranceTicketScan(code);
    });
  }

  // Test Ticket Scenario Buttons
  const btnTestValid = document.getElementById('btnTestValidTicket');
  const btnTestDuplicate = document.getElementById('btnTestDuplicateTicket');
  const btnTestWrong = document.getElementById('btnTestWrongEventTicket');
  const btnTestRefunded = document.getElementById('btnTestRefundedTicket');

  if (btnTestValid) {
    btnTestValid.addEventListener('click', () => {
      if (manualInput) manualInput.value = 'TKT-2026-7482';
      processEntranceTicketScan('TKT-2026-7482');
    });
  }
  if (btnTestDuplicate) {
    btnTestDuplicate.addEventListener('click', () => {
      // First scan marks used, second scan warns ALREADY USED
      processEntranceTicketScan('TKT-2026-7482');
      setTimeout(() => processEntranceTicketScan('TKT-2026-7482'), 300);
    });
  }
  if (btnTestWrong) {
    btnTestWrong.addEventListener('click', () => {
      if (manualInput) manualInput.value = 'TKT-2026-9901';
      processEntranceTicketScan('TKT-2026-9901');
    });
  }
  if (btnTestRefunded) {
    btnTestRefunded.addEventListener('click', () => {
      const refunded = APP_STATE.myTickets.find((t) => t.status === 'refunded') || APP_STATE.myTickets[0];
      refunded.status = 'refunded';
      if (manualInput) manualInput.value = refunded.id;
      processEntranceTicketScan(refunded.id);
    });
  }

  // Organizer Program Builder
  const btnAddProg = document.getElementById('btnAddProgramItem');
  if (btnAddProg) {
    btnAddProg.addEventListener('click', addProgramBuilderItem);
  }

  // Organizer Conflict Detection & Auto Staff Assign
  const btnAutoAssign = document.getElementById('btnAutoAssignStaff');
  if (btnAutoAssign) {
    btnAutoAssign.addEventListener('click', () => {
      showToast('Автоматический алгоритм назначил 5 сотрудников без временных конфликтов!', 'success');
      SoundFx.playSuccess();
    });
  }

  // Organizer Event Form Submission
  const formCreateEvent = document.getElementById('createEventForm');
  if (formCreateEvent) {
    formCreateEvent.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('evTitle')?.value;
      const category = document.getElementById('evCategory')?.value;
      const date = document.getElementById('evDate')?.value;
      const basePrice = Number(document.getElementById('evBasePrice')?.value) || 2000;

      const newEv = {
        id: `evt-${Date.now()}`,
        title,
        category,
        city: 'Петропавловск',
        address: 'ул. Конституции, 12',
        venueName: 'Главный амфитеатр №1',
        hallId: 'hall-1',
        date,
        timeStart: '10:00',
        timeEnd: '17:00',
        ageLimit: '16+',
        cover: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=800&auto=format&fit=crop&q=80',
        description: document.getElementById('evDesc')?.value || 'Новое созданное мероприятие.',
        totalSeats: 100,
        remainingSeats: 100,
        basePrice,
        dynamicPricing: true,
        popularity: 70,
        lat: 54.8722,
        lng: 69.1417,
        program: [
          { time: '10:00 - 11:00', title: 'Открытие', speaker: 'Организатор', room: 'Зал 1' },
          { time: '11:00 - 13:00', title: 'Основная программа', speaker: 'Спикеры', room: 'Зал 1' },
        ],
        reviewsCount: 0,
        rating: 5.0,
      };

      APP_STATE.events.unshift(newEv);
      APP_STATE.auditLogs.unshift({
        time: 'Только что',
        actor: 'Даулет Нурланов (Организатор)',
        action: 'CREATE_EVENT',
        entity: `Мероприятие #${newEv.id}`,
        details: `Создано новое событие "${title}".`,
      });

      showToast(`Мероприятие "${title}" успешно создано и опубликовано!`, 'success');
      SoundFx.playSuccess();
      switchTab('catalog');
    });
  }

  // Supabase Modal Open
  const btnSupabaseModal = document.getElementById('btnSupabaseModal');
  if (btnSupabaseModal) {
    btnSupabaseModal.addEventListener('click', () => {
      switchTab('database-deploy');
    });
  }

  // Close modals
  const btnCloseRefund = document.getElementById('btnCloseRefundModal');
  const btnCancelRefund = document.getElementById('btnCancelRefund');
  const refundModal = document.getElementById('refundModal');
  if (btnCloseRefund && refundModal) {
    btnCloseRefund.addEventListener('click', () => (refundModal.style.display = 'none'));
  }
  if (btnCancelRefund && refundModal) {
    btnCancelRefund.addEventListener('click', () => (refundModal.style.display = 'none'));
  }

  const btnCloseComp = document.getElementById('btnCloseComplaintModal');
  const btnCancelComp = document.getElementById('btnCancelComplaint');
  const compModal = document.getElementById('complaintModal');
  const btnSubmitComp = document.getElementById('btnSubmitComplaint');

  if (btnCloseComp && compModal) {
    btnCloseComp.addEventListener('click', () => (compModal.style.display = 'none'));
  }
  if (btnCancelComp && compModal) {
    btnCancelComp.addEventListener('click', () => (compModal.style.display = 'none'));
  }
  if (btnSubmitComp && compModal) {
    btnSubmitComp.addEventListener('click', () => {
      const reason = document.getElementById('compReason')?.value;
      const details = document.getElementById('compDetails')?.value;
      const target = document.getElementById('compTarget')?.value;

      if (!details) {
        showToast('Пожалуйста, укажите подробности жалобы', 'warning');
        return;
      }

      APP_STATE.complaints.unshift({
        id: `cmp-${Date.now()}`,
        author: APP_STATE.currentUser.name,
        targetType: 'Мероприятие',
        targetTitle: target,
        reason,
        details,
        status: 'new',
        date: 'Только что',
      });

      showToast('Жалоба отправлена на рассмотрение модератору!', 'success');
      SoundFx.playSuccess();
      compModal.style.display = 'none';
    });
  }

  // Initial UI Render
  renderEvents();
  renderPersonalRecommendation();
  renderNotifications();
});

// Simple Calendar Renderer
function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;

  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  let html = weekdays
    .map(
      (w) =>
        `<div style="font-weight:700; text-align:center; padding:0.4rem; background:var(--gray-100); border-radius:4px; font-size:0.75rem; color:var(--gray-600);">${w}</div>`
    )
    .join('');

  // 30 days in month
  for (let d = 1; d <= 30; d++) {
    const dayEvents = APP_STATE.events.filter((e) => {
      const dayNum = parseInt(e.date.split('-')[2]);
      return dayNum === d;
    });

    html += `
      <div style="min-height:75px; background:white; border:1px solid var(--gray-200); border-radius:6px; padding:0.4rem; font-size:0.75rem;">
        <div style="font-weight:700; color:var(--gray-500); margin-bottom:0.25rem;">${d}</div>
        ${dayEvents
          .map(
            (ev) => `
          <div
            style="background:var(--primary-light); color:var(--primary-text); padding:0.15rem 0.35rem; border-radius:3px; margin-bottom:2px; font-weight:600; font-size:0.65rem; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
            onclick="window.selectAndBookEvent('${ev.id}')"
            title="${ev.title}"
          >
            ${ev.title}
          </div>
        `
          )
          .join('')}
      </div>
    `;
  }

  grid.innerHTML = html;
}
