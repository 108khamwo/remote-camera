# Remote Camera PWA v0.9.6

## จุดเปลี่ยนหลัก

- **Control Center ไม่สั่งกล้องหน้า/หลัง/Zoom แล้ว** เพื่อหลีกเลี่ยงคำสั่งย้อนกลับที่ยังไม่นิ่งเมื่อมีหลายมือถือ
- Control Center ใช้สำหรับ Auto Discovery, เลือกดูหลายกล้อง, Preview/HQ, Manual/Smart bitrate และสร้าง OBS Browser Source URL
- **Smart Network ปรับ bitrate ฝั่งรับเท่านั้น** และไม่สั่งลดความละเอียดของมือถือจากระยะไกล
- **Zoom Slider บนมือถือเป็น Live Slider**: กล้องตอบสนองระหว่างลาก เก็บเฉพาะตำแหน่งล่าสุด ไม่ replay ตำแหน่งเก่าหลังปล่อยนิ้ว
- ความเร็ว **ช้า / ปกติ / เร็ว** ใช้กับปุ่ม `− Zoom / + Zoom` แบบกดค้าง
- Smooth Zoom ใช้ virtual accumulator ต่อเนื่อง และพยายามส่งค่า fractional zoom ละเอียดก่อน หาก browser ปฏิเสธจึง fallback ตาม hardware step
- Network mode เริ่มต้นเป็น **Manual**
- รองรับหลายมือถือใน Room เดียวกัน ทั้ง iOS และ Android โดย Auto Discovery

## การทดสอบแนะนำ

1. อัปโหลดไฟล์ v0.9.6 ทับของเดิมทั้งหมดใน GitHub Pages
2. ปิดหน้า Sender/Control Center เก่าบนทุกเครื่อง แล้วเปิดใหม่
3. ทดสอบ Slider Zoom โดย **ลากช้า ๆ ขณะมองภาพจริง** — ภาพควรเริ่มขยับระหว่างลาก ไม่ใช่หลังปล่อย
4. ทดสอบปุ่ม `−/+` ค้างในโหมด ช้า/ปกติ/เร็ว
5. หากอุปกรณ์รายงาน zoom step หยาบ เช่น 0.1x อาจยังเห็นขั้นเล็กน้อย ซึ่งเป็นข้อจำกัดของ browser/PWA; Native app จะทำ native zoom ramp ได้ละเอียดกว่า
