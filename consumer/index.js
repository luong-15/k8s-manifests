const { Kafka } = require('kafkajs');

const kafkaHost = process.env.KAFKA_BROKER || 'kafka:9092';
const kafka = new Kafka({ clientId: 'notification-consumer', brokers: [kafkaHost] });
const consumer = kafka.consumer({ groupId: 'notification-group' });

async function run() {
  try {
    await consumer.connect();
    console.log('✅ Consumer connected to Kafka successfully');
    
    await consumer.subscribe({ topic: 'orders', fromBeginning: true });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const order = JSON.parse(message.value.toString());
        console.log(`[CONSUMER 🔔] Nhận event -> Đang gửi email/SMS cho đơn hàng #${order.orderId} [${order.item} - $${order.price}]`);
      },
    });
  } catch (err) {
    console.error('❌ Consumer Error, retrying in 3s...', err.message);
    setTimeout(run, 3000);
  }
}

run();