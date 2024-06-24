import AWS, { AWSError } from "aws-sdk";
import safeJSON from "safely-parse-json";
import { Consumer } from "sqs-consumer";
import EventEmitter from "events";
import {
  QueueAttributeMap,
  SendMessageBatchResult,
  SendMessageRequest,
  SendMessageResult,
} from "aws-sdk/clients/sqs";
import { PromiseResult } from "aws-sdk/lib/request";
import {
  ChangeMessageVisibilityRequest,
  DeleteMessageRequest,
  SendMessageBatchRequest,
} from "@aws-sdk/client-sqs";
import { v4 as uuidv4 } from "uuid";

export default class SQS {
  private name: string;
  private emitter: EventEmitter;
  private config: Record<string, any>;
  private client: AWS.SQS;
  private queues: Record<string, string>;

  constructor(name: string, emitter: EventEmitter, config = {}) {
    this.name = name;
    this.emitter = emitter;
    this.config = Object.assign(
      {
        region: "us-east-1",
      },
      config
    );
    this.client = null;
    this.queues = {};
  }

  log(message: string, data?: Record<string, any>) {
    this.emitter.emit("log", {
      service: this.name,
      message,
      data,
    });
  }

  success(message: string, data?: Record<string, any>) {
    this.emitter.emit("success", {
      service: this.name,
      message,
      data,
    });
  }

  error(err: Error, data?: Record<string, any>) {
    this.emitter.emit("error", {
      service: this.name,
      data,
      err,
    });
  }

  private processQueueUrls(queueUrls: string[]): void {
    this.log('all queues: ');
    queueUrls.forEach((queueUrl: string) => {
      const queueUrlSplits = queueUrl.split('/');
      const queueName = queueUrlSplits[queueUrlSplits.length - 1];
      this.queues = { ...this.queues, [queueName]: queueUrl };
    });
  }

  private async listQueuesRecursively(queueNamePrefix: string, nextToken?: string): Promise<void> {
    this.log('hit in list queues recursively');
    try {
      const response: any = await this.client.listQueues({
        QueueNamePrefix: queueNamePrefix,
        NextToken: nextToken,
        MaxResults: 100,
      }).promise();

      const queueUrls: string[] = response.QueueUrls || [];
      this.processQueueUrls(queueUrls);

      if (response.NextToken) {
        await this.listQueuesRecursively(queueNamePrefix, response.NextToken);
      }
    } catch (err: any) {
      this.error(err, this.config);
      throw err;
    }
  }

