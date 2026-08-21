# Remote Camera PWA v0.11.5

- Control Center: สถานะสดแสดงเฉพาะค่าที่วัดได้จริง; โหมด Manual เหลือโหมด + Bitrate และซ่อนค่า WebRTC stats ที่ไม่มีข้อมูล

## Sender Call UI

หน้า Sender ถูกออกแบบใหม่ให้เรียบง่ายแบบหน้ากล้อง/วิดีโอคอล โดยไม่ได้คัดลอกหน้าตา CM108Live:

- ภาพกล้องเป็นจุดหลักของหน้าจอ
- ปุ่มใหญ่ `ส่งภาพ / หยุดส่ง` ปุ่มเดียว
- ปุ่ม `- Zoom / + Zoom` แบบกดค้าง และค่าเริ่มต้น Zoom = ช้า
- ปุ่ม 0.5x / 1x ยังค่อย ๆ ซูมแบบสมูท
- กล้องหน้า/หลัง คุณภาพ ชื่อกล้อง และข้อมูลตรวจสอบย้ายไปอยู่ใน Settings

## ฟังก์ชันที่นำแนวคิดจาก CM108Live มาใช้

นำมาเฉพาะระบบ ไม่ได้นำ UI เดิมมาใช้:

### ข้อความ Control ↔ Sender

- Control ส่งข้อความถึงกล้องที่เลือก หรือส่งทุกกล้องได้
- Sender แสดงข้อความเป็น Toast บนภาพ
- Sender ตอบกลับได้ และมีคำตอบด่วน: รับทราบ / รอสักครู่ / พร้อมแล้ว
- ใช้ WebRTC data channel ของระบบปัจจุบัน ไม่พึ่ง iframe chat แบบโปรเจกต์เดิม

### พักหน้าจอ

- ปุ่มพระจันทร์บน Sender เปิดหน้าจอดำเต็มจอ
- Camera/WebRTC ยังคงทำงานและส่งภาพ/เสียงต่อ
- ซ่อนการ render preview/UI เพื่อลดภาระและช่วยประหยัดพลังงาน โดยเฉพาะจอ OLED
- ระบบพยายามใช้ Screen Wake Lock เพื่อไม่ให้ OS ดับหน้าจอจน Safari/PWA ถูกพัก
- แตะหน้าจอดำเพื่อกลับ

> หมายเหตุ: นี่เป็น “พักภาพหน้าจอ” ไม่ใช่ปิดจอฮาร์ดแวร์จริง เพราะการปิด/ล็อกจอบนมือถืออาจทำให้ browser ระงับกล้องหรือ WebRTC

## Control Center

- Auto Discovery หลายกล้องยังทำงานเหมือนเดิม
- Preview เปิดอัตโนมัติเมื่อมี Stream
- Manual Network เป็นค่าเริ่มต้น
- Smart Network, Bitrate, Buffer และ OBS URL ยังอยู่ครบ
- เพิ่มปุ่มข้อความ โดยส่งได้เฉพาะกล้องที่เลือกหรือ Broadcast ทุกกล้อง

## อัปเดต

อัปโหลดไฟล์ทั้งหมดทับเวอร์ชันเดิมบน GitHub Pages แล้วปิด/เปิด Sender และ Control Center ใหม่ เพราะ Service Worker cache เปลี่ยนเป็น v0110


## v0.11.3
- แก้ระบบข้อความสองทางให้ใช้ Room broadcast ซึ่งเป็นเส้นทางเดียวกับ Telemetry ที่ทดสอบว่าทำงานแล้ว
- ข้อความถึงกล้องที่เลือกใช้ targetStream กรองที่ Sender แทนการเจาะ peer ชั่วคราว
- เพิ่ม messageId, ACK, retry และกันข้อความซ้ำ
- รองรับส่งถึงกล้องที่เลือกหรือทุกกล้องใน Room

## v0.11.3
- Sender บนมือถือแนวนอนเปลี่ยนเป็น one-screen layout แบบวิดีโอคอล: ภาพเต็มพื้นที่จอ และปุ่มควบคุมลอยทับด้านล่าง
- ไม่มีการเลื่อนหน้าใน landscape mobile; รองรับ safe-area ของ iPhone และ Android
- Portrait layout เดิมยังคงเหมือนเดิม


## v0.11.5 — Compact Control messaging UI
- ลดพื้นที่ส่วนข้อความใน Control Center แต่เพิ่มขนาดตัวอักษรประวัติข้อความให้อ่านง่ายขึ้น
- ปรับ scrollbar ของประวัติข้อความ/Log ให้เป็นโทนมืดเข้ากับระบบ
- เปลี่ยน emoji บางจุดใน Control Center เป็นไอคอน CSS แบบเรียบเพื่อให้หน้าตาสม่ำเสมอทุกระบบปฏิบัติการ
- ไม่เปลี่ยนระบบ WebRTC, Auto Discovery หรือข้อความสองทาง

## v0.11.5 — Fullscreen บนมือถือ
- เพิ่มปุ่ม Fullscreen บน Sender สำหรับ Android/เบราว์เซอร์ที่รองรับ Fullscreen API
- Android/Chrome: กดแล้วพยายามซ่อน browser chrome ด้วย Fullscreen API
- iPhone Safari: ถ้า Fullscreen API ไม่เปิดให้เว็บ ระบบจะแนะนำให้ Add to Home Screen แล้วเปิดเป็น PWA ซึ่งไม่มีแถบ Safari
- เพิ่ม Apple mobile web app meta และ `display_override` สำหรับ PWA
