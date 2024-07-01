/// <reference types="node" />
import AWS, { AWSError } from "aws-sdk";
import EventEmitter from "events";
import { QueueAttributeMap, SendMessageBatchResult, SendMessageResult } from "aws-sdk/clients/sqs";
import { PromiseResult } from "aws-sdk/lib/request";
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
    private processQueueUrls;
    private listQueuesRecursively;
    init(queueNamePrefix?: string): Promise<SQS>;
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
    createQueue(name: string, opts?: QueueAttributeMap): Promise<void>;
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
    publish(name: string, content: Record<string, any>, meta?: Record<string, any>, handle?: boolean, options?: Record<string, any>): Promise<PromiseResult<SendMessageResult, AWSError>>;
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
    publishBatch(name: string, contentList: Record<string, any>[], meta?: Record<string, any>, handle?: boolean, options?: Record<string, any>): Promise<PromiseResult<SendMessageBatchResult, AWSError>>;
    publishFifo(name: string, content: Record<string, any>, meta: Record<string, any>, group: Record<string, any>, handle?: boolean): Promise<PromiseResult<SendMessageResult, AWSError>>;
    getQueueUrl(name: string): string;
    /**
     * Subscribe to a queue, using long polling
     */
    subscribe(name: string, cb: (arg1: Record<string, any>, arg2: Record<string, any>) => void, opts?: Record<string, any>): Promise<unknown>;
    deleteMessage(name: string, messageId: any, handle: string): Promise<void>;
    returnMessage(name: string, messageId: any, handle: string): Promise<void>;
    fetchMessages(name: string, number?: number): Promise<({
        data: any;
        ack: () => Promise<void>;
        nack: () => Promise<void>;
        id?: undefined;
        handle?: undefined;
        queueAttributes?: undefined;
        messageAttributes?: undefined;
    } | {
        id: string;
        handle: string;
        queueAttributes: AWS.SQS.MessageSystemAttributeMap;
        messageAttributes: AWS.SQS.MessageBodyAttributeMap;
        data?: undefined;
        ack?: undefined;
        nack?: undefined;
    })[][]>;
    fetchOne(name: string): Promise<any>;
}
