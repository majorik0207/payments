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

async function main() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = MONTHS_GEN[month];

  // Load all payments and paid marks
  const [payments, paidMarks] = await Promise.all([
    api('payments?order=day.asc'),
    api(`paid_marks?year=eq.${year}&month=eq.${month}`)
  ]);

  const paidIds = new Set(paidMarks.map(p => p.payment_id));

  // Filter active payments for this month
  const active = payments.filter(p => {
    if (p.months === 0) return true;
    const startIdx = p.start_year * 12 + p.start_month;
    const endIdx = startIdx + p.months - 1;
    const curIdx = year * 12 + month;
    return curIdx >= startIdx && curIdx <= endIdx;
  });

  // Today's payments (not yet paid)
  const todayPayments = active.filter(p => {
    const day = Math.min(p.day, daysInMonth);
    return day === today && !paidIds.has(p.id);
  });

  // Upcoming in next 3 days (not yet paid)
  const upcomingPayments = active.filter(p => {
    const day = Math.min(p.day, daysInMonth);
    return day > today && day <= today + 3 && !paidIds.has(p.id);
  });

  // Overdue (not yet paid)
  const overduePayments = active.filter(p => {
    const day = Math.min(p.day, daysInMonth);
    return day < today && !paidIds.has(p.id);
  });

  let lines = [];

  if (todayPayments.length > 0) {
    lines.push('💳 <b>Сегодня нужно оплатить:</b>');
    todayPayments.forEach(p => {
      lines.push(`📌 ${p.name} — <b>${Number(p.amount).toLocaleString('ru-RU')} руб.</b> (${today} ${monthName})`);
    });
  }

  if (upcomingPayments.length > 0) {
    if (lines.length) lines.push('');
    lines.push('🔔 <b>Предстоит в ближайшие дни:</b>');
    upcomingPayments.forEach(p => {
      const day = Math.min(p.day, daysInMonth);
      lines.push(`📌 ${p.name} — <b>${Number(p.amount).toLocaleString('ru-RU')} руб.</b> (${day} ${monthName})`);
    });
  }

  if (overduePayments.length > 0) {
    if (lines.length) lines.push('');
    lines.push('⚠️ <b>Просрочено (не оплачено):</b>');
    overduePayments.forEach(p => {
      const day = Math.min(p.day, daysInMonth);
      lines.push(`❗ ${p.name} — <b>${Number(p.amount).toLocaleString('ru-RU')} руб.</b> (было ${day} ${monthName})`);
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

main().catch(e => { console.error(e); process.exit(1); });
