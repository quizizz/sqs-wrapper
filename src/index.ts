import {
  SQSClient,
  CreateQueueCommand,
  SendMessageCommand,
  SendMessageBatchCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommandOutput,
  SendMessageRequest,
  SendMessageCommandOutput,
  ChangeMessageVisibilityRequest,
  DeleteMessageRequest,
  SendMessageBatchRequest,
} from "@aws-sdk/client-sqs";
import safeJSON from "safely-parse-json";
import { Consumer } from "sqs-consumer";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { Agent } from 'https';

export default class SQS {
  private name: string;
  private emitter: EventEmitter;
  private config: Record<string, any>;
  private client: SQSClient;
  private queues: Record<string, string>;

  constructor(name: string, emitter: EventEmitter, config: Record<string, any> = {}) {
    this.name = name;
    this.emitter = emitter;
    if (!config.httpOptions) {
      config.httpOptions = {
        agent: new Agent({
          keepAlive: true,
        }),
      };
    }
    this.config = Object.assign(
      {
        region: "us-east-1",
        accountId: '399771530480',
      },
      config
    );
    this.client = null;
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

  /**
   * Initializes the SQS client with the provided region and account ID.
   * 
   * @param {string} [region] - The AWS region to set for the SQS client.
   * @param {string} [accountId] - The AWS account ID to set for the SQS client.
   * @returns {Promise<SQS>} A promise that resolves to the initialized SQS client.
   * @throws Will throw an error if the initialization fails.
   */
  async init(region?: string, accountId?: string): Promise<SQS> {
    try {
      this.config = {
        ...this.config,
        ...(region && { region }),
        ...(accountId && { accountId })
      };
      this.client = new SQSClient(this.config);
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
  async createQueue(name: string, opts: Record<string, string> = {}): Promise<void> {
    const options = Object.assign(
      {
        // FifoQueue: 'false', // use standard by default
      },
      opts
    );
    try {
      const command = new CreateQueueCommand({
        QueueName: name,
        Attributes: options,
      });
      const response = await this.client.send(command);
      const queueUrl = response.QueueUrl;
      const message = `Created queue ${name} => ${queueUrl}`;
      this.log(message, { name, queueUrl });
    } catch (err) {
      console.log('error creating the queue: ', err);
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
  ): Promise<SendMessageCommandOutput> {
    const params: SendMessageRequest = {
      QueueUrl: this.getQueueUrl(name),
      MessageBody: JSON.stringify({ content, meta }),
    };

    if (typeof options.delay === "number") {
      params.DelaySeconds = options.delay;
    }

    try {
      const command = new SendMessageCommand(params);
      const res = await this.client.send(command);
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
      // Return empty response when error is handled
      return {} as SendMessageCommandOutput;
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
  ): Promise<SendMessageBatchCommandOutput> {
    let DelaySeconds: number | undefined;
    if (typeof options.delay === "number") {
      DelaySeconds = options.delay;
    }

    const params: SendMessageBatchRequest = {
      QueueUrl: this.getQueueUrl(name),
      Entries: contentList.map((content) => ({
        Id: uuidv4(),
        MessageBody: JSON.stringify({ content, meta }),
        DelaySeconds,
      })),
    };

    try {
      const command = new SendMessageBatchCommand(params);
      const res = await this.client.send(command);
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
      // Return empty response when error is handled
      return { Successful: [], Failed: [] } as SendMessageBatchCommandOutput;
    }
  }

  async publishFifo(
    name: string,
    content: Record<string, any>,
    meta: Record<string, any> = {},
    group: Record<string, any>,
    handle: boolean = true
  ): Promise<SendMessageCommandOutput> {
    const params: SendMessageRequest = {
      QueueUrl: this.getQueueUrl(name),
      MessageBody: JSON.stringify({ content, meta }),
      MessageGroupId: group.name,
      MessageDeduplicationId: group.id,
    };
    try {
      const command = new SendMessageCommand(params);
      const res = await this.client.send(command);
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
      // Return empty response when error is handled
      return {} as SendMessageCommandOutput;
    }
  }

  getQueueUrl(name: string): string {
    return `https://sqs.${this.config.region}.amazonaws.com/${this.config.accountId}/${name}`;
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

    const command = new DeleteMessageCommand(params);
    await this.client.send(command);
  }

  async returnMessage(name: string, messageId: any, handle: string) {
    const queueUrl = this.getQueueUrl(name);
    const params: ChangeMessageVisibilityRequest = {
      QueueUrl: queueUrl,
      ReceiptHandle: handle,
      VisibilityTimeout: 0,
    };
    const command = new ChangeMessageVisibilityCommand(params);
    await this.client.send(command);
  }

  async fetchMessages(name: string, number = 10) {
    const queueUrl = this.getQueueUrl(name);
    const params = {
      QueueUrl: queueUrl,
      MaxNumberOfMessages: number,
    };
    const command = new ReceiveMessageCommand(params);
    const res = await this.client.send(command);
    const messages = res.Messages || [];
    return messages.map((msg) => {
      return {
        data: safeJSON(msg.Body),
        id: msg.MessageId,
        handle: msg.ReceiptHandle,
        queueAttributes: msg.Attributes,
        messageAttributes: msg.MessageAttributes,
        ack: () => {
          return this.deleteMessage(name, msg.MessageId, msg.ReceiptHandle);
        },
        nack: () => {
          return this.returnMessage(name, msg.MessageId, msg.ReceiptHandle);
        },
      };
    });
  }

  async fetchOne(name: string): Promise<any> {
    const messages = await this.fetchMessages(name, 1);
    return messages[0];
  }
}
