# ระบบ Live Streaming ระยะไกลผ่านมือถือ v0.11.23

## v0.11.23 — Native Direct + Presence Auto Discovery

- แก้ Auto Discovery ของ Native Sender: Control Center รับ `presence_cam_...` จากช่อง Presence แล้วแปลงกลับเป็น Stream ID `cam_...` อัตโนมัติ
- Native Sender v0.3.5 ไม่เอาวิดีโอเข้า room อีกต่อไป จึงไม่รบกวน Direct media
- เพิ่ม event fallback สำหรับ listing / videoaddedtoroom / someonejoined / peerConnected
- OBS Smart Receiver: สำหรับ Native Direct จะไม่บังคับ codec H.264 และเพิ่ม autoplay เพื่อลดอาการหมุนค้าง
- Web Sender / Data Hub / ระบบข้อความเดิมยังคงเหมือนเดิม

## ใช้งาน

1. อัปโหลดไฟล์ชุด v0.11.23 ทับ GitHub Pages เดิม
2. เปิด Control Center แล้วกด Refresh หนึ่งครั้งหลัง deploy
3. เปิด Native Sender v0.3.5 และกดเริ่มส่งภาพ
4. กล้องควรขึ้นในแถบเลือกกล้องอัตโนมัติ โดยไม่ต้องกรอก Stream ID

ถ้ายังต้องการ fallback สามารถเพิ่ม Native Direct ด้วย Stream ID หรือลิงก์ `?view=` ในเมนูจัดการกล้องได้เหมือนเดิม
