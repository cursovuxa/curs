/**
 * EventHub Pro - Production Backend Server for Render.com & Local
 * Supports Express, REST API endpoints, Supabase Proxy, and Static SPA serving.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Supabase environment variables placeholders (user will set in Render.com environment)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xyzcompany.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJh...mock-supabase-key';

// In-Memory Database store with rich seed data for instant coursework demonstration
let auditLogs = [
  {
    id: 'log-1',
    actorName: 'Администратор Системы',
    action: 'SYSTEM_BOOT',
    entityType: 'System',
    entityId: 'SYS-01',
    details: 'Инициализация платформы EventHub Pro. Проверка связности базы данных.',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: 'log-2',
    actorName: 'Даулет Нурланов (Организатор)',
    action: 'CREATE_EVENT',
    entityType: 'Event',
    entityId: 'evt-1',
    details: 'Создано мероприятие "Северный IT-Форум: Архитектура и ИИ 2026"',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
  },
  {
    id: 'log-3',
    actorName: 'Даулет Нурланов (Организатор)',
    action: 'SET_DYNAMIC_PRICING',
    entityType: 'Event',
    entityId: 'evt-1',
    details: 'Активировано динамическое ценообразование: шаг +25% при <50 мест, +50% при <20 мест',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'log-4',
    actorName: 'Алексей Смирнов (Посетитель)',
    action: 'RESERVE_SEAT',
    entityType: 'Seat',
    entityId: 'B3',
    details: 'Временная блокировка места B3 на 10 минут (таймер удержания).',
    timestamp: new Date(Date.now() - 3600000 * 1).toISOString(),
  },
  {
    id: 'log-5',
    actorName: 'Алексей Смирнов (Посетитель)',
    action: 'TICKET_PURCHASED',
    entityType: 'Ticket',
    entityId: 'TKT-7482',
    details: 'Успешная оплата билета TKT-7482 со скидкой 20% (промокод WELCOME20). Место B3.',
    timestamp: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: 'log-6',
    actorName: 'Ерлан Сагындыков (Сотрудник)',
    action: 'CHECK_IN_TICKET',
    entityType: 'Ticket',
    entityId: 'TKT-9901',
    details: 'Успешный пропуск посетителя через терминал входа. Место A2.',
    timestamp: new Date(Date.now() - 600000).toISOString(),
  },
];

let promoCodes = [
  {
    code: 'WELCOME20',
    discountPercent: 20,
    minAmount: 1000,
    maxUses: 100,
    currentUses: 14,
    onlyNewUsers: true,
    expiresAt: '2026-12-31',
  },
  {
    code: 'DEV2026',
    discountPercent: 15,
    minAmount: 2000,
    maxUses: 50,
    currentUses: 8,
    onlyNewUsers: false,
    expiresAt: '2026-12-31',
  },
  {
    code: 'STUDENT',
    discountPercent: 30,
    minAmount: 500,
    maxUses: 200,
    currentUses: 45,
    onlyNewUsers: false,
    expiresAt: '2026-12-31',
  },
];

let complaints = [
  {
    id: 'cmp-1',
    author: 'Иван Сергеев',
    targetType: 'Мероприятие',
    targetTitle: 'Фестиваль Рок-Волна',
    reason: 'Несоответствие заявленного звукового оборудования',
    details: 'В описании был указан зал 1 с акустикой Dolby, по факту перенесли в малый лекторий.',
    status: 'new',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    id: 'cmp-2',
    author: 'Мадина А.',
    targetType: 'Организатор',
    targetTitle: 'EventPro Global',
    reason: 'Задержка начала на 45 минут без уведомления',
    details: 'Слушатели стояли в фойе, расписание сдвинулось, пропустили обратный поезд.',
    status: 'in_review',
    moderatorNotes: 'Запрошено объяснение у организатора EventPro Global.',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

let employeesList = [
  { id: 'emp-1', name: 'Ерлан Сагындыков', role: 'контролёр', qualification: 'senior', assignedCount: 3, busyDateStrings: [] },
  { id: 'emp-2', name: 'Динара Жумабаева', role: 'контролёр', qualification: 'middle', assignedCount: 1, busyDateStrings: [] },
  { id: 'emp-3', name: 'Айбек Темиров', role: 'координатор', qualification: 'lead', assignedCount: 2, busyDateStrings: [] },
  { id: 'emp-4', name: 'Светлана Ким', role: 'хостес', qualification: 'senior', assignedCount: 0, busyDateStrings: [] },
  { id: 'emp-5', name: 'Нурсултан Омаров', role: 'техник', qualification: 'lead', assignedCount: 4, busyDateStrings: [] },
  { id: 'emp-6', name: 'Жанель Сейтжанова', role: 'контролёр', qualification: 'junior', assignedCount: 0, busyDateStrings: [] },
];

// In-Memory Seat Holds (seatId -> { userId, expiresAt })
let seatHolds = {};

// Clean up expired holds every 10 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, hold] of Object.entries(seatHolds)) {
    if (hold.expiresAt < now) {
      delete seatHolds[key];
    }
  }
}, 10000);

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'EventHub Pro',
    environment: process.env.NODE_ENV || 'production',
    supabaseConnected: Boolean(process.env.SUPABASE_URL),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/supabase-info', (req, res) => {
  res.json({
    configured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    url: SUPABASE_URL,
    hint: 'Добавьте SUPABASE_URL и SUPABASE_ANON_KEY в настройках переменных окружения Render.com',
  });
});

app.get('/api/audit-logs', (req, res) => {
  res.json({ logs: auditLogs });
});

app.post('/api/audit-logs', (req, res) => {
  const { actorName, action, entityType, entityId, details } = req.body;
  const newLog = {
    id: `log-${Date.now()}`,
    actorName: actorName || 'Пользователь',
    action: action || 'ACTION',
    entityType: entityType || 'General',
    entityId: entityId || '',
    details: details || '',
    timestamp: new Date().toISOString(),
  };
  auditLogs.unshift(newLog);
  res.json({ success: true, log: newLog });
});

app.get('/api/promo/validate', (req, res) => {
  const code = (req.query.code || '').toString().toUpperCase();
  const total = Number(req.query.total || 0);
  const promo = promoCodes.find((p) => p.code === code);

  if (!promo) {
    return res.status(404).json({ success: false, message: 'Промокод не найден' });
  }

  if (promo.currentUses >= promo.maxUses) {
    return res.status(400).json({ success: false, message: 'Лимит использований промокода исчерпан' });
  }

  if (promo.minAmount && total < promo.minAmount) {
    return res.status(400).json({
      success: false,
      message: `Минимальная сумма для промокода: ${promo.minAmount} ₸`,
    });
  }

  const discount = Math.round((total * promo.discountPercent) / 100);
  res.json({
    success: true,
    promoCode: promo.code,
    discountPercent: promo.discountPercent,
    discountAmount: discount,
    finalTotal: Math.max(0, total - discount),
  });
});

app.get('/api/complaints', (req, res) => {
  res.json({ complaints });
});

app.post('/api/complaints', (req, res) => {
  const { author, targetType, targetTitle, reason, details } = req.body;
  const newComplaint = {
    id: `cmp-${Date.now()}`,
    author: author || 'Анонимный посетитель',
    targetType: targetType || 'Мероприятие',
    targetTitle: targetTitle || 'Общий объект',
    reason: reason || 'Нарушение правил',
    details: details || '',
    status: 'new',
    createdAt: new Date().toISOString(),
  };
  complaints.unshift(newComplaint);
  res.json({ success: true, complaint: newComplaint });
});

app.patch('/api/complaints/:id', (req, res) => {
  const { id } = req.params;
  const { status, moderatorNotes } = req.body;
  const item = complaints.find((c) => c.id === id);
  if (!item) return res.status(404).json({ error: 'Жалоба не найдена' });

  if (status) item.status = status;
  if (moderatorNotes) item.moderatorNotes = moderatorNotes;
  res.json({ success: true, complaint: item });
});

app.get('/api/staff', (req, res) => {
  res.json({ staff: employeesList });
});

app.post('/api/staff/auto-assign', (req, res) => {
  const { requiredCount = 3, role = 'контролёр', dateString = '2026-11-06' } = req.body;
  const available = employeesList
    .filter((e) => e.role === role && !e.busyDateStrings.includes(dateString))
    .sort((a, b) => a.assignedCount - b.assignedCount);

  const assigned = available.slice(0, requiredCount);
  assigned.forEach((e) => e.assignedCount++);

  res.json({
    success: true,
    assigned,
    missing: Math.max(0, requiredCount - assigned.length),
  });
});

app.get('/api/seats/status', (req, res) => {
  const { eventId = 'evt-1' } = req.query;
  const now = Date.now();
  const activeHolds = {};
  for (const [key, hold] of Object.entries(seatHolds)) {
    if (hold.eventId === eventId && hold.expiresAt > now) {
      activeHolds[hold.seatId] = {
        reservedUntil: hold.expiresAt,
        userId: hold.userId,
      };
    }
  }
  res.json({ activeHolds });
});

app.post('/api/seats/hold', (req, res) => {
  const { eventId = 'evt-1', seatId, userId = 'user-alex' } = req.body;
  if (!seatId) return res.status(400).json({ error: 'Seat ID required' });

  const now = Date.now();
  const existing = seatHolds[`${eventId}_${seatId}`];
  if (existing && existing.expiresAt > now && existing.userId !== userId) {
    return res.status(409).json({ error: 'Место уже удерживается другим пользователем' });
  }

  // 10 minutes hold
  const expiresAt = now + 10 * 60 * 1000;
  seatHolds[`${eventId}_${seatId}`] = {
    eventId,
    seatId,
    userId,
    expiresAt,
  };

  res.json({
    success: true,
    seatId,
    expiresAt,
    minutesLeft: 10,
    message: `Место ${seatId} временно заблокировано за вами на 10 минут`,
  });
});

// Serve static directory
app.use(express.static(__dirname));

// SPA fallback: return index.html for unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[EventHub Pro] Server running on http://0.0.0.0:${PORT}`);
});
