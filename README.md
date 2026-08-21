# Remote Camera Lab v0.1

ต้นแบบส่งภาพ iPhone -> WebRTC -> OBS โดยใช้ VDO.Ninja SDK

## ไฟล์หลัก
- `sender.html` ฝั่ง iPhone
- `control.html` หน้า Control Center
- `receiver.html` URL สำหรับ OBS Browser Source

## วิธีรัน
ต้องเปิดผ่าน HTTPS บน iPhone เพราะ Camera/Microphone Web APIs ต้องเป็น secure context

ทางง่ายสำหรับทดสอบคืออัปโหลดทั้งโฟลเดอร์ขึ้น static hosting ที่มี HTTPS เช่น GitHub Pages, Cloudflare Pages, Netlify หรือเซิร์ฟเวอร์ของคุณเอง

1. เปิด `sender.html` บน iPhone
2. อนุญาต Camera + Microphone
3. กด `เปิดกล้อง`
4. กด `เริ่มส่งภาพ`
5. ที่คอมเปิด `control.html` และใช้ Room + Stream ID เดียวกัน
6. กด `เชื่อมต่อ`
7. คัดลอก OBS Browser Source URL จาก Control Center ไปใส่ OBS

## การสลับกล้อง
ต้นแบบนี้ใช้ `canvas.captureStream()` เป็น outgoing video track คงที่ กล้องจริงเป็น input ของ canvas ดังนั้นเมื่อสลับกล้องหน้า/หลัง ตัว WebRTC video track หลักไม่ต้องถูกสร้างใหม่

## ข้อจำกัดสำคัญของ PWA บน iPhone
Safari อาจแสดงเพียงกล้องหน้าและกล้องหลัง แม้ iPhone จะมี 0.5x / 1x / Tele หลายเลนส์ จึงไม่สามารถรับประกันการเลือก physical lens ทั้งหมดจาก Web API ได้ รุ่น Native App จะควบคุมเลนส์ iPhone ได้ละเอียดกว่า

Zoom slider จะทำงานเฉพาะเมื่อ browser เปิด `MediaStreamTrack.getCapabilities().zoom` ให้

## SDK
Prototype โหลด VDO.Ninja SDK จาก jsDelivr ตามเอกสารทางการ
