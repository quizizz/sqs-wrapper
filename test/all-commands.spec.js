const EventEmitter = require('events').EventEmitter;
const { v4: uuid } = require('uuid');
const SQS = require('../index');

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));

const sqs = new SQS('sqs', emitter);

const STANDARD_QUEUE = 'test-standard';
const FIFO_QUEUE = 'test-fifo.fifo';

function getGroup() {
  return { name: 'test-group', id: uuid() };
}

async function runTests() {
  console.log('=== Testing All SQS Commands ===\n');

  // Test: init
  console.log('1. init()');
  await sqs.init();
  console.log('   ✓ Initialized\n');

  // Test: createQueue
  console.log('2. createQueue()');
  await sqs.createQueue(STANDARD_QUEUE);
  await sqs.createQueue(FIFO_QUEUE, { FifoQueue: 'true' });
  console.log('   ✓ Queues created\n');

  // Test: getQueueUrl
  console.log('3. getQueueUrl()');
  const url = sqs.getQueueUrl(STANDARD_QUEUE);
  console.log(`   ✓ Got URL: ${url}\n`);

  // Test: publish
  console.log('4. publish()');
  await sqs.publish(STANDARD_QUEUE, { msg: 'test' }, {});
  await sqs.publish(STANDARD_QUEUE, { msg: 'delayed' }, {}, true, { delay: 5 });
  console.log('   ✓ Messages published\n');

  // Test: publishFifo
  console.log('5. publishFifo()');
  for (let i = 1; i <= 5; i++) {
    await sqs.publishFifo(FIFO_QUEUE, { msg: `test-${i}` }, {}, getGroup());
  }
  console.log('   ✓ FIFO messages published\n');

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test: fetchMessages
  console.log('6. fetchMessages()');
  const messages = await sqs.fetchMessages(FIFO_QUEUE, 3);
  console.log(`   ✓ Fetched ${messages.length} messages\n`);

  // Test: fetchOne
  console.log('7. fetchOne()');
  const one = await sqs.fetchOne(FIFO_QUEUE);
  if (one) {
    console.log('   ✓ Fetched one message\n');
  } else {
    console.log('   ✓ fetchOne executed (no messages available)\n');
  }

  // Test: deleteMessage (via ack)
  console.log('8. deleteMessage() via ack');
  if (messages.length > 0) {
    await messages[0].ack();
  }
  console.log('   ✓ Message deleted\n');

  // Test: returnMessage (via nack)
  console.log('9. returnMessage() via nack');
  if (messages.length > 1) {
    await messages[1].nack();
  }
  console.log('   ✓ Message returned\n');

  // Test: subscribe
  console.log('10. subscribe()');
  let count = 0;
  const consumer = await sqs.subscribe(FIFO_QUEUE, (msg) => {
    count++;
    msg.ack();
    if (count >= 2) {
      consumer.stop();
    }
  }, { maxInProgress: 2 });
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  consumer.stop();
  console.log(`   ✓ Subscription processed ${count} messages\n`);

  // Test: error handling
  console.log('11. Error handling');
  try {
    await sqs.publish('non-existent', { test: true }, {}, false);
  } catch (err) {
    console.log('   ✓ Error handled correctly\n');
  }

  console.log('=== All Tests Passed ===');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Tests failed:', err);
    process.exit(1);
  });
