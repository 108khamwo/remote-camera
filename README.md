# ระบบ Live Streaming ระยะไกลผ่านมือถือ v0.11.18

## v0.11.18
- Control Center: เมื่อมีข้อความจาก Sender เข้ามาและแผงข้อความยังปิดอยู่ ระบบเปิดแผงข้อความให้อัตโนมัติทันที
- เลื่อนไปยังข้อความล่าสุดโดยไม่โฟกัสช่องพิมพ์ เพื่อไม่ให้คีย์บอร์ดเด้งเอง
- ไม่เปลี่ยน Message/Data Channel core ที่ใช้งานได้อยู่


- Message Core restored from v0.11.2 (known-good baseline).
- Control primary message action now broadcasts to all cameras; Enter also sends to all.
- “Send only this camera” remains available as a secondary action.
- Fullscreen code is isolated in `fullscreen.js` so it does not modify the message core.
- Sender top icons use one consistent SVG line-icon set.
- Network-first service worker for active development.


## v0.11.17
- Rebuilt messaging as one Control data publisher with every Sender explicitly viewing it.
- Camera presence/telemetry now arrives over the same deterministic data channel.
- Video/OBS stays independent.
- Send All remains the primary action; selected-camera messages are filtered by targetStream.

### v0.11.17
- iOS: เอาปุ่ม Fullscreen ออกทั้งหมดและไม่ผูก Fullscreen API เพื่อไม่ให้กระทบ Sender
- ปรับ Message Sheet บน iOS ให้ Quick Reply 3 ปุ่มแสดงครบ ไม่แหว่ง และรองรับ Safe Area/แนวนอน
- ไม่เปลี่ยน Message/Data Channel core จาก v0.11.9


## v0.11.17
- Control Center ตัด dropdown เลือกกล้องที่ซ้ำออกจากหน้าจอ (เก็บ hidden ไว้เพื่อ compatibility)
- ใช้ปุ่มกล้องออนไลน์ (chips) เป็นตัวเลือกกล้องหลักเพียงแบบเดียว
- เพิ่มปุ่ม รีเฟรช ที่เห็นได้ทันทีเพื่อค้นหากล้องใหม่
- ปุ่มล้าง Offline และ Room ยังคงซ่อนใน จัดการกล้อง


### v0.11.17
- แก้ไอคอนไมโครโฟน Mute ซ้อนกัน โดยบังคับให้แสดงเพียง glyph เดียวต่อสถานะ
- ไม่แก้ Message Core, WebRTC, Zoom หรือ Discovery
