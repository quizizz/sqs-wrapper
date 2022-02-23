/* eslint no-console: 0 */

const EventEmitter = require('events').EventEmitter;
const uuid = require('uuid/v4');
const SQS = require('../src/index');

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));

const sqs = new SQS('sqs', emitter);

function getGroup() {
  return {
    name: 'testing',
    id: uuid(),
  };
}

async function push() {
  await sqs.init();
  await sqs.createQueue('test.fifo', {
    FifoQueue: 'true',
  });

  // First message
  await sqs.publishFifo('test.fifo', { message: 'one' }, {}, getGroup());

  // Second message
  await sqs.publishFifo('test.fifo', { message: 'two' }, {}, getGroup());
  await sqs.publishFifo('test.fifo', { message: 'three' }, {}, getGroup());
  await sqs.publishFifo('test.fifo', { message: 'four' }, {}, getGroup());
  await sqs.publishFifo('test.fifo', { message: 'five' }, {}, getGroup());
  await sqs.publishFifo('test.fifo', { message: 'six' }, {}, getGroup());
  await sqs.publishFifo('test.fifo', { message: 'seven' }, {}, getGroup());
}

push().then(() => console.log('Pusblish')).catch(console.error.bind(console));

