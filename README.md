# Remote Camera PWA v0.9.4 — Zoom speed accumulator fix

- แก้โหมด Zoom ช้า/ปกติที่บางอุปกรณ์ดูเหมือนไม่ทำงาน
- ใช้ virtual zoom accumulator สะสมการเคลื่อนที่ต่อเนื่อง แล้วค่อย quantize ตาม step ที่กล้องรองรับ
- โหมดเร็ว/ปกติ/ช้าจึงใช้ engine เดียวกัน ต่างกันเฉพาะความเร็วต่อวินาที
- กดค้างและ soft start/stop ยังทำงานเหมือนเดิม

---

# Remote Camera PWA v0.9.4 — Remote Control Reliability

- แก้ Control Center สั่ง กล้องหน้า/หลัง/Zoom ไม่ถึงมือถือบางครั้ง
- ทุกคำสั่งมี commandId และ ACK จาก Sender
- Target พร้อมกันทั้ง UUID + Stream ID พร้อม WebSocket fallback
- Retry อัตโนมัติเมื่อไม่มี ACK และ broadcast fallback ที่ Sender กรองด้วย targetStream
- Sender de-duplicate commandId ป้องกันคำสั่งซ้ำจาก retry
- แสดงสถานะคำสั่งใต้ปุ่ม Control


## v0.9.4 — Zoom hold fix
- โหมดช้าลดความเร็วลงอย่างชัดเจน (ประมาณ 32 วินาทีจากสุดหนึ่งไปอีกสุดหนึ่งตามช่วง zoom ที่อุปกรณ์รายงาน)
- เปลี่ยนความเร็วจากการคูณตามช่วง zoom แบบเดิม เป็น travel-time model เพื่อไม่ให้ Android ที่มีช่วง zoom กว้างวิ่งเร็วเกินไป
- ลด acceleration/deceleration ให้เริ่มและหยุดนุ่มขึ้น
- ปุ่ม −/+ Zoom ปิด text selection, long-press callout และ browser gesture
- ใช้ Pointer Capture เพื่อให้กดค้างแล้วลากนิ้วออกจากปุ่มเล็กน้อยยังควบคุมต่อได้ และหยุดเมื่อปล่อยจริง

# Remote Camera PWA v0.9.4 — Auto Discovery


## แก้ปัญหา Discovery ซ้ำ/Online กระพริบใน v0.9.4

- Control Center ไม่เอา room listing หรือ transient peer มาแสดงเป็นกล้องทันทีอีกแล้ว
- จะแสดงกล้องเมื่อได้รับ telemetry จาก Sender ตัวจริงเท่านั้น
- Sender มี `deviceID` ถาวรใน localStorage เพื่อรวม peer/stream ของมือถือเครื่องเดียวกัน
- `peerDisconnected` ไม่สั่ง Offline ทันที เพราะ WebRTC อาจ reconnect เอง
- สถานะ Offline ตัดสินจากการหายของ telemetry ต่อเนื่อง 12 วินาที
- ใช้ registry store รุ่นใหม่เพื่อไม่ดึง ghost camera ที่ v0.9 เคยบันทึกไว้

ต้นแบบส่งภาพระยะไกลจาก iPhone/Android → WebRTC → OBS

## ใหม่ใน v0.9.4
- ไม่ต้องกรอก Room หรือ Stream ID ในการใช้งานปกติ
- Sender สร้าง Device/Stream ID ถาวรต่อเบราว์เซอร์ให้อัตโนมัติ
- Room สร้างจาก hostname + ชื่อโปรเจกต์ จึงเหมือนกันบนทุกเครื่องที่เปิดเว็บไซต์เดียวกัน
- Control Center ใช้ VDO.Ninja SDK `autoConnect()` แบบ data-only เพื่อค้นหา stream ที่ขึ้นต้น `cam_` ใน Room
- มือถือส่ง telemetry (ชื่ออุปกรณ์, platform, FPS, zoom) ทำให้ Control Center เพิ่มกล้องให้อัตโนมัติ
- แสดง Online / Offline และล้างรายการ Offline ได้
- OBS Browser Source URL สร้างให้อัตโนมัติทุกกล้อง
- โหมดเครือข่ายเริ่มต้นยังเป็น Manual
- Smart Network, Smooth Zoom, Android camera flow และ remote front/rear จาก v0.8 ยังอยู่

## วิธีทดสอบ
1. อัปโหลดไฟล์ทั้งหมดทับ GitHub Pages เดิม
2. เปิด `sender.html` บนมือถือเครื่องที่ 1 แล้วกดเปิดกล้อง → เริ่มส่งภาพ
3. ทำซ้ำบนมือถือเครื่องอื่น (iOS/Android ได้)
4. เปิด `control.html` บนคอม
5. รอ 1–5 วินาที กล้องที่ออนไลน์ควรปรากฏเอง
6. เลือกกล้องแล้วกด “เปิดภาพกล้องที่เลือก”

## หมายเหตุ
- Device ID เก็บใน localStorage หากล้างข้อมูลเว็บไซต์ ระบบจะสร้าง ID ใหม่
- การค้นหาอัตโนมัติใช้ room listing / data-only mesh ของ VDO.Ninja SDK; วิดีโอ HQ ยังเปิดเฉพาะกล้องที่เลือกหรือ URL ที่ใส่ใน OBS
- ไม่ได้ดึงวิดีโอทุกกล้องเข้าหน้า Control Center พร้อมกัน จึงไม่เพิ่ม bandwidth โดยไม่จำเป็น
