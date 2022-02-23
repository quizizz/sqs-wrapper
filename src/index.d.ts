
type AWSConfig = {
  region?: string,
};

type CreateQueueOpts = {
  DelaySeconds: number,
  MaximumMessageSize: number,
  MessageRetentionPeriod: number,
  ReceiveMessageWaitTimeSeconds: number,
  FifoQueue: 'false' | 'true',
}

type Content = Record<string, unkown>
type Meta = Record<string, unkown>
type PublishOptions = {
  delay: number
}

type Message = {
  data: Record<string, unknown>;
  ack: () => {},
  nack: (err) => {},
};
type Metadata = {
  id: string;
  handle: string;
  queueAttributes: Record<string, unknown>;
  messageAttributes: Record<string, unknown>;
}

type SubscribeCallback = (message: Message, metadata: Metadata) => void
type SubscribeOptions = {
  maxInProgress: number;
}

export default class SQS {
  constructor(name: string, emitter: any, config: AWSConfig);
  init(): Promise<SQS>;
  createQueue(queueName: string, opts: CreateQueueOpts): Promise<void>;
  publish(
    queueName: string,
    content: Content,
    meta: Meta,
    handle: boolean,
    options: PublishOptions,
  ): Promise<unknown>;
  publishFifo(
    queueName: string,
    content: Content,
    meta: Meta,
    group: string,
    handle: boolean,
  ): Promise<unknown>;
  getQueueUrl(queueName: string): string;
  subscribe(queueName: string, cb: SubscribeCallback, opts: SubscribeOptions): Promise<void>;
  deleteMessage(queueName: string, messageId: string, handle: string): Promise<void>;
  returnMessage(queueName: string, messageId: string, handle: string): Promise<void>;
  fetchMessages(queueName: string, number?: number): Promise<Message[]>;
  fetchOne(queueName: string): Promise<Message>;
};
