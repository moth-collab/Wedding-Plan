/**
 * OUR DAY · ระบบรับคำตอบแขก (Google Apps Script)
 * - เก็บคำตอบลงชีต "RSVP" ในไฟล์ Google Sheet นี้
 * - ถ้าแขกตอบ "ไปร่วมงาน" และใส่อีเมล จะเพิ่มแขกเข้าอีเวนต์งานแต่งในปฏิทิน และ Google ส่งคำเชิญให้ทางอีเมล
 * - ถ้าแขกเปลี่ยนคำตอบเป็น "ไม่สะดวก" หรือ "ยังไม่แน่ใจ" จะเอาชื่อออกจากอีเวนต์ (ไม่ส่งอีเมลแจ้ง)
 * - แขกไม่เห็นรายชื่อแขกคนอื่นในอีเวนต์
 *
 * ขั้นตอนติดตั้งอยู่ใน README.md
 */
const CONFIG = {
  SHEET_NAME: 'RSVP',
  EVENT_TITLE: 'งานแต่งงาน ชื่อของคุณ & ชื่อคู่ของคุณ',
  EVENT_DATE: '2027-10-27',      // ปปปป-ดด-วว
  START_TIME: '18:00',           // ชช:นน เวลาไทย
  END_TIME: '21:30',
  TIMEZONE: 'Asia/Bangkok',
  LOCATION: '',                  // ชื่อและที่อยู่สถานที่
  DESCRIPTION: 'ขอบคุณที่ตอบรับคำเชิญ แล้วพบกันในวันงาน',
  CALENDAR_ID: 'primary',        // ปฏิทินหลักของบัญชีที่ติดตั้งสคริปต์
  SEND_INVITES: true,            // false = เก็บลงชีตอย่างเดียว ไม่เพิ่มแขกเข้าปฏิทิน
  INVITE_CODE: ''                // ใส่รหัส (เช่น 'OURDAY27') ถ้าอยากให้เฉพาะคนที่มีการ์ดตอบได้ แล้วตั้ง askInviteCode: true ใน config.js
};

const HEADERS = ['submittedAt', 'name', 'email', 'phone', 'rsvp', 'plus', 'diet', 'side', 'message', 'calendar'];

/** รันครั้งแรกครั้งเดียวจากหน้า Apps Script (เลือกฟังก์ชัน setup แล้วกด Run) เพื่อสร้างชีตและอีเวนต์ */
function setup() {
  sheet_();
  const id = ensureEvent_();
  const ev = Calendar.Events.get(CONFIG.CALENDAR_ID, id);
  Logger.log('พร้อมใช้งาน · อีเวนต์: ' + ev.htmlLink);
}

/** ทดสอบว่า Web app ทำงาน: เปิด URL ของ Web app ในเบราว์เซอร์ */
function doGet() {
  return json_({ ok: true, service: 'OUR DAY RSVP' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    let d = {};
    try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'format' }); }
    if (d.website) return json_({ ok: true });                       // กับดักบอท
    if (CONFIG.INVITE_CODE && String(d.code || '').trim().toUpperCase() !== CONFIG.INVITE_CODE.trim().toUpperCase()) {
      return json_({ ok: false, error: 'code' });
    }
    const r = clean_(d);
    if (r.error) return json_({ ok: false, error: r.error });

    const sh = sheet_();
    const rowNo = findRow_(sh, r);
    const prev = rowNo ? String(sh.getRange(rowNo, 10).getValue() || '') : '';
    let calendar = prev;

    if (CONFIG.SEND_INVITES && r.email) {
      if (r.rsvp === 'yes') calendar = setGuest_(r.email, true) ? 'invited' : 'error';
      else if (prev === 'invited') calendar = setGuest_(r.email, false) ? 'removed' : 'error';
    }

    const values = [[new Date(), r.name, r.email, r.phone, r.rsvp, r.plus, r.diet, r.side, r.message, calendar].map(safe_)];
    if (rowNo) sh.getRange(rowNo, 1, 1, HEADERS.length).setValues(values);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, HEADERS.length).setValues(values);

    return json_({ ok: true, invited: calendar === 'invited', updated: !!rowNo });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* ---------- helpers ---------- */

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.SHEET_NAME) || ss.insertSheet(CONFIG.SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); sh.setFrozenRows(1); }
  return sh;
}

