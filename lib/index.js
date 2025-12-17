"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_sqs_1 = require("@aws-sdk/client-sqs");
const safely_parse_json_1 = __importDefault(require("safely-parse-json"));
const sqs_consumer_1 = require("sqs-consumer");
const uuid_1 = require("uuid");
const https_1 = require("https");
class SQS {
    name;
    emitter;
    config;
    client;
    queues;
    constructor(name, emitter, config = {}) {
        this.name = name;
        this.emitter = emitter;
        if (!config.httpOptions) {
            config.httpOptions = {
                agent: new https_1.Agent({
                    keepAlive: true,
                }),
            };
        }
        this.config = Object.assign({
            region: "us-east-1",
            accountId: '399771530480',
        }, config);
        this.client = null;
    }
    log(message, data) {
        this.emitter.emit("log", {
            service: this.name,
            message,
            data,
        });
    }
    success(message, data) {
        this.emitter.emit("success", {
            service: this.name,
            message,
            data,
        });
    }
    error(err, data) {
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
    async init(region, accountId) {
        try {
            this.config = {
                ...this.config,
                ...(region && { region }),
                ...(accountId && { accountId })
            };
            this.client = new client_sqs_1.SQSClient(this.config);
            this.log(`Connected on SQS:${this.name}`, this.config);
            return this;
        }
        catch (err) {
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
    async createQueue(name, opts = {}) {
        const options = Object.assign({
        // FifoQueue: 'false', // use standard by default
        }, opts);
        try {
            const command = new client_sqs_1.CreateQueueCommand({
                QueueName: name,
                Attributes: options,
            });
            const response = await this.client.send(command);
            const queueUrl = response.QueueUrl;
            const message = `Created queue ${name} => ${queueUrl}`;
            this.log(message, { name, queueUrl });
        }
        catch (err) {
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
    async publish(name, content, meta = {}, handle = true, options = {}) {
        const params = {
            QueueUrl: this.getQueueUrl(name),
            MessageBody: JSON.stringify({ content, meta }),
        };
        if (typeof options.delay === "number") {
            params.DelaySeconds = options.delay;
        }
        try {
            const command = new client_sqs_1.SendMessageCommand(params);
            const res = await this.client.send(command);
            return res;
        }
        catch (err) {
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
    async publishBatch(name, contentList, meta = {}, handle = true, options = {}) {
        let DelaySeconds;
        if (typeof options.delay === "number") {
            DelaySeconds = options.delay;
        }
        const params = {
            QueueUrl: this.getQueueUrl(name),
            Entries: contentList.map((content) => ({
                Id: (0, uuid_1.v4)(),
                MessageBody: JSON.stringify({ content, meta }),
                DelaySeconds,
            })),
        };
        try {
            const command = new client_sqs_1.SendMessageBatchCommand(params);
            const res = await this.client.send(command);
            return res;
        }
        catch (err) {
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
    async publishFifo(name, content, meta = {}, group, handle = true) {
        const params = {
            QueueUrl: this.getQueueUrl(name),
            MessageBody: JSON.stringify({ content, meta }),
            MessageGroupId: group.name,
            MessageDeduplicationId: group.id,
        };
        try {
            const command = new client_sqs_1.SendMessageCommand(params);
            const res = await this.client.send(command);
            return res;
        }
        catch (err) {
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
    getQueueUrl(name) {
        return `https://sqs.${this.config.region}.amazonaws.com/${this.config.accountId}/${name}`;
    }
    /**
     * Subscribe to a queue, using long polling
     */
    subscribe(name, cb, opts = {}) {
        const queueUrl = this.getQueueUrl(name);
        return new Promise((resolve) => {
            const sub = sqs_consumer_1.Consumer.create({
                queueUrl,
                handleMessage: (msg) => {
                    return new Promise((_resolve, reject) => {
                        cb({
                            data: (0, safely_parse_json_1.default)(msg.Body),
                            ack: _resolve,
                            nack: (err) => {
                                reject(err || new Error("Unable to process message"));
                            },
                        }, {
                            id: msg.MessageId,
                            handle: msg.ReceiptHandle,
                            queueAttributes: msg.Attributes,
                            messageAttributes: msg.MessageAttributes,
                        });
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
    async deleteMessage(name, messageId, handle) {
        const queueUrl = this.getQueueUrl(name);
        const params = {
            QueueUrl: queueUrl,
            ReceiptHandle: handle,
        };
        const command = new client_sqs_1.DeleteMessageCommand(params);
        await this.client.send(command);
    }
    async returnMessage(name, messageId, handle) {
        const queueUrl = this.getQueueUrl(name);
        const params = {
            QueueUrl: queueUrl,
            ReceiptHandle: handle,
            VisibilityTimeout: 0,
        };
        const command = new client_sqs_1.ChangeMessageVisibilityCommand(params);
        await this.client.send(command);
    }
    async fetchMessages(name, number = 10) {
        const queueUrl = this.getQueueUrl(name);
        const params = {
            QueueUrl: queueUrl,
            MaxNumberOfMessages: number,
        };
        const command = new client_sqs_1.ReceiveMessageCommand(params);
        const res = await this.client.send(command);
        const messages = res.Messages || [];
        return messages.map((msg) => {
            return {
                data: (0, safely_parse_json_1.default)(msg.Body),
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
    async fetchOne(name) {
        const messages = await this.fetchMessages(name, 1);
        return messages[0];
    }
}
exports.default = SQS;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxvREFlNkI7QUFDN0IsMEVBQXlDO0FBQ3pDLCtDQUF3QztBQUV4QywrQkFBb0M7QUFDcEMsaUNBQThCO0FBRTlCLE1BQXFCLEdBQUc7SUFDZCxJQUFJLENBQVM7SUFDYixPQUFPLENBQWU7SUFDdEIsTUFBTSxDQUFzQjtJQUM1QixNQUFNLENBQVk7SUFDbEIsTUFBTSxDQUF5QjtJQUV2QyxZQUFZLElBQVksRUFBRSxPQUFxQixFQUFFLFNBQThCLEVBQUU7UUFDL0UsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUN4QixNQUFNLENBQUMsV0FBVyxHQUFHO2dCQUNuQixLQUFLLEVBQUUsSUFBSSxhQUFLLENBQUM7b0JBQ2YsU0FBUyxFQUFFLElBQUk7aUJBQ2hCLENBQUM7YUFDSCxDQUFDO1FBQ0osQ0FBQztRQUNELElBQUksQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FDekI7WUFDRSxNQUFNLEVBQUUsV0FBVztZQUNuQixTQUFTLEVBQUUsY0FBYztTQUMxQixFQUNELE1BQU0sQ0FDUCxDQUFDO1FBQ0YsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUM7SUFDckIsQ0FBQztJQUVELEdBQUcsQ0FBQyxPQUFlLEVBQUUsSUFBMEI7UUFDN0MsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFO1lBQ3ZCLE9BQU8sRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNsQixPQUFPO1lBQ1AsSUFBSTtTQUNMLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLENBQUMsT0FBZSxFQUFFLElBQTBCO1FBQ2pELElBQUksQ0FBQyxPQUFPLENB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