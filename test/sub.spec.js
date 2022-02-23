/* eslint no-console: 0 */


const EventEmitter = require('events').EventEmitter;

const SQS = require('../src/index');

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));

const sqs = new SQS('sqs', emitter);

async function sub() {
  await sqs.init();
  await sqs.createQueue('test.fifo', {
    FifoQueue: 'true',
  });

  await sqs.subscribe('test.fifo', (msg) => {
    console.log(msg.data);
    setTimeout(() => {
      msg.ack();
    }, 1000);
  }, {
    maxInProgress: 2,
  });
}

sub().then(() => console.log('Subsciption')).catch(console.error.bind(console));

