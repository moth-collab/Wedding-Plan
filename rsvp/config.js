/*
 * ตั้งค่าหน้าเชิญและฟอร์มตอบรับ — แก้เฉพาะไฟล์นี้ก็พอ
 * ค่าที่เป็นข้อความใส่ในเครื่องหมาย ' ' ได้เลย
 */
window.RSVP_CONFIG = {
  // ชื่อที่จะแสดงบนหน้าเชิญ
  nameA: 'ชื่อของคุณ',
  nameB: 'ชื่อคู่ของคุณ',

  // วันและเวลา (รูปแบบ ปปปป-ดด-วว และ ชช:นน เวลาไทย)
  weddingDate: '2027-10-27',
  ceremonyTime: '',        // เวลาพิธีช่วงเช้า เช่น '07:09' (เว้นว่างถ้าไม่เชิญแขกช่วงเช้า)
  partyTime: '18:00',      // เวลาเริ่มงานเลี้ยง
  endTime: '21:30',        // เวลาจบงานโดยประมาณ

  // สถานที่
  venueName: 'ชื่อสถานที่จัดงาน',
  venueAddress: 'ที่อยู่สถานที่จัดงาน',
  mapUrl: '',              // ลิงก์ Google Maps เช่น 'https://maps.app.goo.gl/xxxx'

  dressCode: 'โทนสีเขียวเสจ ครีม หรือพาสเทล',
  welcome: 'เราสองคนตั้งใจเชิญคุณมาร่วมเป็นส่วนหนึ่งของวันสำคัญ ขอบคุณที่สละเวลาตอบรับ เพื่อให้เราเตรียมที่นั่งและอาหารได้พอดีสำหรับทุกคน',
  rsvpBy: '2027-09-15',    // วันสุดท้ายที่ขอให้ตอบ

  // รูปพรีเวดดิ้ง: วางไฟล์ไว้ในโฟลเดอร์ photos แล้วเพิ่มรายการตามตัวอย่าง
  // รูปแรกจะใช้เป็นภาพหน้าปก แนะนำไฟล์ .jpg กว้างไม่เกิน 1600px ขนาดไม่เกิน 500KB ต่อรูป
  photos: [
    // { src: 'photos/01.jpg', alt: 'เราสองคนที่ทะเล' },
    // { src: 'photos/02.jpg', alt: 'วันที่ขอแต่งงาน' },
  ],

  // ระบบรับคำตอบ (Supabase) — ตั้งไว้ให้แล้ว ไม่ต้องแก้
  supabaseUrl: 'https://izkgvtbqvokxksrppxlm.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6a2d2dGJxdm9reGtzcnBweGxtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNTY2NjAsImV4cCI6MjEwODYzMjY2MH0.2l1aIcbp_rfyUSUr7muQkx0fS0sQm7SzbrFIT1UqfvI',
  // ลิงก์ที่แขกเปิดต้องมี ?k=... ต่อท้าย คัดลอกลิงก์เต็มได้จากแอป OUR DAY › ตั้งค่า

  // (ไม่บังคับ) URL ของ Google Apps Script สำหรับส่งคำเชิญ Google Calendar ให้แขกที่ตอบรับ
  calendarEndpoint: '',

  // ถ้าตั้ง INVITE_CODE ใน Apps Script ให้เปลี่ยนเป็น true เพื่อแสดงช่องกรอกรหัสจากการ์ด
  askInviteCode: false,

  maxPlus: 3               // จำนวนผู้ติดตามสูงสุดที่แขกเลือกได้
};