function clean_(d) {
  const s = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  const name = s(d.name, 120);
  if (name.length < 2) return { error: 'name' };
  const email = s(d.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email' };
  const rsvp = ['yes', 'no', 'maybe'].indexOf(d.rsvp) >= 0 ? d.rsvp : '';
  if (!rsvp) return { error: 'rsvp' };
  let plus = Math.floor(Number(d.plus) || 0);
  plus = rsvp === 'no' ? 0 : Math.max(0, Math.min(10, plus));
  const side = ['A', 'B', 'both'].indexOf(d.side) >= 0 ? d.side : '';
  return { name: name, email: email, phone: s(d.phone, 40), rsvp: rsvp, plus: plus, diet: s(d.diet, 200), side: side, message: s(d.message, 1000) };
}

/** แขกคนเดิมส่งซ้ำ = แก้แถวเดิม (จับคู่จากอีเมล ถ้าไม่มีอีเมลใช้ชื่อ + เบอร์โทร) */
function findRow_(sh, r) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const digits = v => String(v || '').replace(/\D/g, '');
  const norm = v => String(v || '').replace(/^'/, '').trim().toLowerCase();
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    if (r.email && norm(row[2]) === r.email) return i + 2;
    if (!r.email && norm(row[1]) === r.name.toLowerCase() && digits(row[3]) === digits(r.phone)) return i + 2;
  }
  return 0;
}

function ensureEvent_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('EVENT_ID');
  if (id) {
    try { const ev = Calendar.Events.get(CONFIG.CALENDAR_ID, id); if (ev && ev.status !== 'cancelled') return id; } catch (e) {}
  }
  const ev = Calendar.Events.insert({
    summary: CONFIG.EVENT_TITLE,
    location: CONFIG.LOCATION,
    description: CONFIG.DESCRIPTION,
    start: { dateTime: CONFIG.EVENT_DATE + 'T' + CONFIG.START_TIME + ':00', timeZone: CONFIG.TIMEZONE },
    end: { dateTime: CONFIG.EVENT_DATE + 'T' + CONFIG.END_TIME + ':00', timeZone: CONFIG.TIMEZONE },
    guestsCanSeeOtherGuests: false,
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 24 * 60 }, { method: 'popup', minutes: 120 }] }
  }, CONFIG.CALENDAR_ID);
  props.setProperty('EVENT_ID', ev.id);
  return ev.id;
}

/** เพิ่ม/เอาแขกออกจากอีเวนต์ คืนค่า true ถ้าสำเร็จ */
function setGuest_(email, add) {
  try {
    const id = ensureEvent_();
    const ev = Calendar.Events.get(CONFIG.CALENDAR_ID, id);
    const others = (ev.attendees || []).filter(a => String(a.email).toLowerCase() !== email);
    const already = (ev.attendees || []).length !== others.length;
    if (add && already) return true;           // มีอยู่แล้ว ไม่ส่งซ้ำ
    if (!add && !already) return true;
    const attendees = add ? others.concat([{ email: email }]) : others;
    Calendar.Events.patch({ attendees: attendees }, CONFIG.CALENDAR_ID, id, { sendUpdates: add ? 'all' : 'none' });
    return true;
  } catch (err) {
    console.error('calendar', err);
    return false;
  }
}

/** กันสูตรใน Google Sheet (ข้อความที่ขึ้นต้นด้วย = + - @ จะถูกเก็บเป็นข้อความธรรมดา) */
function safe_(v) {
  return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
