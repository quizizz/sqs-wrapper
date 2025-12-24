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
            accountId: "399771530480",
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
            const endpoint = this.config.endpoint ||
                process.env.AWS_ENDPOINT_URL_SQS ||
                process.env.AWS_ENDPOINT_URL;
            this.config = {
                ...this.config,
                ...(region && { region }),
                ...(accountId && { accountId }),
                ...(endpoint && { endpoint }),
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
            console.log("error creating the queue: ", err);
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
            // Return empty response when error is handled
            return {};
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
            // Return empty response when error is handled
            return { Successful: [], Failed: [] };
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
            // Return empty response when error is handled
            return {};
        }
    }
    getQueueUrl(name) {
        if (this.config.endpoint) {
            return `${this.config.endpoint}/${this.config.accountId}/${name}`;
        }
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
                handleMessage: async (msg) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxvREFlNkI7QUFDN0IsMEVBQXlDO0FBQ3pDLCtDQUF3QztBQUV4QywrQkFBb0M7QUFDcEMsaUNBQThCO0FBRTlCLE1BQXFCLEdBQUc7SUFDZCxJQUFJLENBQVM7SUFDYixPQUFPLENBQWU7SUFDdEIsTUFBTSxDQUFzQjtJQUM1QixNQUFNLENBQVk7SUFDbEIsTUFBTSxDQUF5QjtJQUV2QyxZQUNFLElBQVksRUFDWixPQUFxQixFQUNyQixTQUE4QixFQUFFO1FBRWhDLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO1FBQ2pCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDeEIsTUFBTSxDQUFDLFdBQVcsR0FBRztnQkFDbkIsS0FBSyxFQUFFLElBQUksYUFBSyxDQUFDO29CQUNmLFNBQVMsRUFBRSxJQUFJO2lCQUNoQixDQUFDO2FBQ0gsQ0FBQztRQUNKLENBQUM7UUFDRCxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQ3pCO1lBQ0UsTUFBTSxFQUFFLFdBQVc7WUFDbkIsU0FBUyxFQUFFLGNBQWM7U0FDMUIsRUFDRCxNQUFNLENBQ1AsQ0FBQztRQUNGLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDO0lBQ3JCLENBQUM7SUFFRCxHQUFHLENBQUMsT0FBZSxFQUFFLElBQTBCO1FBQzdDLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRTtZQUN2QixPQUFPLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDbEIsT0FBTztZQUNQLElBQUk7U0FDTCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTyxDQUFDLE9BQWUsRUFBRSxJQUEwQjtRQUNqRCxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUU7WUFDM0IsT0FBTyxFQUFFLElBQUksQ0FBQyxJQUFJO1lBQ2xCLE9BQU87WUFDUCxJQUFJO1NBQ0wsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELEtBQUssQ0FBQyxHQUFVLEVBQUUsSUFBMEI7UUFDMUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFO1lBQ3pCLE9BQU8sRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNsQixJQUFJO1lBQ0osR0FBRztTQUNKLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0gsS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFlLEVBQUUsU0FBa0I7UUFDNUMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxRQUFRLEdBQ1osSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRO2dCQUNwQixPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQjtnQkFDaEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQztZQUMvQixJQUFJLENBQUMsTUFBTSxHQUFHO2dCQUNaLEdBQUcsSUFBSSxDQUFDLE1BQU07Z0JBQ2QsR0FBRyxDQUFDLE1BQU0sSUFBSSxFQUFFLE1BQU0sRUFBRSxDQUFDO2dCQUN6QixHQUFHLENBQUMsU0FBUyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7Z0JBQy9CLEdBQUcsQ0FBQyxRQUFRLElBQUksRUFBRSxRQUFRLEVBQUUsQ0FBQzthQUM5QixDQUFDO1lBQ0YsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLHNCQUFTLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ3pDLElBQUksQ0FBQyxHQUFHLENBQUMsb0JBQW9CLElBQUksQ0FBQyxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDdkQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBQUMsT0FBTyxHQUFRLEVBQUUsQ0FBQztZQUNsQixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDN0IsTUFBTSxHQUFHLENBQUM7UUFDWixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7OztPQWNHO0lBQ0gsS0FBSyxDQUFDLFdBQVcsQ0FDZixJQUFZLEVBQ1osT0FBK0IsRUFBRTtRQUVqQyxNQUFNLE9BQU8sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUMzQjtRQUNFLGlEQUFpRDtTQUNsRCxFQUNELElBQUksQ0FDTCxDQUFDO1FBQ0YsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSwrQkFBa0IsQ0FBQztnQkFDckMsU0FBUyxFQUFFLElBQUk7Z0JBQ2YsVUFBVSxFQUFFLE9BQU87YUFDcEIsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNqRCxNQUFNLFFBQVEsR0FBRyxRQUFRLENBQUMsUUFBUSxDQUFDO1lBQ25DLE1BQU0sT0FBTyxHQUFHLGlCQUFpQixJQUFJLE9BQU8sUUFBUSxFQUFFLENBQUM7WUFDdkQsSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQztRQUN4QyxDQUFDO1FBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztZQUNiLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFDL0MsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUNuQyxNQUFNLEdBQUcsQ0FBQztRQUNaLENBQUM7SUFDSCxDQUFDO0lBRUQ7Ozs7Ozs7OztPQVNHO0lBQ0gsS0FBSyxDQUFDLE9BQU8sQ0FDWCxJQUFZLEVBQ1osT0FBNEIsRUFDNUIsT0FBNEIsRUFBRSxFQUM5QixTQUFrQixJQUFJLEVBQ3RCLFVBQStCLEVBQUU7UUFFakMsTUFBTSxNQUFNLEdBQXVCO1lBQ2pDLFFBQVEsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztZQUNoQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsQ0FBQztTQUMvQyxDQUFDO1FBRUYsSUFBSSxPQUFPLE9BQU8sQ0FBQyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDdEMsTUFBTSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQ3RDLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLE9BQU8sR0FBRyxJQUFJLCtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQy9DLE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDNUMsT0FBTyxHQUFHLENBQUM7UUFDYixDQUFDO1FBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQztZQUNiLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFO2dCQUNkLFNBQVMsRUFBRSxJQUFJO2dCQUNmLE9BQU87Z0JBQ1AsSUFBSTtnQkFDSixNQUFNO2FBQ1AsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxNQUFNLEtBQUssS0FBSyxFQUFFLENBQUM7Z0JBQ3JCLE1BQU0sR0FBRyxDQUFDO1lBQ1osQ0FBQztZQUNELDhDQUE4QztZQUM5QyxPQUFPLEVBQThCLENBQUM7UUFDeEMsQ0FBQztJQUNILENBQUM7SUFFRDs7Ozs7Ozs7O09BU0c7SUFDSCxLQUFLLENBQUMsWUFBWSxDQUNoQixJQUFZLEVBQ1osV0FBa0MsRUFDbEMsT0FBNEIsRUFBRSxFQUM5QixTQUFrQixJQUFJLEVBQ3RCLFVBQStCLEVBQUU7UUFFakMsSUFBSSxZQUFnQyxDQUFDO1FBQ3JDLElBQUksT0FBTyxPQUFPLENBQUMsS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ3RDLFlBQVksR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDO1FBQy9CLENBQUM7UUFFRCxNQUFNLE1BQU0sR0FBNEI7WUFDdEMsUUFBUSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1lBQ2hDLE9BQU8sRUFBRSxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUNyQyxFQUFFLEVBQUUsSUFBQSxTQUFNLEdBQUU7Z0JBQ1osV0FBVyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7Z0JBQzlDLFlBQVk7YUFDYixDQUFDLENBQUM7U0FDSixDQUFDO1FBRUYsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSxvQ0FBdUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUNwRCxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQzVDLE9BQU8sR0FBRyxDQUFDO1FBQ2IsQ0FBQztRQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7WUFDYixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRTtnQkFDZCxTQUFTLEVBQUUsSUFBSTtnQkFDZixXQUFXO2dCQUNYLElBQUk7Z0JBQ0osTUFBTTthQUNQLENBQUMsQ0FBQztZQUNILElBQUksTUFBTSxLQUFLLEtBQUssRUFBRSxDQUFDO2dCQUNyQixNQUFNLEdBQUcsQ0FBQztZQUNaLENBQUM7WUFDRCw4Q0FBOEM7WUFDOUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBbUMsQ0FBQztRQUN6RSxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQ2YsSUFBWSxFQUNaLE9BQTRCLEVBQzVCLE9BQTRCLEVBQUUsRUFDOUIsS0FBMEIsRUFDMUIsU0FBa0IsSUFBSTtRQUV0QixNQUFNLE1BQU0sR0FBdUI7WUFDakMsUUFBUSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1lBQ2hDLFdBQVcsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO1lBQzlDLGNBQWMsRUFBRSxLQUFLLENBQUMsSUFBSTtZQUMxQixzQkFBc0IsRUFBRSxLQUFLLENBQUMsRUFBRTtTQUNqQyxDQUFDO1FBQ0YsSUFBSSxDQUFDO1lBQ0gsTUFBTSxPQUFPLEdBQUcsSUFBSSwrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUMvQyxNQUFNLEdBQUcsR0FBRyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBQzVDLE9BQU8sR0FBRyxDQUFDO1FBQ2IsQ0FBQztRQUFDLE9BQU8sR0FBRyxFQUFFLENBQUM7WUFDYixJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRTtnQkFDZCxTQUFTLEVBQUUsSUFBSTtnQkFDZixPQUFPO2dCQUNQLElBQUk7Z0JBQ0osTUFBTTthQUNQLENBQUMsQ0FBQztZQUNILElBQUksTUFBTSxLQUFLLEtBQUssRUFBRSxDQUFDO2dCQUNyQixNQUFNLEdBQUcsQ0FBQztZQUNaLENBQUM7WUFDRCw4Q0FBOEM7WUFDOUMsT0FBTyxFQUE4QixDQUFDO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQsV0FBVyxDQUFDLElBQVk7UUFDdEIsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3pCLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUNwRSxDQUFDO1FBQ0QsT0FBTyxlQUFlLElBQUksQ0FBQyxNQUFNLENBQUMsTUFBTSxrQkFBa0IsSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLElBQUksSUFBSSxFQUFFLENBQUM7SUFDNUYsQ0FBQztJQUVEOztPQUVHO0lBQ0gsU0FBUyxDQUNQLElBQVksRUFDWixFQUFrRSxFQUNsRSxPQUE0QixFQUFFO1FBRTlCLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDeEMsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFO1lBQzdCLE1BQU0sR0FBRyxHQUFHLHVCQUFRLENBQUMsTUFBTSxDQUFDO2dCQUMxQixRQUFRO2dCQUNSLGFBQWEsRUFBRSxLQUFLLEVBQUUsR0FBWSxFQUFFLEVBQUU7b0JBQ3BDLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLEVBQUU7d0JBQ3RDLEVBQUUsQ0FDQTs0QkFDRSxJQUFJLEVBQUUsSUFBQSwyQkFBUSxFQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUM7NEJBQ3hCLEdBQUcsRUFBRSxRQUFROzRCQUNiLElBQUksRUFBRSxDQUFDLEdBQUcsRUFBRSxFQUFFO2dDQUNaLE1BQU0sQ0FBQyxHQUFHLElBQUksSUFBSSxLQUFLLENBQUMsMkJBQTJCLENBQUMsQ0FBQyxDQUFDOzRCQUN4RCxDQUFDO3lCQUNGLEVBQ0Q7NEJBQ0UsRUFBRSxFQUFFLEdBQUcsQ0FBQyxTQUFTOzRCQUNqQixNQUFNLEVBQUUsR0FBRyxDQUFDLGFBQWE7NEJBQ3pCLGVBQWUsRUFBRSxHQUFHLENBQUMsVUFBVTs0QkFDL0IsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLGlCQUFpQjt5QkFDekMsQ0FDRixDQUFDO29CQUNKLENBQUMsQ0FBQyxDQUFDO2dCQUNMLENBQUM7Z0JBQ0QsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLElBQUksRUFBRTtnQkFDbkMsR0FBRyxFQUFFLElBQUksQ0FBQyxNQUFNO2FBQ2pCLENBQUMsQ0FBQztZQUVILEdBQUcsQ0FBQyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQUU7Z0JBQ3RCLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFO29CQUNkLFNBQVMsRUFBRSxJQUFJO2lCQUNoQixDQUFDLENBQUM7WUFDTCxDQUFDLENBQUMsQ0FBQztZQUNILEdBQUcsQ0FBQyxFQUFFLENBQUMsa0JBQWtCLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRTtnQkFDakMsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUU7b0JBQ2QsU0FBUyxFQUFFLElBQUk7aUJBQ2hCLENBQUMsQ0FBQztZQUNMLENBQUMsQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsUUFBUSxFQUFFLENBQUMsQ0FBQztZQUMxQyxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDWixPQUFPLENBQUMsR0FBRyxDQUFDLENBQUM7UUFDZixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYSxDQUNqQixJQUFZLEVBQ1osU0FBYyxFQUNkLE1BQWM7UUFFZCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3hDLE1BQU0sTUFBTSxHQUF5QjtZQUNuQyxRQUFRLEVBQUUsUUFBUTtZQUNsQixhQUFhLEVBQUUsTUFBTTtTQUN0QixDQUFDO1FBRUYsTUFBTSxPQUFPLEdBQUcsSUFBSSxpQ0FBb0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNqRCxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2xDLENBQUM7SUFFRCxLQUFLLENBQUMsYUFBYSxDQUFDLElBQVksRUFBRSxTQUFjLEVBQUUsTUFBYztRQUM5RCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3hDLE1BQU0sTUFBTSxHQUFtQztZQUM3QyxRQUFRLEVBQUUsUUFBUTtZQUNsQixhQUFhLEVBQUUsTUFBTTtZQUNyQixpQkFBaUIsRUFBRSxDQUFDO1NBQ3JCLENBQUM7UUFDRixNQUFNLE9BQU8sR0FBRyxJQUFJLDJDQUE4QixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQzNELE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQUMsSUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFO1FBQzNDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDeEMsTUFBTSxNQUFNLEdBQUc7WUFDYixRQUFRLEVBQUUsUUFBUTtZQUNsQixtQkFBbUIsRUFBRSxNQUFNO1NBQzVCLENBQUM7UUFDRixNQUFNLE9BQU8sR0FBRyxJQUFJLGtDQUFxQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ2xELE1BQU0sR0FBRyxHQUFHLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDNUMsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLFFBQVEsSUFBSSxFQUFFLENBQUM7UUFDcEMsT0FBTyxRQUFRLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUU7WUFDMUIsT0FBTztnQkFDTCxJQUFJLEVBQUUsSUFBQSwyQkFBUSxFQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUM7Z0JBQ3hCLEVBQUUsRUFBRSxHQUFHLENBQUMsU0FBUztnQkFDakIsTUFBTSxFQUFFLEdBQUcsQ0FBQyxhQUFhO2dCQUN6QixlQUFlLEVBQUUsR0FBRyxDQUFDLFVBQVU7Z0JBQy9CLGlCQUFpQixFQUFFLEdBQUcsQ0FBQyxpQkFBaUI7Z0JBQ3hDLEdBQUcsRUFBRSxHQUFHLEVBQUU7b0JBQ1IsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsQ0FBQztnQkFDcEUsQ0FBQztnQkFDRCxJQUFJLEVBQUUsR0FBRyxFQUFFO29CQUNULE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLENBQUM7Z0JBQ3BFLENBQUM7YUFDRixDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxJQUFZO1FBQ3pCLE1BQU0sUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDbkQsT0FBTyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDckIsQ0FBQztDQUNGO0FBOVdELHNCQThXQyJ9