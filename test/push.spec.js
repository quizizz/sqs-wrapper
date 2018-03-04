const EventEmitter = require('events').EventEmitter;

const SQS = require('../index');

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));

const sqs = new SQS('sqs', emitter);

async function push() {
  await sqs.init();
  await sqs.createQueue('test');

  // First message
  await sqs.publish('test', { message: 'one' });

  // Second message
  await sqs.publish('test', { message: 'two' });
  await sqs.publish('test', { message: 'three' });
  await sqs.publish('test', { message: 'four' });
  await sqs.publish('test', { message: 'five' });
  await sqs.publish('test', { message: 'six' });
  await sqs.publish('test', { message: 'seven' });
}

push().then(() => console.log('Pusblish')).catch(console.error.bind(console));