  async init(queueNamePrefix?: string): Promise<SQS> {
    try {
      this.client = new AWS.SQS(this.config);
      await this.listQueuesRecursively(queueNamePrefix);
      this.log(`Connected on SQS:${this.name}`, this.config);
      return this;
    } catch (err: any) {
      this.error(err, this.config);
      throw err;
    }
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
  async createQueue(name: string, opts: QueueAttributeMap = {}): Promise<void> {
    if (this.queues[name]) {
      const queueUrl = this.queues[name];
      const message = `Queue ${name} exists => ${queueUrl}`;
      this.log(message, {
        name,
        queueUrl,
      });
      return Promise.resolve();
    }
    const options = Object.assign(
      {
        // FifoQueue: 'false', // use standard by default
      },
      opts
    );
    try {
      const response = await this.client
        .createQueue({
          QueueName: name,
          Attributes: options,
        })
        .promise();
      const queueUrl = response.QueueUrl;
      const message = `Created queue ${name} => ${queueUrl}`;
      this.queues = Object.assign(this.queues, {
        [name]: queueUrl,
      });
      this.log(message, { name, queueUrl });
    } catch (err) {
      this.error(err, { name, options });
      throw err;
    }
  }

  /**
   * Publish on SQS
   * @param  {string}  name
   * @param  {Object}  content
   * @param  {Object}  meta={}
   * @param  {Boolean} handle=true  [Should the error be handled]
   * @param  {Object}  [options={}]
   * @param  {Number}  [options.delay]  [in seconds]
   * @return {Promise}
   */
  async publish(
    name: string,
    content: Record<string, any>,
    meta: Record<string, any> = {},
    handle: boolean = true,
    options: Record<string, any> = {}
  ): Promise<PromiseResult<SendMessageResult, AWSError>> {
    const queueUrl = this.queues[name];
    if (!queueUrl) {
      const error = new Error(`Queue ${name} does not exists`);
      this.error(error, error.cause);
      if (handle === false) {
        return Promise.reject(error);
      }
    }
    const params: SendMessageRequest = {
      QueueUrl: this.queues[name],
      MessageBody: JSON.stringify({ content, meta }),
    };

    if (typeof options.delay === "number") {
      params.DelaySeconds = options.delay;
    }

    try {
      const res = await this.client.sendMessage(params).promise();
      return res;
    } catch (err) {
      this.error(err, {
        queueName: name,
        content,
        meta,
        handle,
      });
      if (handle === false) {
        throw err;
      }
    }
  }

  /**
   * Publish on SQS in batch
   * @param  {string}  name
   * @param  {Object[]}  contentList
   * @param  {Object}  meta={}
   * @param  {Boolean} handle=true  [Should the error be handled]
   * @param  {Object}  [options={}]
   * @param  {Number}  [options.delay]  [in seconds]
   * @return {Promise}
   */
  async publishBatch(
    name: string,
    contentList: Record<string, any>[],
    meta: Record<string, any> = {},
    handle: boolean = true,
    options: Record<string, any> = {}
  ): Promise<PromiseResult<SendMessageBatchResult, AWSError>> {
    const queueUrl = this.queues[name];
    if (!queueUrl) {
      const error = new Error(`Queue ${name} does not exists`);
      this.error(error, error.cause);
      if (handle === false) {
        return Promise.reject(error);
      }
    }
    let DelaySeconds: number | undefined;
    if (typeof options.delay === "number") {
      DelaySeconds = options.delay;
    }

    const params: SendMessageBatchRequest = {
      QueueUrl: this.queues[name],
      Entries: contentList.map((content) => ({
        Id: uuidv4(),
        MessageBody: JSON.stringify({ content, meta }),
        DelaySeconds,
      })),
    };

    try {
      const res = await this.client.sendMessageBatch(params).promise();
      return res;
    } catch (err) {
      this.error(err, {
        queueName: name,
        contentList,
        meta,
        handle,
      });
      if (handle === false) {
        throw err;
      }
    }
  }

  async publishFifo(
    name: string,
    content: Record<string, any>,
    meta: Record<string, any> = {},
    group: Record<string, any>,
    handle: boolean = true
  ): Promise<PromiseResult<SendMessageResult, AWSError>> {
    const queueUrl = this.queues[name];
    if (!queueUrl) {
      const error = new Error(`Queue ${name} does not exists`);
      this.error(error, error.cause);
      if (handle === false) {
        return Promise.reject(error);
      }
    }
    const params: SendMessageRequest = {
      QueueUrl: this.queues[name],
      MessageBody: JSON.stringify({ content, meta }),
      MessageGroupId: group.name,
      MessageDeduplicationId: group.id,
    };
    try {
      const res = await this.client.sendMessage(params).promise();
      return res;
    } catch (err) {
      this.error(err, {
        queueName: name,
        content,
        meta,
        handle,
      });
      if (handle === false) {
        throw err;
      }
    }
  }

  getQueueUrl(name: string): string {
    const queueUrl = this.queues[name];
    if (!queueUrl) {
      const error = new Error(`Queue ${name} does not exists`);
      this.error(error, error.cause);
      throw error;
    }
    return queueUrl;
  }

  /**
   * Subscribe to a queue, using long polling
   */
  subscribe(
    name: string,
    cb: (arg1: Record<string, any>, arg2: Record<string, any>) => void,
    opts: Record<string, any> = {}
  ) {
    const queueUrl = this.getQueueUrl(name);
    return new Promise((resolve) => {
      const sub = Consumer.create({
        queueUrl,
        handleMessage: (msg) => {
          return new Promise((_resolve, reject) => {
            cb(
              {
                data: safeJSON(msg.Body),
                ack: _resolve,
                nack: (err) => {
                  reject(err || new Error("Unable to process message"));
                },
              },
              {
                id: msg.MessageId,
                handle: msg.ReceiptHandle,
                queueAttributes: msg.Attributes,
                messageAttributes: msg.MessageAttributes,
              }
            );
          });
        },
        batchSize: opts.maxInProgress || 10,
        // @ts-ignore
        sqs: this.client,
      });

      sub.on("error", (err) => {
        this.error(err, {
          queueName: name,
        });
      });
      sub.on("processing_error", (err) => {
        this.error(err, {
          queueName: name,
        });
      });
      this.success(`Subscribed to ${queueUrl}`);
      sub.start();
      resolve(sub);
    });
  }

  async deleteMessage(
    name: string,
    messageId: any,
    handle: string
  ): Promise<void> {
    const queueUrl = this.getQueueUrl(name);
    const params: DeleteMessageRequest = {
      QueueUrl: queueUrl,
      ReceiptHandle: handle,
    };

    await this.client.deleteMessage(params).promise();
  }

  async returnMessage(name: string, messageId: any, handle: string) {
    const queueUrl = this.getQueueUrl(name);
    const params: ChangeMessageVisibilityRequest = {
      QueueUrl: queueUrl,
      ReceiptHandle: handle,
      VisibilityTimeout: 0,
    };
    await this.client.changeMessageVisibility(params).promise();
  }

  async fetchMessages(name: string, number = 10) {
    const queueUrl = this.getQueueUrl(name);
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: number,
    };
    const res = await this.client.receiveMessage(params).promise();
    return res.Messages.map((msg) => {
      return [
        {
          data: safeJSON(msg.Body),
          ack: () => {
            return this.deleteMessage(name, msg.MessageId, msg.ReceiptHandle);
          },
          nack: () => {
            return this.returnMessage(name, msg.MessageId, msg.ReceiptHandle);
          },
        },
        {
          id: msg.MessageId,
          handle: msg.ReceiptHandle,
          queueAttributes: msg.Attributes,
          messageAttributes: msg.MessageAttributes,
        },
      ];
    });
  }

  async fetchOne(name: string): Promise<any> {
    const messages = await this.fetchMessages(name, 1);
    return messages[0];
  }
}
