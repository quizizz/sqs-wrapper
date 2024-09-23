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
        this.config = Object.assign(
        // TODO: Read from configuration
        {
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
            this.client = new aws_sdk_1.default.SQS(this.config);
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
            const response = await this.client
                .createQueue({
                QueueName: name,
                Attributes: options,
            })
                .promise();
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
        const params = {
            QueueUrl: this.getQueueUrl(name),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxzREFBd0M7QUFDeEMsMEVBQXlDO0FBQ3pDLCtDQUF3QztBQWN4QywrQkFBb0M7QUFDcEMsaUNBQThCO0FBRTlCLE1BQXFCLEdBQUc7SUFDZCxJQUFJLENBQVM7SUFDYixPQUFPLENBQWU7SUFDdEIsTUFBTSxDQUFzQjtJQUM1QixNQUFNLENBQVU7SUFDaEIsTUFBTSxDQUF5QjtJQUV2QyxZQUFZLElBQVksRUFBRSxPQUFxQixFQUFFLFNBQThCLEVBQUU7UUFDL0UsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7UUFDakIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxXQUFXLEVBQUU7WUFDdkIsTUFBTSxDQUFDLFdBQVcsR0FBRztnQkFDbkIsS0FBSyxFQUFFLElBQUksYUFBSyxDQUFDO29CQUNmLFNBQVMsRUFBRSxJQUFJO2lCQUNoQixDQUFDO2FBQ0gsQ0FBQztTQUNIO1FBQ0QsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTTtRQUN6QixnQ0FBZ0M7UUFDaEM7WUFDRSxNQUFNLEVBQUUsV0FBVztZQUNuQixTQUFTLEVBQUUsY0FBYztTQUMxQixFQUNELE1BQU0sQ0FDUCxDQUFDO1FBQ0YsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUM7SUFDckIsQ0FBQztJQUVELEdBQUcsQ0FBQyxPQUFlLEVBQUUsSUFBMEI7UUFDN0MsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFO1lBQ3ZCLE9BQU8sRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNsQixPQUFPO1lBQ1AsSUFBSTtTQUNMLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPLENBQUMsT0FBZSxFQUFFLElBQTBCO1FBQ2pELElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRTtZQUMzQixPQUFPLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDbEIsT0FBTztZQUNQLElBQUk7U0FDTCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLEdBQVUsRUFBRSxJQUEwQjtRQUMxQyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDekIsT0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2xCLElBQUk7WUFDSixHQUFHO1NBQ0osQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQWUsRUFBRSxTQUFrQjtRQUM1QyxJQUFJO1lBQ0YsSUFBSSxDQUFDLE1BQU0sR0FBRztnQkFDWixHQUFHLElBQUksQ0FBQyxNQUFNO2dCQUNkLEdBQUcsQ0FBQyxNQUFNLElBQUksRUFBRSxNQUFNLEVBQUUsQ0FBQztnQkFDekIsR0FBRyxDQUFDLFNBQVMsSUFBSSxFQUFFLFNBQVMsRUFBRSxDQUFDO2FBQ2hDLENBQUM7WUFDRixJQUFJLENBQUMsTUFBTSxHQUFHLElBQUksaUJBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3ZDLElBQUksQ0FBQyxHQUFHLENBQUMsb0JBQW9CLElBQUksQ0FBQyxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDdkQsT0FBTyxJQUFJLENBQUM7U0FDYjtRQUFDLE9BQU8sR0FBUSxFQUFFO1lBQ2pCLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUM3QixNQUFNLEdBQUcsQ0FBQztTQUNYO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7OztPQWNHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FBQyxJQUFZLEVBQUUsT0FBMEIsRUFBRTtRQUMxRCxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUMzQjtRQUNFLGlEQUFpRDtTQUNsRCxFQUNELElBQUksQ0FDTCxDQUFDO1FBQ0YsSUFBSTtZQUNGLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU07aUJBQy9CLFdBQVcsQ0FBQztnQkFDWCxTQUFTLEVBQUUsSUFBSTtnQkFDZixVQUFVLEVBQUUsT0FBTzthQUNwQixDQUFDO2lCQUNELE9BQU8sRUFBRSxDQUFDO1lBQ2IsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLFFBQVEsQ0FBQztZQUNuQyxNQUFNLE9BQU8sR0FBRyxpQkFBaUIsSUFBSSxPQUFPLFFBQVEsRUFBRSxDQUFDO1lBQ3ZELElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxDQUFDLENBQUM7U0FDdkM7UUFBQyxPQUFPLEdBQUcsRUFBRTtZQUNaLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDL0MsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUNuQyxNQUFNLEdBQUcsQ0FBQztTQUNYO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQ1gsSUFBWSxFQUNaLE9BQTRCLEVBQzVCLE9BQTRCLEVBQUUsRUFDOUIsU0FBa0IsSUFBSSxFQUN0QixVQUErQixFQUFFO1FBRWpDLE1BQU0sTUFBTSxHQUF1QjtZQUNqQyxRQUFRLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUM7WUFDaEMsV0FBVyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7U0FDL0MsQ0FBQztRQUVGLElBQUksT0FBTyxPQUFPLENBQUMsS0FBSyxLQUFLLFFBQVEsRUFBRTtZQUNyQyxNQUFNLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUM7U0FDckM7UUFFRCxJQUFJO1lBQ0YsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUM1RCxPQUFPLEdBQUcsQ0FBQztTQUNaO1FBQUMsT0FBTyxHQUFHLEVBQUU7WUFDWixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRTtnQkFDZCxTQUFTLEVBQUUsSUFBSTtnQkFDZixPQUFPO2dCQUNQLElBQUk7Z0JBQ0osTUFBTTthQUNQLENBQUMsQ0FBQztZQUNILElBQUksTUFBTSxLQUFLLEtBQUssRUFBRTtnQkFDcEIsTUFBTSxHQUFHLENBQUM7YUFDWDtTQUNGO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7T0FTRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQ2hCLElBQVksRUFDWixXQUFrQyxFQUNsQyxPQUE0QixFQUFFLEVBQzlCLFNBQWtCLElBQUksRUFDdEIsVUFBK0IsRUFBRTtRQUVqQyxJQUFJLFlBQWdDLENBQUM7UUFDckMsSUFBSSxPQUFPLE9BQU8sQ0FBQyxLQUFLLEtBQUssUUFBUSxFQUFFO1lBQ3JDLFlBQVksR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDO1NBQzlCO1FBRUQsTUFBTSxNQUFNLEdBQTRCO1lBQ3RDLFFBQVEsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztZQUNoQyxPQUFPLEVBQUUsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDckMsRUFBRSxFQUFFLElBQUEsU0FBTSxHQUFFO2dCQUNaLFdBQVcsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO2dCQUM5QyxZQUFZO2FBQ2IsQ0FBQyxDQUFDO1NBQ0osQ0FBQztRQUVGLElBQUk7WUFDRixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDakUsT0FBTyxHQUFHLENBQUM7U0FDWjtRQUFDLE9BQU8sR0FBRyxFQUFFO1lBQ1osSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLElBQUk7Z0JBQ2YsV0FBVztnQkFDWCxJQUFJO2dCQUNKLE1BQU07YUFDUCxDQUFDLENBQUM7WUFDSCxJQUFJLE1BQU0sS0FBSyxLQUFLLEVBQUU7Z0JBQ3BCLE1BQU0sR0FBRyxDQUFDO2FBQ1g7U0FDRjtJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVyxDQUNmLElBQVksRUFDWixPQUE0QixFQUM1QixPQUE0QixFQUFFLEVBQzlCLEtBQTBCLEVBQzFCLFNBQWtCLElBQUk7UUFFdEIsTUFBTSxNQUFNLEdBQXVCO1lBQ2pDLFFBQVEsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztZQUNoQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQztZQUM5QyxjQUFjLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDMUIsc0JBQXNCLEVBQUUsS0FBSyxDQUFDLEVBQUU7U0FDakMsQ0FBQztRQUNGLElBQUk7WUFDRixNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQzVELE9BQU8sR0FBRyxDQUFDO1NBQ1o7UUFBQyxPQUFPLEdBQUcsRUFBRTtZQUNaLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFO2dCQUNkLFNBQVMsRUFBRSxJQUFJO2dCQUNmLE9BQU87Z0JBQ1AsSUFBSTtnQkFDSixNQUFNO2FBQ1AsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxNQUFNLEtBQUssS0FBSyxFQUFFO2dCQUNwQixNQUFNLEdBQUcsQ0FBQzthQUNYO1NBQ0Y7SUFDSCxDQUFDO0lBRUQsV0FBVyxDQUFDLElBQVk7UUFDdEIsT0FBTyxlQUFlLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxrQkFBa0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLElBQUksSUFBSSxFQUFFLENBQUM7SUFDNUYsQ0FBQztJQUVEOztPQUVHO0lBQ0gsU0FBUyxDQUNQLElBQVksRUFDWixFQUFrRSxFQUNsRSxPQUE0QixFQUFFO1FBRTlCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDeEMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQzdCLE1BQU0sR0FBRyxHQUFHLHVCQUFRLENBQUMsTUFBTSxDQUFDO2dCQUMxQixRQUFRO2dCQUNSLGFBQWEsRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFO29CQUNyQixPQUFPLElBQUksT0FBTyxDQUFDLENBQUMsUUFBUSxFQUFFLE1BQU0sRUFBRSxFQUFFO3dCQUN0QyxFQUFFLENBQ0E7NEJBQ0UsSUFBSSxFQUFFLElBQUEsMkJBQVEsRUFBQyxHQUFHLENBQUMsSUFBSSxDQUFDOzRCQUN4QixHQUFHLEVBQUUsUUFBUTs0QkFDYixJQUFJLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtnQ0FDWixNQUFNLENBQUMsR0FBRyxJQUFJLElBQUksS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUMsQ0FBQzs0QkFDeEQsQ0FBQzt5QkFDRixFQUNEOzRCQUNFLEVBQUUsRUFBRSxHQUFHLENBQUMsU0FBUzs0QkFDakIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxhQUFhOzRCQUN6QixlQUFlLEVBQUUsR0FBRyxDQUFDLFVBQVU7NEJBQy9CLGlCQUFpQixFQUFFLEdBQUcsQ0FBQyxpQkFBaUI7eUJBQ3pDLENBQ0YsQ0FBQztvQkFDSixDQUFDLENBQUMsQ0FBQztnQkFDTCxDQUFDO2dCQUNELFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxJQUFJLEVBQUU7Z0JBQ25DLGFBQWE7Z0JBQ2IsR0FBRyxFQUFFLElBQUksQ0FBQyxNQUFNO2FBQ2pCLENBQUMsQ0FBQztZQUVILEdBQUcsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQUU7Z0JBQ3RCLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFO29CQUNkLFNBQVMsRUFBRSxJQUFJO2lCQUNoQixDQUFDLENBQUM7WUFDTCxDQUFDLENBQUMsQ0FBQztZQUNILEdBQUcsQ0FBQyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtnQkFDakMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUU7b0JBQ2QsU0FBUyxFQUFFLElBQUk7aUJBQ2hCLENBQUMsQ0FBQztZQUNMLENBQUMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsUUFBUSxFQUFFLENBQUMsQ0FBQztZQUMxQyxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWixPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDZixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYSxDQUNqQixJQUFZLEVBQ1osU0FBYyxFQUNkLE1BQWM7UUFFZCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3hDLE1BQU0sTUFBTSxHQUF5QjtZQUNuQyxRQUFRLEVBQUUsUUFBUTtZQUNsQixhQUFhLEVBQUUsTUFBTTtTQUN0QixDQUFDO1FBRUYsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUNwRCxDQUFDO0lBRUQsS0FBSyxDQUFDLGFBQWEsQ0FBQyxJQUFZLEVBQUUsU0FBYyxFQUFFLE1BQWM7UUFDOUQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN4QyxNQUFNLE1BQU0sR0FBbUM7WUFDN0MsUUFBUSxFQUFFLFFBQVE7WUFDbEIsYUFBYSxFQUFFLE1BQU07WUFDckIsaUJBQWlCLEVBQUUsQ0FBQztTQUNyQixDQUFDO1FBQ0YsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLHVCQUF1QixDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQzlELENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYSxDQUFDLElBQVksRUFBRSxNQUFNLEdBQUcsRUFBRTtRQUMzQyxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3hDLE1BQU0sTUFBTSxHQUFHO1lBQ2IsUUFBUSxFQUFFLFFBQVE7WUFDbEIsbUJBQW1CLEVBQUUsTUFBTTtTQUM1QixDQUFDO1FBQ0YsTUFBTSxHQUFHLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUMvRCxPQUFPLEdBQUcsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDOUIsT0FBTztnQkFDTDtvQkFDRSxJQUFJLEVBQUUsSUFBQSwyQkFBUSxFQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUM7b0JBQ3hCLEdBQUcsRUFBRSxHQUFHLEVBQUU7d0JBQ1IsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztvQkFDcEUsQ0FBQztvQkFDRCxJQUFJLEVBQUUsR0FBRyxFQUFFO3dCQUNULE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUM7b0JBQ3BFLENBQUM7aUJBQ0Y7Z0JBQ0Q7b0JBQ0UsRUFBRSxFQUFFLEdBQUcsQ0FBQyxTQUFTO29CQUNqQixNQUFNLEVBQUUsR0FBRyxDQUFDLGFBQWE7b0JBQ3pCLGVBQWUsRUFBRSxHQUFHLENBQUMsVUFBVTtvQkFDL0IsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLGlCQUFpQjtpQkFDekM7YUFDRixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFZO1FBQ3pCLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDbkQsT0FBTyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDckIsQ0FBQztDQUNGO0FBelZELHNCQXlWQyJ9