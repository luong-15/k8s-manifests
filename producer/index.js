const express = require('express');
const { Kafka } = require('kafkajs');

const app = express();
app.use(express.json());

const kafkaHost = process.env.KAFKA_BROKER || 'kafka:9092';
const kafka = new Kafka({ clientId: 'order-producer', brokers: [kafkaHost] });
const producer = kafka.producer();

let isConnected = false;

async function connectKafka() {
  try {
    await producer.connect();
    isConnected = true;
    console.log('✅ Producer connected to Kafka successfully');
  } catch (err) {
    console.error('❌ Kafka connection failed, retrying in 3s...', err.message);
    setTimeout(connectKafka, 3000);
  }
}
connectKafka();

app.post('/order', async (req, res) => {
  if (!isConnected) {
    return res.status(503).json({ error: 'Kafka Producer chưa sẵn sàng!' });
  }

  const order = {
    orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
    item: req.body.item || 'Laptop Dell XPS',
    price: req.body.price || 1500,
    timestamp: new Date().toISOString()
  };

  try {
    await producer.send({
      topic: 'orders',
      messages: [{ value: JSON.stringify(order) }],
    });
    console.log(`[PRODUCER 🚀] Đã gửi đơn hàng: ${order.orderId} (${order.item})`);
    res.json({ message: 'Tạo đơn hàng thành công!', order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.send('OK'));

app.listen(3000, () => console.log('🚀 Producer Service đang chạy tại port 3000'));