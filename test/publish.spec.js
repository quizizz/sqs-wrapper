/* eslint no-console: 0 */

const { EventEmitter } = require('events');
const SQS = require('../lib/index').default;

const emitter = new EventEmitter();
emitter.on('error', console.error.bind(console));
emitter.on('log', console.log.bind(console));
emitter.on('success', console.log.bind(console));

const sqs = new SQS('sqs', emitter);

async function push() {
  await sqs.init();
  await sqs.createQueue('test-batch');

  await sqs.publishBatch('test-batch', [
    { id: '1', body: { name: 'test1' } },
    { id: '2', body: { name: 'test2' } },
    { id: '3', body: { name: 'test3' } },
    { id: '4', body: { name: 'test4' } },
  ]);
}

push()
  .then(() => console.log('Published'))
  .catch(console.error.bind(console));
