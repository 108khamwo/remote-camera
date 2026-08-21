# Remote Camera PWA v0.6 — Smart Network

ต้นแบบส่งภาพ iPhone → WebRTC → OBS พร้อม Control Center และโหมดอัจฉริยะสำหรับ 4G/5G อ่อน

## สิ่งใหม่ใน v0.6

- เพิ่ม **Smart Network** ที่ `receiver.html` โดยตรง จึงทำงานกับ OBS Browser Source ได้แม้ไม่ได้เปิด Control Center ค้างไว้
- เริ่มจาก bitrate สูงสุดที่กำหนด เช่น 8 Mbps แล้วตรวจ WebRTC stats ประมาณทุก 1.25 วินาที
- ใช้ packet loss, RTT, jitter และ available bitrate (เมื่อ browser รายงาน) เป็นตัวตัดสิน
- ลด bitrate แบบเป็นขั้นเมื่อเน็ตอ่อน และเพิ่มคืนแบบช้ากว่าเมื่อสัญญาณนิ่ง เพื่อลดอาการแกว่งขึ้นลง
- ตั้ง bitrate ต่ำสุดได้ เช่น 1.8 Mbps
- หากลดถึงขั้นต่ำแล้วยังวิกฤตต่อเนื่อง Control Center สามารถสั่ง iPhone ลด Capture เป็น **720p30 ชั่วคราว** ผ่าน data channel
- เมื่อสัญญาณกลับมานิ่ง ระบบคืน preset เดิมอัตโนมัติ
- การเปลี่ยน Capture ยังใช้ `replaceTrack()` เพื่อพยายามคง peer connection เดิม
- แสดงสถานะสด: Network state, Target bitrate, bitrate รับจริง, packet loss, RTT และ jitter

## โหมดแนะนำ

### เน็ตปกติ
- Camera: 1080p30
- Smart Network: ON
- Maximum bitrate: 8 Mbps
- Minimum bitrate: 1.8 Mbps
- Buffer: 200 ms
- Codec: H.264

### เน็ตอ่อนมาก
Smart Network จะลดประมาณ 8 → 6.5 → 5 → 4 → 3.2 → 2.5 → 2 → 1.8 Mbps ตามสถานการณ์

หากอยู่ขั้นต่ำแล้วยังมี loss/RTT/jitter สูงต่อเนื่อง และเปิด `ลดเป็น 720p30 ชั่วคราว` ไว้ Control Center จะสั่ง Sender ลด Capture เพื่อรักษาความต่อเนื่องของภาพ

## การใช้งาน

1. อัปโหลดไฟล์ทั้งหมดขึ้น GitHub Pages ผ่าน HTTPS
2. iPhone เปิด `sender.html`
3. เลือก 1080p30 → เปิดกล้อง → เริ่มส่งภาพ
4. คอมเปิด `control.html`
5. เลือก `Smart Network — เน็ตอ่อน`
6. ตั้ง Maximum 8 Mbps / Minimum 1.8 Mbps / Buffer 200 ms
7. กดเชื่อมต่อ
8. คัดลอก OBS Browser Source URL ไปใส่ OBS

## หมายเหตุ

- Smart bitrate ของ OBS อยู่ใน `receiver.html` ดังนั้น OBS แต่ละ Browser Source ปรับ bitrate ของ connection ตัวเองได้
- Capture fallback 720p30 ต้องมี Control Center เชื่อมอยู่ เพราะ Control Center เป็นตัวส่งคำสั่งกลับไป iPhone
- WebRTC มี congestion control ของตัวเองอยู่แล้ว โหมด Smart นี้เป็นชั้นควบคุม target bitrate เพิ่มเติมเพื่อให้ตอบสนองกับเครือข่ายมือถือที่แกว่งได้ชัดเจนขึ้น
- Safari/PWA จากการทดสอบปัจจุบัน: 1920×1080 ได้สูงสุดประมาณ 30 fps ขณะที่ 1280×720 สามารถได้ถึง 60 fps บนอุปกรณ์ที่ทดสอบ
