/**
 * Send to AWS sqs
 */

const AWS = require('aws-sdk');
const safeJSON = require('safely-parse-json');
const Consumer = require('sqs-consumer');

class SQS {
  constructor(name, emitter, config = {}) {
    this.name = name;
    this.emitter = emitter;
    this.config = Object.assign({
      region: 'us-east-1',
    }, config);
    this.client = null;
    this.queues = {};
  }

  log(message, data) {
    this.emitter.emit('log', {
      service: this.name,
      message,
      data,
    });
  }

  success(message, data) {
    this.emitter.emit('success', {
      service: this.name, message, data,
    });
  }

  error(err, data) {
    this.emitter.emit('error', {
      service: this.name,
      data,
      err,
    });
  }

  init() {
    this.client = new AWS.SQS(this.config);
    // try to list queues
    return this.client.listQueues({
      QueueNamePrefix: '',
    }).promise()
      .then((response) => {
        this.log(`Connected on SQS:${this.name}`, this.config);
        const queueUrls = response.QueueUrls || [];
        queueUrls.forEach((queueUrl) => {
          const queueUrlSplits = queueUrl.split('/');
          const queueName = queueUrlSplits[queueUrlSplits.length - 1];
          this.queues = Object.assign(this.queues, {
            [queueName]: queueUrl,
          });
        });
      })
      .catch((err) => {
        this.error(err, this.config);
        throw err;
      });
  }

  /**
   * Create a new queue
   * @param  {String} name
   * @param  {Object} opts
   * @param {Integer} opts.DelaySeconds=0 [The length of time, in seconds,
   *                                      for which the delivery of
   *                                      all messages in the queue is delayed]
   * @param {Integer} opts.MaximumMessageSize=262,144 [Defaults to 262,144 (256 KiB)]
   * @param {Integer} opts.MessageRetentionPeriod=345,600 [in seconds]
   * @param {Integer} opts.ReceiveMessageWaitTimeSeconds=0 [in seconds, The length of time
   *                                                       in seconds, for which a ReceiveMessage
   *                                                        action waits for a message to arrive]
   * @param {String} opts.FifoQueue='false' [Use FIFO (true) or Standard queue (false)]
   * @return {Promise}
   */
  createQueue(name, opts = {}) {
    if (this.queues[name]) {
      const queueUrl = this.queues[name];
      const message = `Queue ${name} exists => ${queueUrl}`;
      this.log(message, {
        name,
        queueUrl,
      });
      return Promise.resolve(true);
    }
    const options = Object.assign({
      // FifoQueue: 'false', // use standard by default
    }, opts);
    return this.client.createQueue({
      QueueName: name,
      Attributes: options,
    }).promise()
      .then((response) => {
        const queueUrl = response.QueueUrl;
        const message = `Created queue ${name} => ${queueUrl}`;
        this.queues = Object.assign(this.queues, {
          [name]: queueUrl,
        });
        this.log(message, { name, queueUrl });
      })
      .catch((err) => {
        this.error(err, { name, options });
        throw err;
      });
  }

  /**
   * Publish on SQS
   * @param  {string}  name
   * @param  {*}       type
   * @param  {Object}  meta={}
   * @param  {Boolean} handle=true  [Should the error be handled]
   * @return {Promise}
   */
  publish(name, content, meta = {}, handle = true) {
    const queueUrl = this.queues[name];
    if (!queueUrl) {
      const error = new Error(`Queue ${name} does not exists`);
      this.error(error, error.cause);
      if (handle === false) {
        return Promise.reject(error);
      }
    }
    const params = {
      QueueUrl: this.queues[name],
      MessageBody: JSON.stringify({ content, meta }),
    };
    return this.client.sendMessage(params).promise()
      .then((res) => res)
      .catch((err) => {
        this.error(err, {
          queueName: name,
          content,
          meta,
          handle,
        });
        if (handle === false) {
          throw err;
        }
      });
  }

  getQueueUrl(name) {
    const queueUrl = this.queues[name];
    if (!queueUrl) {
      const error = new Error(`Queue ${name} does not exists`);
      this.error(error, error.cause);
      return Promise.reject(error);
    }
    return queueUrl;
  }


  /**
   * Subscribe to a queue, using long polling
   */
  subscribe(name, cb, opts = {}) {
    const queueUrl = this.getQueueUrl(name);
    return new Promise((resolve) => {
      const sub = Consumer.create({
        queueUrl,
        handleMessage: (msg, done) => {
          cb({
            data: safeJSON(msg.Body),
            ack: done,
            nack: (err) => {
              done(err || new Error('Unable to process message'));
            },
          }, {
            id: msg.MessageId,
            handle: msg.ReceiptHandle,
            queueAttributes: msg.Attributes,
            messageAttributes: msg.MessageAttributes,
          });
        },
        batchSize: opts.maxInProgress || 10,
        sqs: this.client,
      });

      sub.on('error', (err) => {
        this.error(err, {
          queueName: name,
        });
      });
      sub.on('processing_error', (err) => {
        this.error(err, {
          queueName: name,
        });
      });
      this.success(`Subscribed to ${queueUrl}`);
      sub.start();
      resolve(sub);
    });
  }


  deleteMessage(name, messageId, handle) {
    const queueUrl = this.getQueueUrl(name);
    const params = {
      QueueUrl: queueUrl,
      ReceiptHandle: handle,
    };

    return this.client.deleteMessage(params).promise();
  }


  returnMessage(name, messageId, handle) {
    const queueUrl = this.getQueueUrl(name);
    const params = {
      QueueUrl: queueUrl,
      ReceiptHandle: handle,
      VisibilityTimeout: 0,
    };
    return this.client.changeMessageVisibility(params).promise();
  }


  fetchMessages(name, number = 10) {
    const queueUrl = this.getQueueUrl(name);
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: number,
    };
    return this.client.receiveMessage(params).promise().then(res => {
      return res.Messages.map(msg => {
        return {
          data: safeJSON(msg.Body),
          ack: () => {
            return this.deleteMessage(name, msg.MessageId, msg.ReceiptHandle);
          },
          nack: () => {
            return this.returnMessage(name, msg.MessageId, msg.ReceiptHandle);
          },
        }, {
          id: msg.MessageId,
          handle: msg.ReceiptHandle,
          queueAttributes: msg.Attributes,
          messageAttributes: msg.MessageAttributes,
        };
      });
    });
  }

  fetchOne(name) {
    return this.fetchMessages(name, 1).then(messages => messages[0]);
  }
}

module.exports = SQS;
