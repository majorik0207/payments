const SUPABASE_URL = 'https://wbzkntpkzioypzijcgyp.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];

async function api(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
    }
  });
  if (!res.ok) throw new Error('Supabase error: ' + await res.text());
  return res.json();
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error('Telegram error: ' + JSON.stringify(data));
}

function getWeeklyDatesInMonth(p, year, month) {
  const dim = new Date(year, month + 1, 0).getDate();
  const dates = [];
  for (let d = 1; d <= dim; d++) {
    const jsDay = new Date(year, month, d).getDay();
    const ourDay = jsDay === 0 ? 6 : jsDay - 1;
    if (ourDay === p.weekday) dates.push(d);
  }
  return dates;
}

function isActiveInMonth(p, y, m) {
  if (p.repeat_type === 'weekly') return true;
  if (p.months === 0) return true;
  const si = p.start_year * 12 + p.start_month, ei = si + p.months - 1, ci = y * 12 + m;
  return ci >= si && ci <= ei;
}

function getMonthOccurrences(p, y, m) {
  if (p.repeat_type === 'weekly') {
    return getWeeklyDatesInMonth(p, y, m).map(d => ({ p, day: d }));
  }
  if (!isActiveInMonth(p, y, m)) return [];
  const dim = new Date(y, m + 1, 0).getDate();
  return [{ p, day: Math.min(p.day, dim) }];
}

function isPaidOcc(p, y, m, day, paidMarks) {
  if (p.repeat_type === 'weekly') {
    return paidMarks.some(pm => pm.payment_id === p.id && pm.year === y && pm.month === m && pm.day === day);
  }
  return paidMarks.some(pm => pm.payment_id === p.id && pm.year === y && pm.month === m);
}

// Determine which run this is: standard morning run, or deadline-check run
// Triggered by env var RUN_MODE = 'standard' | 'deadline'
const RUN_MODE = process.env.RUN_MODE || 'standard';

async function main() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const monthName = MONTHS_GEN[month];
  const currentHHMM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const [payments, paidMarks] = await Promise.all([
    api('payments?order=day.asc'),
    api('paid_marks?select=*')
  ]);

  // Expand all payments into this month's occurrences
  let occurrences = [];
  payments.forEach(p => {
    occurrences.push(...getMonthOccurrences(p, year, month));
  });

  if (RUN_MODE === 'deadline') {
    // DEADLINE CHECK MODE: only look at today's payments with a deadline_time
    // that has passed (within the last ~30 min window) and are NOT paid yet
    const dueNow = occurrences.filter(o => {
      if (o.day !== today) return false;
      if (!o.p.deadline_time) return false;
      if (isPaidOcc(o.p, year, month, o.day, paidMarks)) return false;
      return o.p.deadline_time === currentHHMM || isWithinLastWindow(o.p.deadline_time, now);
    });

    if (dueNow.length === 0) {
      console.log('No overdue-deadline payments right now.');
      return;
    }

    let lines = ['⏰ <b>Внимание! Платёж не оплачен к дедлайну:</b>', ''];
    dueNow.forEach(o => {
      lines.push(`❗ ${o.p.name} — <b>${Number(o.p.amount).toLocaleString('ru-RU')} руб.</b> (дедлайн был ${o.p.deadline_time})`);
    });
    lines.push('');
    lines.push(`📲 <a href="https://t.me/majorik0207_bot/payments">Открыть и отметить оплату</a>`);

    await sendTelegram(lines.join('\n'));
    console.log('Deadline alert sent!');
    return;
  }

  // STANDARD MODE: daily morning summary (today / soon / overdue)
  const todayPayments = occurrences.filter(o => o.day === today && !isPaidOcc(o.p, year, month, o.day, paidMarks));
  const upcomingPayments = occurrences.filter(o => o.day > today && o.day <= today + 3 && !isPaidOcc(o.p, year, month, o.day, paidMarks));
  const overduePayments = occurrences.filter(o => o.day < today && !isPaidOcc(o.p, year, month, o.day, paidMarks));

  let lines = [];

  if (todayPayments.length > 0) {
    lines.push('💳 <b>Сегодня нужно оплатить:</b>');
    todayPayments.forEach(o => {
      const deadlineNote = o.p.deadline_time ? ` (до ${o.p.deadline_time})` : '';
      lines.push(`📌 ${o.p.name} — <b>${Number(o.p.amount).toLocaleString('ru-RU')} руб.</b> (${today} ${monthName}${deadlineNote})`);
    });
  }

  if (upcomingPayments.length > 0) {
    if (lines.length) lines.push('');
    lines.push('🔔 <b>Предстоит в ближайшие дни:</b>');
    upcomingPayments.forEach(o => {
      lines.push(`📌 ${o.p.name} — <b>${Number(o.p.amount).toLocaleString('ru-RU')} руб.</b> (${o.day} ${monthName})`);
    });
  }

  if (overduePayments.length > 0) {
    if (lines.length) lines.push('');
    lines.push('⚠️ <b>Просрочено (не оплачено):</b>');
    overduePayments.forEach(o => {
      lines.push(`❗ ${o.p.name} — <b>${Number(o.p.amount).toLocaleString('ru-RU')} руб.</b> (было ${o.day} ${monthName})`);
    });
  }

  if (lines.length === 0) {
    console.log('No payments to notify about today.');
    return;
  }

  lines.push('');
  lines.push(`📲 <a href="https://t.me/majorik0207_bot/payments">Открыть календарь платежей</a>`);

  await sendTelegram(lines.join('\n'));
  console.log('Notification sent successfully!');
}

function isWithinLastWindow(deadlineHHMM, now) {
  // Returns true if deadline time is within the last 35 minutes (covers cron run gaps)
  const [dh, dm] = deadlineHHMM.split(':').map(Number);
  const deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dh, dm, 0);
  const diffMin = (now - deadline) / 60000;
  return diffMin >= 0 && diffMin <= 35;
}

main().catch(e => { console.error(e); process.exit(1); });
