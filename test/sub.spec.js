/* eslint no-console: 0 */

const EventEmitter = require('events').EventEmitter;
const SQS = require('../lib/index').default;

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));
process.on('unhandledRejection', console.log);
process.on('uncaughtException', console.log);
process.on('uncaughtExceptionMonitor', console.log);

const sqs = new SQS('sqs', emitter);

async function fetch() {
  await sqs.init();
  await sqs.createQueue('test.fifo', {
    FifoQueue: 'true',
  });

  // Fetch messages from the queue
  const messages = await sqs.fetchMessages('test.fifo', 5);
  console.log(`Fetched ${messages.length} messages`);
  
  // Process each message
  for (const msg of messages) {
    console.log('Message:', msg.data);
    console.log('Message ID:', msg.id);
    
    // Acknowledge the message after processing
    await msg.ack();
    console.log('Message acknowledged');
  }
}

fetch().then(() => console.log('Fetch completed')).catch(console.error.bind(console));

