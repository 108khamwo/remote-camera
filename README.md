# Remote Camera PWA v0.4.1

Prototype สำหรับส่งกล้อง iPhone ผ่าน WebRTC ไปยัง OBS และควบคุมสลับกล้องจาก Control Center

## จุดเปลี่ยนสำคัญใน v0.4

- ส่ง **Camera MediaStreamTrack โดยตรง** เข้า VDO.Ninja SDK แทน Canvas captureStream
- เวลาสลับกล้อง/เปลี่ยน preset ใช้ `vdo.replaceTrack(oldTrack, newTrack)` เพื่อคง peer connection เดิม
- ค่าเริ่มต้นกล้องเป็น 1080p30 และ `contentHint = motion` เพื่อเน้น frame rate สำหรับภาพเคลื่อนไหว
- เพิ่ม 1080p60 / 720p60 สำหรับ iPhone ที่รองรับ
- Control Center เพิ่มตัวเลือก bitrate 4 / 6 / 8 / 10 / 12 / 16 Mbps
- ค่าแนะนำเริ่มต้น: 1080p30 + 8 Mbps + H.264 + buffer 200 ms
- OBS Receiver ใช้ viewer engine ของ VDO.Ninja โดยตรง พร้อม `videobitrate`, `scale=100`, `buffer`, `keyframerate=2000`, `obsfix=1`
- Control Center ใช้ SDK connection แบบ data-only สำหรับ remote control ขณะที่ภาพ preview ใช้ HQ viewer เหมือน OBS

## วิธีอัปเดต GitHub Pages

อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ทับของเดิม แล้ว Commit changes จากนั้นรอ GitHub Pages อัปเดตและปิด/เปิดหน้า Safari ใหม่

## วิธีทดสอบ

1. iPhone เปิด `sender.html`
2. เลือก 1080p / 30 แล้วเปิดกล้อง
3. กดเริ่มส่งภาพ
4. คอมเปิด `control.html`
5. ตั้ง Stream ID ให้ตรงกัน และ Bitrate = 8 Mbps, Buffer = 200 ms, Codec = H.264
6. กดเชื่อมต่อ + เปิดภาพ HQ
7. ทดสอบแพนกล้องซ้าย/ขวา เดินถือกล้อง และสลับหน้า/หลัง
8. ใน OBS ใช้ URL ที่ Control Center สร้างให้เป็น Browser Source ขนาด 1920×1080

## ถ้ายังเห็นบล็อกเมื่อแพนกล้อง

- ลองเพิ่ม 8 → 10 → 12 Mbps ทีละขั้น
- ถ้าภาพกระตุกแต่เน็ตดี ลอง 1080p30 ก่อน 1080p60
- ถ้าเน็ต 5G แกว่ง ให้คง 8 Mbps แล้วเพิ่ม Buffer 200 → 350 ms
- ถ้า upload ของ iPhone ไม่พอ ให้ลดเป็น 720p60 / 6 Mbps แทนการฝืน 1080p60

## หมายเหตุ

Bitrate ใน VDO.Ninja P2P โดยทั่วไปเป็นค่าที่ฝั่ง viewer ร้องขอ จึงถูกใส่ไว้ใน OBS/Preview viewer URL ไม่ใช่ตัวเลือก encoder ที่หน้า Sender โดยตรง


## แก้ไข v0.4.1

- แก้ HQ Viewer / OBS URL ให้ส่ง `room` ไปด้วย
- เนื่องจาก Sender publish `cam01` ภายใน `remote-cam-test` จึงต้องใช้ Solo link รูปแบบ `?room=ROOM&view=STREAM&solo`
- v0.4 ลืมใส่ Room ใน receiver ทำให้ Remote Control ต่อได้ แต่ Preview/OBS ไม่มีภาพ
