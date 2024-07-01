"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = __importDefault(require("aws-sdk"));
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
        }, config);
        this.client = null;
        this.queues = {};
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
    processQueueUrls(queueUrls) {
        queueUrls.forEach((queueUrl) => {
            const queueUrlSplits = queueUrl.split('/');
            const queueName = queueUrlSplits[queueUrlSplits.length - 1];
            this.queues = { ...this.queues, [queueName]: queueUrl };
        });
    }
    async listQueuesRecursively(queueNamePrefix, nextToken) {
        try {
            const response = await this.client.listQueues({
                QueueNamePrefix: queueNamePrefix,
                NextToken: nextToken,
            }).promise();
            const queueUrls = response.QueueUrls || [];
            this.processQueueUrls(queueUrls);
            if (response.NextToken) {
                await this.listQueuesRecursively(queueNamePrefix, response.NextToken);
            }
        }
        catch (err) {
            this.error(err, this.config);
            throw err;
        }
    }
    async init(queueNamePrefix) {
        try {
            this.client = new aws_sdk_1.default.SQS(this.config);
            await this.listQueuesRecursively(queueNamePrefix);
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
        if (this.queues[name]) {
            const queueUrl = this.queues[name];
            const message = `Queue ${name} exists => ${queueUrl}`;
            this.log(message, {
                name,
                queueUrl,
            });
            return Promise.resolve();
        }
        const options = Object.assign({
        // FifoQueue: 'false', // use standard by default
        }, opts);
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
        }
        catch (err) {
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
        if (typeof options.delay === "number") {
            params.DelaySeconds = options.delay;
        }
        try {
            const res = await this.client.sendMessage(params).promise();
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
        const queueUrl = this.queues[name];
        if (!queueUrl) {
            const error = new Error(`Queue ${name} does not exists`);
            this.error(error, error.cause);
            if (handle === false) {
                return Promise.reject(error);
            }
        }
        let DelaySeconds;
        if (typeof options.delay === "number") {
            DelaySeconds = options.delay;
        }
        const params = {
            QueueUrl: this.queues[name],
            Entries: contentList.map((content) => ({
                Id: (0, uuid_1.v4)(),
                MessageBody: JSON.stringify({ content, meta }),
                DelaySeconds,
            })),
        };
        try {
            const res = await this.client.sendMessageBatch(params).promise();
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
            MessageGroupId: group.name,
            MessageDeduplicationId: group.id,
        };
        try {
            const res = await this.client.sendMessage(params).promise();
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
        await this.client.deleteMessage(params).promise();
    }
    async returnMessage(name, messageId, handle) {
        const queueUrl = this.getQueueUrl(name);
        const params = {
            QueueUrl: queueUrl,
            ReceiptHandle: handle,
            VisibilityTimeout: 0,
        };
        await this.client.changeMessageVisibility(params).promise();
    }
    async fetchMessages(name, number = 10) {
        const queueUrl = this.getQueueUrl(name);
        const params = {
            QueueUrl: queueUrl,
            MaxNumberOfMessages: number,
        };
        const res = await this.client.receiveMessage(params).promise();
        return res.Messages.map((msg) => {
            return [
                {
                    data: (0, safely_parse_json_1.default)(msg.Body),
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
    async fetchOne(name) {
        const messages = await this.fetchMessages(name, 1);
        return messages[0];
    }
}
exports.default = SQS;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBd0M7QUFDeEMsMEVBQXlDO0FBQ3pDLCtDQUF3QztBQWN4QywrQkFBb0M7QUFDcEMsaUNBQThCO0FBRTlCLE1BQXFCLEdBQUc7SUFDZCxJQUFJLENBQVM7SUFDYixPQUFPLENBQWU7SUFDdEIsTUFBTSxDQUFzQjtJQUM1QixNQUFNLENBQVU7SUFDaEIsTUFBTSxDQUF5QjtJQUV2QyxZQUFZLElBQVksRUFBRSxPQUFxQixFQUFFLFNBQThCLEVBQUU7UUFDL0UsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUU7WUFDdkIsTUFBTSxDQUFDLFdBQVcsR0FBRztnQkFDbkIsS0FBSyxFQUFFLElBQUksYUFBSyxDQUFDO29CQUNmLFNBQVMsRUFBRSxJQUFJO2lCQUNoQixDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBQ0QsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUN6QjtZQUNFLE1BQU0sRUFBRSxXQUFXO1NBQ3BCLEVBQ0QsTUFBTSxDQUNQLENBQUM7UUFDRixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQztRQUNuQixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNuQixDQUFDO0lBRUQsR0FBRyxDQUFDLE9BQWUsRUFBRSxJQUEwQjtRQUM3QyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUU7WUFDdkIsT0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2xCLE9BQU87WUFDUCxJQUFJO1NBQ0wsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sQ0FBQyxPQUFlLEVBQUUsSUFBMEI7UUFDakQsSUFBSSxDQUFDLE9B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