# ระบบ Live Streaming ระยะไกลผ่านมือถือ v0.11.28 — Mic Volume + Noise Suppression

พัฒนาต่อจาก v0.11.27-MIC-SELECT ที่แนบมา โดยปรับ `sender.html`, `sender.js`, `styles.css` และอัปเดต cache `sw.js` เท่านั้น

- **ปรับความดังไมค์ 0–200%** ในหน้า Sender → ตั้งค่า; **100%** เป็นค่าเดิม, 0% เงียบ, 200% ขยายได้สูงสุด 2 เท่า
- ใช้ Web Audio `GainNode` ปรับความดังแบบเรียลไทม์ ทั้งก่อนและระหว่างส่งภาพ โดยไม่ restart กล้องหรือ WebRTC
- **Noise Suppression เปิด/ปิด** ผ่านข้อกำหนดเสียงของเบราว์เซอร์ (`getUserMedia` / `MediaStreamTrack.applyConstraints`); ตรวจสอบสถานะจริงจาก `getSettings()` หากเบราว์เซอร์รายงาน
- ถ้าเบราว์เซอร์เปลี่ยนลดนอยส์ระหว่างส่งไม่ได้ ระบบลองเปิด audio track ใหม่แล้วเปลี่ยนเฉพาะ track เสียงผ่าน SDK `replaceTrack` โดยไม่แตะ track วิดีโอ
- ค่า Gain/Noise บันทึกไว้ในเครื่อง; ค่าครั้งแรก: **Gain 100%, Noise OFF** (คงพฤติกรรมเดิม)
- ถ้า Web Audio ใช้งานไม่ได้ ปล่อยเสียงไมค์เดิมตามปกติและปิดตัวปรับความดัง; ถ้าเบราว์เซอร์ไม่รองรับ Noise Suppression ปิดสวิตช์และแจ้งผู้ใช้
- คงการเลือกไมค์ภายนอก v0.11.27, mute, zoom, control, receiver, OBS links, codec, camera quality และระบบข้อมูลเดิม

## วิธีทดสอบผ่าน Firefox

1. สำรองเว็บไซต์เดิม แล้วอัปโหลดเนื้อหา ZIP ทับไฟล์บนโฮสต์เดิม (HTTPS)
2. เสียบไมค์ภายนอก เปิด `sender.html` ผ่าน Firefox และเลือกไมค์ให้เรียบร้อย
3. เปิด **ตั้งค่า → ความดังไมโครโฟน** จาก 100% เป็น 50% หรือ 150% แล้วฟังเสียงจาก OBS/Receiver เพื่อเปรียบเทียบ
4. สลับ **ลดเสียงรบกวน** ON/OFF แล้วตรวจข้อความสถานะและฟังเสียงจาก OBS (บางเบราว์เซอร์อาจไม่รองรับ)
5. ลองปรับความดัง/Noise ระหว่างส่งภาพจริง แล้วตรวจว่าวิดีโอยังต่อเนื่อง และปุ่มปิด/เปิดไมค์ยังใช้ได้

**หมายเหตุ:** การเพิ่มเกิน 100% อาจทำให้เสียงแตกหากไมค์ดังอยู่แล้ว; Noise Suppression ของเบราว์เซอร์เหมาะกับเสียงพูดแต่มีโอกาสทำให้เสียงดนตรี/บรรยากาศเปลี่ยนไป บางเบราว์เซอร์ไม่เปิดเผยสถานะจริง จึงต้องฟังทดสอบด้วย

**สถานะการทดสอบ:** ตรวจไวยากรณ์และโครงสร้างโค้ดในเครื่องแล้ว แต่ยังต้องทดสอบกับไมค์ภายนอกบน Firefox มือถือและเครื่อง OBS จริง

---

# ระบบ Live Streaming ระยะไกลผ่านมือถือ v0.11.27 — Microphone Selection

เพิ่มจากไฟล์ต้นฉบับ v0.11.26 ที่ผู้ใช้แนบมา โดยเปลี่ยนเฉพาะ `sender.html`, `sender.js` และเวอร์ชัน service worker (`sw.js`)

- เพิ่มเมนู **ไมโครโฟน (Audio Input)** ในหน้า Sender → ตั้งค่า
- ปุ่ม **ค้นหาไมค์** ขออนุญาตไมค์ (เมื่อยังไม่อนุญาต) แล้วอ่านรายชื่อด้วย `enumerateDevices()`
- ปุ่ม **ใช้ไมค์ที่เลือก** ใช้ `getUserMedia` ร่วมกับ `deviceId.exact` เลือก audioinput; ตัวเลือกอัตโนมัติกลับไปใช้ default ที่เบราว์เซอร์จัดให้
- เปลี่ยนไมค์ระหว่าง LIVE ด้วย `vdo.replaceTrack()` โดยไม่สั่งปิด WebRTC หรือเปลี่ยน Video Track
- แสดงชื่อ audio track ที่เบราว์เซอร์เปิดใช้งานในเมนู
- รักษาสถานะ mute; ปิด track เก่าหลังเปลี่ยนสำเร็จ; หากเปลี่ยนไม่สำเร็จไม่ปิด track เก่า
- ไม่เปลี่ยน Control, Receiver, Native Sender, codec, bitrate, video camera logic หรือกลไกเชื่อมต่อ

## ทดสอบ

1. สำรองไฟล์เว็บเดิมก่อนอัปโหลดไฟล์ ZIP นี้ไปทับเว็บไซต์
2. เปิด `sender.html` ใน HTTPS แล้วเสียบไมค์เข้ามือถือ
3. กดตั้งค่า → **ค้นหาไมค์** และอนุญาตใช้งาน → เลือกชื่อไมค์ → **ใช้ไมค์ที่เลือก**
4. กดส่งภาพ แล้วฟังเสียงผ่าน OBS หรือ Receiver เพื่อยืนยันว่าเสียงมาจากไมค์ที่ต้องการ
5. ลองสลับไมค์ระหว่าง LIVE จากเมนูเดิม แล้วตรวจภาพ/เสียงต่อเนื่อง

**สำคัญ (iOS):** Safari/iOS อาจไม่เปิดเผยไมค์ภายนอก หรือชื่อแทร็กอาจไม่ตรงกับเสียงจริง (ปัญหาระดับ WebKit/OS) เว็บไซต์ไม่สามารถบังคับเลือกฮาร์ดแวร์ที่เบราว์เซอร์ไม่เปิดเผยได้ หากไม่พบ ให้เสียบไมค์ก่อนเปิด Safari ใหม่หรือทดสอบบน Android/เบราว์เซอร์อื่น

**หมายเหตุ:** เวอร์ชันนี้ผ่านการตรวจโครงสร้าง/ไวยากรณ์ไฟล์ JavaScript แต่ยังต้องทดสอบจริงบน iOS/Android กับไมค์ภายนอกและ OBS

---

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
