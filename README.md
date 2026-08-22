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
