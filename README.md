# Remote Camera PWA v0.9.1 — Auto Discovery


## แก้ปัญหา Discovery ซ้ำ/Online กระพริบใน v0.9.1

- Control Center ไม่เอา room listing หรือ transient peer มาแสดงเป็นกล้องทันทีอีกแล้ว
- จะแสดงกล้องเมื่อได้รับ telemetry จาก Sender ตัวจริงเท่านั้น
- Sender มี `deviceID` ถาวรใน localStorage เพื่อรวม peer/stream ของมือถือเครื่องเดียวกัน
- `peerDisconnected` ไม่สั่ง Offline ทันที เพราะ WebRTC อาจ reconnect เอง
- สถานะ Offline ตัดสินจากการหายของ telemetry ต่อเนื่อง 12 วินาที
- ใช้ registry store รุ่นใหม่เพื่อไม่ดึง ghost camera ที่ v0.9 เคยบันทึกไว้

ต้นแบบส่งภาพระยะไกลจาก iPhone/Android → WebRTC → OBS

## ใหม่ใน v0.9.1
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
