import { SendMessageBatchCommandOutput, SendMessageCommandOutput } from "@aws-sdk/client-sqs";
import { EventEmitter } from "events";
export default class SQS {
    private name;
    private emitter;
    private config;
    private client;
    private queues;
    constructor(name: string, emitter: EventEmitter, config?: Record<string, any>);
    log(message: string, data?: Record<string, any>): void;
    success(message: string, data?: Record<string, any>): void;
    error(err: Error, data?: Record<string, any>): void;
    /**
     * Initializes the SQS client with the provided region and account ID.
     *
     * @param {string} [region] - The AWS region to set for the SQS client.
     * @param {string} [accountId] - The AWS account ID to set for the SQS client.
     * @returns {Promise<SQS>} A promise that resolves to the initialized SQS client.
     * @throws Will throw an error if the initialization fails.
     */
    init(region?: string, accountId?: string): Promise<SQS>;
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
    createQueue(name: string, opts?: Record<string, string>): Promise<void>;
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
    publish(name: string, content: Record<string, any>, meta?: Record<string, any>, handle?: boolean, options?: Record<string, any>): Promise<SendMessageCommandOutput>;
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
    publishBatch(name: string, contentList: Record<string, any>[], meta?: Record<string, any>, handle?: boolean, options?: Record<string, any>): Promise<SendMessageBatchCommandOutput>;
    publishFifo(name: string, content: Record<string, any>, meta: Record<string, any>, group: Record<string, any>, handle?: boolean): Promise<SendMessageCommandOutput>;
    getQueueUrl(name: string): string;
    /**
     * Subscribe to a queue, using long polling
     */
    subscribe(name: string, cb: (arg1: Record<string, any>, arg2: Record<string, any>) => void, opts?: Record<string, any>): Promise<unknown>;
    deleteMessage(name: string, messageId: any, handle: string): Promise<void>;
    returnMessage(name: string, messageId: any, handle: string): Promise<void>;
    fetchMessages(name: string, number?: number): Promise<{
        data: any;
        id: string;
        handle: string;
        queueAttributes: Partial<Record<import("@aws-sdk/client-sqs").MessageSystemAttributeName, string>>;
        messageAttributes: Record<string, import("@aws-sdk/client-sqs").MessageAttributeValue>;
        ack: () => Promise<void>;
        nack: () => Promise<void>;
    }[]>;
    fetchOne(name: string): Promise<any>;
}
