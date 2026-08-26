# ระบบ Live Streaming ระยะไกลผ่านมือถือ v0.11.26

## v0.11.26 — Compact OBS Link

- เพิ่ม `r.html` สำหรับลิงก์ OBS แบบสั้นบน Static Hosting / GitHub Pages
- Control Center แสดงและคัดลอกลิงก์สั้นอัตโนมัติ ทั้งกล้องที่เลือกและรายการ “OBS ทุกกล้อง”
- ไม่ใช้ bit.ly / TinyURL / API ภายนอก และไม่ต้องมีฐานข้อมูลหรือ Backend
- ค่า Room ถูกสร้างจากโดเมน/ชื่อโปรเจกต์เหมือนระบบเดิม และ `r.html` จะขยายค่ากลับไป `receiver.html` ภายในเครื่อง OBS
- รองรับ Direct, Bitrate, Buffer, Codec, Smart Network และ Smart minimum bitrate ครบเหมือน URL เดิม

ตัวอย่างรูปแบบใหม่:
`https://example.github.io/project/r.html?s=cam_android_a1b2c3d4&d=1`

---

# ระบบ Live Streaming ระยะไกลผ่านมือถือ v0.11.25

## v0.11.25 — iOS VP8 Receiver Fix

รุ่นนี้ต่อยอดจาก v0.11.24 โดยแก้เฉพาะเส้นทางรับภาพ iOS ที่ทดสอบแล้วว่าการบังคับ VP8 ช่วยแก้อาการ Viewer/OBS ค้างหลังเริ่มส่งภาพไม่กี่วินาที

ไฟล์ runtime ที่แก้ใน v0.11.25:
- `receiver.html` — ส่งค่า codec ต่อให้ VDO.Ninja ใน direct mode และรองรับค่า codec เดียวที่ชัดเจน
- `control.js` — เลือก VP8 อัตโนมัติสำหรับ stream iOS (`cam_ios_...`) โดยไม่บังคับ Android
- `control.html` — อัปเดตส่วนควบคุม/เวอร์ชันที่เกี่ยวข้อง

ไฟล์อื่นยังใช้ฐาน v0.11.24 เดิม

---

## เอกสารฐาน v0.11.24 เดิม

# ระบบ Live Streaming ระยะไกลผ่านมือถือ v0.11.24

## v0.11.24 — Native Direct + Auto Discovery + Native Telemetry

- แก้ Auto Discovery ของ Native Sender: Control Center รับ `presence_cam_...` จากช่อง Presence แล้วแปลงกลับเป็น Stream ID `cam_...` อัตโนมัติ
- Native Sender v0.3.5 ไม่เอาวิดีโอเข้า room อีกต่อไป จึงไม่รบกวน Direct media
- เพิ่ม event fallback สำหรับ listing / videoaddedtoroom / someonejoined / peerConnected
- OBS Smart Receiver: สำหรับ Native Direct จะไม่บังคับ codec H.264 และเพิ่ม autoplay เพื่อลดอาการหมุนค้าง
- Web Sender / Data Hub / ระบบข้อความเดิมยังคงเหมือนเดิม

## ใช้งาน

1. อัปโหลดไฟล์ชุด v0.11.24 ทับ GitHub Pages เดิม
2. เปิด Control Center แล้วกด Refresh หนึ่งครั้งหลัง deploy
3. เปิด Native Sender v0.3.5 และกดเริ่มส่งภาพ
4. กล้องควรขึ้นในแถบเลือกกล้องอัตโนมัติ โดยไม่ต้องกรอก Stream ID

ถ้ายังต้องการ fallback สามารถเพิ่ม Native Direct ด้วย Stream ID หรือลิงก์ `?view=` ในเมนูจัดการกล้องได้เหมือนเดิม

### Native v0.3.7
- Native Sender ส่ง Telemetry ผ่าน data-only channel ทุกประมาณ 2 วินาที
- Control Center ใช้ Telemetry เป็น Auto Discovery สำรอง/ยืนยัน โดยยังรักษา transport เป็น Direct
- Requested / Camera settings / Measured FPS / Camera / ผล FPS / Smart profile จะแสดงข้อมูล Native เมื่อได้รับ Telemetry
- กล้อง Native Direct ไม่ถูกเปลี่ยนเป็น Room เมื่อ Telemetry เข้ามา จึงไม่ทำให้ Preview/OBS URL เสีย
