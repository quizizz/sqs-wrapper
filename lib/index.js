"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const safely_parse_json_1 = __importDefault(require("safely-parse-json"));
const sqs_consumer_1 = require("sqs-consumer");
const uuid_1 = __importDefault(require("uuid"));
class SQS {
    name;
    emitter;
    config;
    client;
    queues;
    constructor(name, emitter, config = {}) {
        this.name = name;
        this.emitter = emitter;
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
    async init() {
        this.client = new aws_sdk_1.default.SQS(this.config);
        // try to list queues
        try {
            const response = await this.client
                .listQueues({
                QueueNamePrefix: "",
            })
                .promise();
            this.log(`Connected on SQS:${this.name}`, this.config);
            const queueUrls = response.QueueUrls || [];
            queueUrls.forEach((queueUrl) => {
                const queueUrlSplits = queueUrl.split("/");
                const queueName = queueUrlSplits[queueUrlSplits.length - 1];
                this.queues = Object.assign(this.queues, {
                    [queueName]: queueUrl,
                });
            });
        }
        catch (err) {
            this.error(err, this.config);
            throw err;
        }
        return this;
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
                Id: uuid_1.default.v4(),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBd0M7QUFDeEMsMEVBQXlDO0FBQ3pDLCtDQUF3QztBQWN4QyxnREFBd0I7QUFFeEIsTUFBcUIsR0FBRztJQUNkLElBQUksQ0FBUztJQUNiLE9BQU8sQ0FBZTtJQUN0QixNQUFNLENBQXNCO0lBQzVCLE1BQU0sQ0FBVTtJQUNoQixNQUFNLENBQXlCO0lBRXZDLFlBQVksSUFBWSxFQUFFLE9BQXFCLEVBQUUsTUFBTSxHQUFHLEVBQUU7UUFDMUQsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUN6QjtZQUNFLE1BQU0sRUFBRSxXQUFXO1NBQ3BCLEVBQ0QsTUFBTSxDQUNQLENBQUM7UUFDRixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQztRQUNuQixJQUFJLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNuQixDQUFDO0lBRUQsR0FBRyxDQUFDLE9BQWUsRUFBRSxJQUEwQjtRQUM3QyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUU7WUFDdkIsT0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2xCLE9BQU87WUFDUCxJQUFJO1NBQ0wsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU8sQ0FBQyxPQUFlLEVBQUUsSUFBMEI7UUFDakQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFO1lBQzNCLE9BQU8sRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNsQixPQUFPO1lBQ1AsSUFBSTtTQUNMLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsR0FBVSxFQUFFLElBQTBCO1FBQzFDLElBQUksQ0FB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