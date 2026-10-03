/**
 * Script giả lập gửi dữ liệu Telemetry qua MQTT để test tính năng Biểu đồ & Dự báo AI.
 *
 * Cách chạy:
 *   node scripts/simulate_telemetry.js --scenario normal
 *   node scripts/simulate_telemetry.js --scenario overheat
 *   node scripts/simulate_telemetry.js --scenario overcool
 *   node scripts/simulate_telemetry.js --scenario fanfault   (quạt mất nguồn -> cảnh báo DEVICE_FAULT)
 *
 * Mỗi điểm đo gửi đủ các trường như firmware ESP32 v1.1 (độ ẩm, trạng thái
 * quạt, điện áp nguồn quạt, còi), xem firmware/README.md.
 */

const mqtt = require('../server/node_modules/mqtt');

const args = process.argv.slice(2);
let scenario = 'normal';
let deviceId = 'ESP32-A12509'; // Mặc định: Phòng N1 - Mát (Kho lạnh Biên Hoà)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scenario' && args[i + 1]) {
    scenario = args[i + 1].toLowerCase();
  }
  if (args[i] === '--device' && args[i + 1]) {
    deviceId = args[i + 1];
  }
}

// Cấu hình:
// - Thiết bị ESP32-A12509: Phòng N1 - Mát (Kho lạnh Biên Hoà, Ngưỡng 0°C - 4°C)
// - Thiết bị ESP32-A11957: Phòng I2 - Mát (Kho lạnh Sơn Trà, Ngưỡng 0°C - 4°C)
const DEVICE_ID = deviceId;
const TOPIC = `devices/${DEVICE_ID}/telemetry`;
const BROKER_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
// Broker không cho kết nối ẩn danh (mosquitto/entrypoint.sh): dùng tài khoản
// thiết bị — mặc định khớp với docker-compose.yml, ghi đè qua env nếu khác.
const MQTT_USERNAME = process.env.MQTT_DEVICE_USERNAME || 'device';
const MQTT_PASSWORD = process.env.MQTT_DEVICE_PASSWORD || 'password';

console.log(`\n======================================================`);
console.log(`🚀 BẮT ĐẦU GIẢ LẬP DỮ LIỆU TELEMETRY (KỊCH BẢN: ${scenario.toUpperCase()})`);
console.log(`📍 Thiết bị: ${DEVICE_ID}`);
console.log(`📍 Phòng mục tiêu: Ngưỡng 0°C - 4°C (Kho lạnh Biên Hoà / Sơn Trà)`);
console.log(`======================================================\n`);

const client = mqtt.connect(BROKER_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
});

client.on('connect', () => {
  console.log(`✓ Đã kết nối MQTT Broker tại ${BROKER_URL}`);
  const now = Date.now();
  const points = [];

  // Tạo chuỗi 6 điểm đo trong 30 phút gần nhất (mỗi điểm cách nhau 5 phút)
  for (let i = 5; i >= 0; i--) {
    const ts = new Date(now - i * 5 * 60 * 1000).toISOString();
    let temp = 2.5;

    if (scenario === 'overheat') {
      // Tăng dần từ 3.2°C lên 4.6°C -> Vượt trần 4.0°C
      temp = 3.2 + (5 - i) * 0.28;
    } else if (scenario === 'fanfault') {
      // Quạt mất nguồn: nhiệt độ ấm dần từ 2.6°C lên 3.6°C, chưa vượt trần
      temp = 2.6 + (5 - i) * 0.2;
    } else if (scenario === 'overcool') {
      // Giảm dần từ 1.0°C xuống -0.8°C -> Tụt sàn 0.0°C
      temp = 1.0 - (5 - i) * 0.36;
    } else {
      // Bình thường: Dao động ổn định an toàn từ 2.4°C đến 2.8°C
      temp = 2.4 + (5 - i) * 0.08;
    }

    const doorOpen = scenario === 'overheat' && i === 0; // Kịch bản quá nhiệt do hé cửa
    // Như firmware: quạt tắt khi cửa mở; ở kịch bản fanfault quạt vẫn bật
    // nhưng nguồn tụt (2 điểm cuối).
    const fanOn = !doorOpen;
    const fanPowerFault = scenario === 'fanfault' && i <= 1;
    const fanVoltage = !fanOn ? 0 : fanPowerFault ? 0.4 : Math.round((11.8 + Math.random() * 0.3) * 100) / 100;
    points.push({
      ts,
      temperature: Math.round(temp * 100) / 100,
      humidity: Math.round((82 + Math.random() * 6) * 10) / 10,
      doorOpen,
      sensorFault: false,
      fanOn,
      fanVoltage,
      fanPowerFault,
      alarmActive: doorOpen || fanPowerFault,
    });
  }

  console.log(`Đang xuất bản ${points.length} điểm đo tới topic "${TOPIC}":`);
  points.forEach((p, idx) => {
    const payloadStr = JSON.stringify(p);
    client.publish(TOPIC, payloadStr, { qos: 1 });
    console.log(`  [Điểm ${idx + 1}/6] ${p.ts} -> Nhiệt độ: ${p.temperature}°C, Độ ẩm: ${p.humidity}% (Cửa: ${p.doorOpen ? 'MỞ' : 'ĐÓNG'}, Quạt: ${p.fanPowerFault ? 'MẤT NGUỒN' : p.fanOn ? 'BẬT' : 'TẮT'} ${p.fanVoltage}V)`);
  });

  setTimeout(() => {
    client.end();
    console.log(`\n✅ Hoàn tất gửi dữ liệu giả lập!`);
    console.log(`👉 Bạn có thể vào Web: http://localhost:5173/monitoring`);
    console.log(`👉 Chọn kho "Kho lạnh Sơn Trà" -> Mở "Phòng I2 - Mát" để kiểm tra biểu đồ dự báo.\n`);
  }, 600);
});

client.on('error', (err) => {
  console.error('❌ Lỗi kết nối MQTT:', err);
  client.end();
});
